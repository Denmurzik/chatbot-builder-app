import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClinicServer, type ClinicServerOptions } from './server';

const API_KEY = 'secret-test-key';

let activeServer: http.Server | null = null;

// Поднимает сервер на случайном свободном порту и возвращает базовый URL
async function startServer(opts: Partial<ClinicServerOptions> = {}): Promise<string> {
  const server = createClinicServer({ apiKey: API_KEY, ...opts });
  activeServer = server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('createClinicServer', () => {
  describe('авторизация по X-Api-Key', () => {
    it('возвращает 401 без заголовка X-Api-Key', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/doctors`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Неверный ключ API' });
    });

    it('возвращает 401 при неверном ключе X-Api-Key', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/doctors`, {
        headers: { 'X-Api-Key': 'wrong-key' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Неверный ключ API' });
    });

    it('требует ключ и для POST /bookings', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 's1', patient: 'Иван' }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Неверный ключ API' });
    });
  });

  describe('GET /doctors', () => {
    it('возвращает список из трёх врачей', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/doctors`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ id: string; name: string; specialty: string }>;
      };
      expect(body.items).toHaveLength(3);
      expect(body.items[0]).toEqual({
        id: 'd1',
        name: 'Иванова Анна Петровна',
        specialty: 'Терапевт',
      });
      for (const doctor of body.items) {
        expect(typeof doctor.id).toBe('string');
        expect(typeof doctor.name).toBe('string');
        expect(typeof doctor.specialty).toBe('string');
      }
    });
  });

  describe('GET /slots', () => {
    it('возвращает свободные слоты врача', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/slots?doctorId=d1`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string; time: string }> };
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.items[0]).toEqual({ id: 's1', time: '2026-12-03 10:00' });
    });

    it('возвращает 404 для неизвестного врача', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/slots?doctorId=unknown`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toHaveProperty('error');
    });

    it('возвращает 404 если doctorId не указан', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/slots`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /bookings', () => {
    it('бронирует свободный слот и убирает его из списка свободных', async () => {
      const baseUrl = await startServer();

      const createRes = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 's1', patient: 'Смирнов Алексей' }),
      });
      expect(createRes.status).toBe(201);
      const booking = (await createRes.json()) as {
        bookingId: string;
        time: string;
        doctor: string;
      };
      expect(booking.bookingId).toBeTruthy();
      expect(booking.time).toBe('2026-12-03 10:00');
      expect(booking.doctor).toBe('Иванова Анна Петровна');

      // Забронированный слот больше не отображается в GET /slots
      const slotsRes = await fetch(`${baseUrl}/slots?doctorId=d1`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      const slotsBody = (await slotsRes.json()) as { items: Array<{ id: string; time: string }> };
      expect(slotsBody.items.find((s) => s.id === 's1')).toBeUndefined();
    });

    it('возвращает 409 при повторной попытке занять слот', async () => {
      const baseUrl = await startServer();

      const first = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 's1', patient: 'Пациент 1' }),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 's1', patient: 'Пациент 2' }),
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'Слот уже занят' });
    });

    it('возвращает 404 для несуществующего слота и 400 для невалидного JSON', async () => {
      const baseUrl = await startServer();

      const notFound = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'no-such-slot', patient: 'Пациент' }),
      });
      expect(notFound.status).toBe(404);

      const badJson = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: '{broken',
      });
      expect(badJson.status).toBe(400);
    });
  });

  describe('сбой по требованию (X-Mock-Fail)', () => {
    it('X-Mock-Fail: 500 возвращает статус 500', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/doctors`, {
        headers: { 'X-Api-Key': API_KEY, 'X-Mock-Fail': '500' },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toHaveProperty('error');
    });

    it('X-Mock-Fail: timeout задерживает ответ на заданный интервал', async () => {
      const baseUrl = await startServer({ timeoutDelayMs: 120 });
      const started = Date.now();
      const res = await fetch(`${baseUrl}/doctors`, {
        headers: { 'X-Api-Key': API_KEY, 'X-Mock-Fail': 'timeout' },
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(res.status).toBe(200);
    });

    it('X-Mock-Fail: timeout по умолчанию задерживает ответ дольше обычного и отменяется при обрыве', async () => {
      const baseUrl = await startServer();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 80);
      try {
        await expect(
          fetch(`${baseUrl}/doctors`, {
            headers: { 'X-Api-Key': API_KEY, 'X-Mock-Fail': 'timeout' },
            signal: controller.signal,
          }),
        ).rejects.toThrow();
      } finally {
        clearTimeout(timer);
      }
    });
  });
});
