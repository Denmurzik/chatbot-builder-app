import http, { type IncomingMessage, type ServerResponse } from 'node:http';

const DEFAULT_TIMEOUT_DELAY_MS = 30_000;
const MAX_BODY_BYTES = 64 * 1024;

export interface ClinicServerOptions {
  apiKey: string;
  timeoutDelayMs?: number;
}

interface Doctor {
  id: string;
  name: string;
  specialty: string;
}

interface Slot {
  id: string;
  doctorId: string;
  time: string;
}

const INITIAL_DOCTORS: readonly Doctor[] = [
  { id: 'd1', name: 'Иванова Анна Петровна', specialty: 'Терапевт' },
  { id: 'd2', name: 'Петров Сергей Владимирович', specialty: 'Хирург' },
  { id: 'd3', name: 'Сидорова Елена Николаевна', specialty: 'Окулист' },
];

const INITIAL_SLOTS: readonly Slot[] = [
  { id: 's1', doctorId: 'd1', time: '2026-12-03 10:00' },
  { id: 's2', doctorId: 'd1', time: '2026-12-03 11:30' },
  { id: 's3', doctorId: 'd1', time: '2026-12-03 14:00' },
  { id: 's4', doctorId: 'd2', time: '2026-12-03 10:30' },
  { id: 's5', doctorId: 'd2', time: '2026-12-03 13:00' },
  { id: 's6', doctorId: 'd3', time: '2026-12-03 09:30' },
  { id: 's7', doctorId: 'd3', time: '2026-12-03 15:00' },
];

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Превышен допустимый размер тела запроса'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

// Создаёт HTTP-сервер тестового API клиники с хранением броней в памяти процесса
export function createClinicServer(opts: ClinicServerOptions): http.Server {
  const timeoutDelayMs = opts.timeoutDelayMs ?? DEFAULT_TIMEOUT_DELAY_MS;
  const doctors = INITIAL_DOCTORS.map((d) => ({ ...d }));
  const doctorsById = new Map(doctors.map((d) => [d.id, d]));
  const slots = INITIAL_SLOTS.map((s) => ({ ...s }));
  const slotsById = new Map(slots.map((s) => [s.id, s]));
  const bookedSlotIds = new Set<string>();
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  let nextBookingId = 1;

  async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/doctors') {
      sendJson(res, 200, { items: doctors });
      return;
    }

    if (method === 'GET' && url.pathname === '/slots') {
      const doctorId = url.searchParams.get('doctorId');
      if (!doctorId || !doctorsById.has(doctorId)) {
        sendJson(res, 404, { error: 'Врач не найден' });
        return;
      }
      const freeSlots = slots
        .filter((slot) => slot.doctorId === doctorId && !bookedSlotIds.has(slot.id))
        .map(({ id, time }) => ({ id, time }));
      sendJson(res, 200, { items: freeSlots });
      return;
    }

    if (method === 'POST' && url.pathname === '/bookings') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Некорректное тело запроса' });
        return;
      }

      if (typeof body !== 'object' || body === null) {
        sendJson(res, 400, { error: 'Ожидается JSON-объект' });
        return;
      }

      const { slotId, patient } = body as Record<string, unknown>;
      if (
        typeof slotId !== 'string' ||
        slotId.trim() === '' ||
        typeof patient !== 'string' ||
        patient.trim() === ''
      ) {
        sendJson(res, 400, { error: 'Требуются непустые поля slotId и patient' });
        return;
      }

      const slot = slotsById.get(slotId);
      if (!slot) {
        sendJson(res, 404, { error: 'Слот не найден' });
        return;
      }

      if (bookedSlotIds.has(slot.id)) {
        sendJson(res, 409, { error: 'Слот уже занят' });
        return;
      }

      bookedSlotIds.add(slot.id);
      const doctor = doctorsById.get(slot.doctorId);
      const bookingId = `b${nextBookingId++}`;
      sendJson(res, 201, {
        bookingId,
        time: slot.time,
        doctor: doctor?.name ?? '',
      });
      return;
    }

    sendJson(res, 404, { error: 'Маршрут не найден' });
  }

  const server = http.createServer((req, res) => {
    if (req.headers['x-api-key'] !== opts.apiKey) {
      sendJson(res, 401, { error: 'Неверный ключ API' });
      return;
    }

    const mockFail = req.headers['x-mock-fail'];
    if (mockFail === '500') {
      sendJson(res, 500, { error: 'Имитация сбоя сервера' });
      return;
    }

    if (mockFail === 'timeout') {
      const timer = setTimeout(() => {
        activeTimers.delete(timer);
        void routeRequest(req, res);
      }, timeoutDelayMs);
      activeTimers.add(timer);
      res.on('close', () => {
        if (activeTimers.has(timer)) {
          clearTimeout(timer);
          activeTimers.delete(timer);
        }
      });
      return;
    }

    void routeRequest(req, res);
  });

  server.on('close', () => {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.clear();
  });

  return server;
}
