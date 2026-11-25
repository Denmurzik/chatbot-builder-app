import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalApiClient, type HttpResultSink, type OutgoingHttpRequest } from './external-api-client';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: Server[] = [];

async function startServer(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function makeSink() {
  let sinkResolve!: () => void;
  const done = new Promise<void>((resolve) => {
    sinkResolve = resolve;
  });
  const sink = {
    onResponse: vi.fn(async () => sinkResolve()),
    onFailure: vi.fn(async () => sinkResolve()),
  } satisfies HttpResultSink;
  return { sink, done };
}

function request(url: string): OutgoingHttpRequest {
  return { id: 'r1', method: 'GET', url, headers: {}, body: null };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

describe('ExternalApiClient', () => {
  it('200 -> onResponse с телом', async () => {
    const url = await startServer((_req, res) => res.end('hello'));
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
    await done;
    expect(sink.onResponse).toHaveBeenCalledWith('r1', 200, 'hello');
    expect(sink.onFailure).not.toHaveBeenCalled();
  });

  it('500, 500, 200 при retryCount=2 -> один onResponse, 3 запроса', async () => {
    let hits = 0;
    const url = await startServer((_req, res) => {
      hits += 1;
      res.statusCode = hits < 3 ? 500 : 200;
      res.end('ok');
    });
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 1, 2, 0.01);
    await done;
    expect(hits).toBe(3);
    expect(sink.onResponse).toHaveBeenCalledTimes(1);
    expect(sink.onResponse).toHaveBeenCalledWith('r1', 200, 'ok');
    expect(sink.onFailure).not.toHaveBeenCalled();
  });

  it('500 x3 при retryCount=2 -> onFailure с кодом 500', async () => {
    let hits = 0;
    const url = await startServer((_req, res) => {
      hits += 1;
      res.statusCode = 500;
      res.end('err');
    });
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 1, 2, 0.01);
    await done;
    expect(hits).toBe(3);
    expect(sink.onFailure).toHaveBeenCalledWith('r1', 500, expect.any(String));
    expect(sink.onResponse).not.toHaveBeenCalled();
  });

  it('тайм-аут -> onFailure с кодом 0', async () => {
    const url = await startServer(() => {
      /* не отвечаем */
    });
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
    await done;
    expect(sink.onFailure).toHaveBeenCalledWith('r1', 0, expect.stringMatching(/[а-яё]/i));
  });

  it('закрытый порт -> onFailure с кодом 0', async () => {
    const url = await startServer((_req, res) => res.end());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
    await done;
    expect(sink.onFailure).toHaveBeenCalledWith('r1', 0, expect.stringMatching(/[а-яё]/i));
  });

  it('send возвращается сразу, до ответа сервера', async () => {
    let served = false;
    const url = await startServer((_req, res) => {
      setTimeout(() => {
        served = true;
        res.end('late');
      }, 100);
    });
    const { sink, done } = makeSink();
    const result = new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
    expect(result).toBeUndefined();
    expect(sink.onResponse).not.toHaveBeenCalled();
    expect(served).toBe(false);
    await done;
    expect(sink.onResponse).toHaveBeenCalledWith('r1', 200, 'late');
  });

  it('тело ответа больше 1 МБ -> onFailure с ошибкой «ответ слишком большой» без повторов', async () => {
    let hits = 0;
    const oversized = Buffer.alloc(1024 * 1024 + 1, 'a');
    const url = await startServer((_req, res) => {
      hits += 1;
      res.end(oversized);
    });
    const { sink, done } = makeSink();
    new ExternalApiClient(sink).send(request(url), 5, 2, 0.01);
    await done;
    expect(hits).toBe(1);
    expect(sink.onResponse).not.toHaveBeenCalled();
    expect(sink.onFailure).toHaveBeenCalledWith(
      'r1',
      0,
      expect.stringMatching(/ответ слишком большой/i),
    );
  });

  it('onResponse бросает -> onFailure не вызывается, необработанных отклонений нет', async () => {
    const url = await startServer((_req, res) => res.end('ok'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { sink, done } = makeSink();
      sink.onResponse.mockImplementation(async () => {
        throw new Error('sink сломан');
      });
      new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
      await vi.waitFor(() => expect(sink.onResponse).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 50));
      void done;
      expect(sink.onFailure).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      errorSpy.mockRestore();
    }
  });

  it('onFailure бросает -> необработанных отклонений нет', async () => {
    const url = await startServer((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { sink } = makeSink();
      sink.onFailure.mockImplementation(async () => {
        throw new Error('sink сломан');
      });
      new ExternalApiClient(sink).send(request(url), 1, 0, 0.01);
      await vi.waitFor(() => expect(sink.onFailure).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      errorSpy.mockRestore();
    }
  });

  describe('HTTP_ALLOWED_HOSTS', () => {
    it('хост не из списка -> onFailure(0, «Адрес не разрешён») без запроса и повторов', async () => {
      let hits = 0;
      const url = await startServer((_req, res) => {
        hits += 1;
        res.end('x');
      });
      const { sink, done } = makeSink();
      new ExternalApiClient(sink, ['mock-clinic']).send(request(url), 1, 2, 0.01);
      await done;
      expect(sink.onFailure).toHaveBeenCalledWith('r1', 0, 'Адрес не разрешён');
      expect(hits).toBe(0);
    });

    it('хост из списка (без учёта регистра) проходит', async () => {
      const url = await startServer((_req, res) => res.end('ok'));
      const { sink, done } = makeSink();
      new ExternalApiClient(sink, ['LOCALHOST', '127.0.0.1']).send(request(url), 1, 0, 0.01);
      await done;
      expect(sink.onResponse).toHaveBeenCalledWith('r1', 200, 'ok');
    });

    it('пустой список или null — без ограничений', async () => {
      const url = await startServer((_req, res) => res.end('ok'));
      for (const hosts of [null, []]) {
        const { sink, done } = makeSink();
        new ExternalApiClient(sink, hosts).send(request(url), 1, 0, 0.01);
        await done;
        expect(sink.onResponse).toHaveBeenCalled();
      }
    });

    it('некорректный URL при заданном списке — отказ', async () => {
      const { sink, done } = makeSink();
      new ExternalApiClient(sink, ['mock-clinic']).send(request('не url'), 1, 0, 0.01);
      await done;
      expect(sink.onFailure).toHaveBeenCalledWith('r1', 0, 'Адрес не разрешён');
    });
  });
});
