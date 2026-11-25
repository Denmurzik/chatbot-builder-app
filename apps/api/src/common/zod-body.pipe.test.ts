import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodBodyPipe } from './zod-body.pipe';

describe('ZodBodyPipe', () => {
  const schema = z.object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(8, 'Пароль не короче 8 символов'),
  });

  it('возвращает распарсенные данные при валидном теле', () => {
    const pipe = new ZodBodyPipe(schema);
    expect(pipe.transform({ email: 'a@b.ru', password: 'password123' })).toEqual({
      email: 'a@b.ru',
      password: 'password123',
    });
  });

  it('бросает BadRequestException с {message, issues: [{path, message}]} при ошибке', () => {
    const pipe = new ZodBodyPipe(schema);
    try {
      pipe.transform({ email: 'bad', password: '123' });
      expect.fail('Ожидалась ошибка валидации');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse();
      expect(response).toEqual({
        message: 'Ошибка валидации',
        issues: [
          { path: 'email', message: 'Некорректный email' },
          { path: 'password', message: 'Пароль не короче 8 символов' },
        ],
      });
    }
  });
});
