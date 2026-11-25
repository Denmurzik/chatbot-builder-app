import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createIsolatedTestDb, type IsolatedTestDb } from './test-db';

describe('Auth API (интеграционные тесты)', () => {
  let db: IsolatedTestDb;
  let app: INestApplication;
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING,
    VK_POLLING: process.env.VK_POLLING,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeAll(async () => {
    db = await createIsolatedTestDb();
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-auth-tests';
    process.env.TELEGRAM_POLLING = '0';
    process.env.VK_POLLING = '0';
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
    process.env.TELEGRAM_POLLING = prevEnv.TELEGRAM_POLLING;
    if (prevEnv.VK_POLLING === undefined) delete process.env.VK_POLLING;
    else process.env.VK_POLLING = prevEnv.VK_POLLING;
    process.env.NODE_ENV = prevEnv.NODE_ENV;
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  it('POST /api/auth/register — регистрирует автора (201) и устанавливает httpOnly cookie session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'Author@Example.com', password: 'password123' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      email: 'author@example.com',
    });

    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies).toBeDefined();
    const sessionCookie = cookies!.find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Max-Age=604800');
    expect(sessionCookie).not.toContain('Secure');

    // Пароль сохранён как хеш argon2id, а не в открытом виде
    const saved = await db.prisma.author.findUnique({ where: { id: res.body.id } });
    expect(saved?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('POST /api/auth/register — пароль короче 8 символов возвращает 400 с issues', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: '1234567' })
      .expect(400);

    expect(res.body).toMatchObject({
      message: expect.any(String),
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'password',
          message: expect.any(String),
        }),
      ]),
    });
  });

  it('POST /api/auth/register — занятый email возвращает 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'anotherpassword' })
      .expect(409);
  });

  it('POST /api/auth/login — верные учётные данные возвращают 200 и cookie, неверные — 401', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'secretpassword' })
      .expect(201);

    const ok = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'secretpassword' })
      .expect(200);

    expect(ok.body).toEqual({
      id: reg.body.id,
      email: 'login@example.com',
    });
    const cookies = ok.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('session='))).toBe(true);

    // Неверный пароль
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrongpassword' })
      .expect(401);

    // Несуществующий email
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'secretpassword' })
      .expect(401);
  });

  it('GET /api/auth/me и POST /api/auth/logout — проверка сессии и выход', async () => {
    // Без cookie — 401
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    // С поддельной cookie — 401
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', ['session=invalid.jwt.token'])
      .expect(401);

    const agent = request.agent(app.getHttpServer());
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'me@example.com', password: 'password123' })
      .expect(201);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toEqual({
      id: reg.body.id,
      email: 'me@example.com',
    });

    const logoutRes = await agent.post('/api/auth/logout').expect(204);
    const setCookies = logoutRes.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookies?.some((c) => c.startsWith('session=;'))).toBe(true);

    // После выхода /me возвращает 401
    await agent.get('/api/auth/me').expect(401);
  });

  it('GET /api/auth/me — отклоняет (401) токен с неверным секретом, просроченный токен и токен удалённого автора', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'tokens@example.com', password: 'password123' })
      .expect(201);

    const authorId = reg.body.id as string;

    // 1. Токен, подписанный чужим секретом → 401
    const wrongSecretJwt = new JwtService({ secret: 'completely-different-secret-key' });
    const wrongSecretToken = await wrongSecretJwt.signAsync(
      { sub: authorId },
      { algorithm: 'HS256', expiresIn: '7d' },
    );
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', [`session=${wrongSecretToken}`])
      .expect(401);

    // 2. Просроченный токен → 401
    const realJwt = app.get(JwtService);
    const expiredToken = await realJwt.signAsync(
      { sub: authorId },
      { algorithm: 'HS256', expiresIn: -10 },
    );
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', [`session=${expiredToken}`])
      .expect(401);

    // 3. Токен удалённого автора → 401
    const validToken = await realJwt.signAsync(
      { sub: authorId },
      { algorithm: 'HS256', expiresIn: '7d' },
    );
    await db.prisma.author.delete({ where: { id: authorId } });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', [`session=${validToken}`])
      .expect(401);
  });
});
