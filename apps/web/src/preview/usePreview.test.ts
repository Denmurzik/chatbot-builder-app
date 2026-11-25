import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewEvent } from '@chatbot/model';
import { ru } from '@/i18n/ru';
import { usePreview } from './usePreview';

type Listener = (...args: unknown[]) => void;

class MockSocket {
  private listeners = new Map<string, Set<Listener>>();
  emit = vi.fn();
  disconnect = vi.fn();

  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  trigger(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

let currentSocket: MockSocket;
const ioMock = vi.fn((..._args: unknown[]) => {
  currentSocket = new MockSocket();
  return currentSocket;
});

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

describe('usePreview', () => {
  beforeEach(() => {
    ioMock.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('подключается к /preview с path /api/socket.io и withCredentials, сохраняет sessionId и отключается при закрытии', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => usePreview({ projectId: 'proj-1', enabled }),
      { initialProps: { enabled: true } },
    );

    expect(ioMock).toHaveBeenCalledWith('/preview', {
      path: '/api/socket.io',
      withCredentials: true,
    });
    expect(result.current.status).toBe('connecting');

    act(() => {
      currentSocket.trigger('connect');
    });

    expect(currentSocket.emit).toHaveBeenCalledWith(
      'start',
      { projectId: 'proj-1' },
      expect.any(Function),
    );

    const ack = currentSocket.emit.mock.calls[0]![2] as (res: { chatId: string }) => void;
    act(() => {
      ack({ chatId: 'preview:proj-1:sess-42' });
    });

    expect(result.current.status).toBe('connected');
    expect(sessionStorage.getItem('preview-session:proj-1')).toBe('sess-42');

    // Закрытие панели отключает сокет
    rerender({ enabled: false });
    expect(currentSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('передаёт сохранённый sessionId при повторном открытии превью', () => {
    sessionStorage.setItem('preview-session:proj-1', 'saved-sess');

    renderHook(() => usePreview({ projectId: 'proj-1', enabled: true }));

    act(() => {
      currentSocket.trigger('connect');
    });

    expect(currentSocket.emit).toHaveBeenCalledWith(
      'start',
      { projectId: 'proj-1', sessionId: 'saved-sess' },
      expect.any(Function),
    );
  });

  it('обрабатывает input, button, restart и события message/question/system/currentBlock/variables', () => {
    const onCurrentBlock = vi.fn();
    const onErrorBlock = vi.fn();

    const { result } = renderHook(() =>
      usePreview({
        projectId: 'proj-1',
        enabled: true,
        onCurrentBlock,
        onErrorBlock,
      }),
    );

    act(() => {
      currentSocket.trigger('connect');
      const ack = currentSocket.emit.mock.calls[0]![2] as (res: { chatId: string }) => void;
      ack({ chatId: 'preview:proj-1:s1' });
    });

    // Входящие события от сервера
    const events: PreviewEvent[] = [
      { type: 'message', message: { kind: 'text', text: 'Привет!' } },
      {
        type: 'message',
        message: {
          kind: 'question',
          text: 'Выберите врача',
          buttons: [{ label: 'Терапевт', callbackData: 'opt_1:0' }],
        },
      },
      { type: 'currentBlock', blockId: 'opt_1' },
      { type: 'variables', variables: { name: 'Аня' } },
      { type: 'system', text: 'Выход не подключён', blockId: 'msg_2' },
    ];

    act(() => {
      for (const ev of events) {
        currentSocket.trigger('preview', ev);
      }
    });

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[0]).toMatchObject({ role: 'bot', kind: 'text', text: 'Привет!' });
    expect(result.current.messages[1]).toMatchObject({
      role: 'bot',
      kind: 'question',
      text: 'Выберите врача',
    });
    expect(result.current.messages[2]).toMatchObject({
      role: 'system',
      text: 'Выход не подключён',
      blockId: 'msg_2',
    });
    expect(result.current.variables).toEqual({ name: 'Аня' });
    expect(onCurrentBlock).toHaveBeenCalledWith('opt_1');
    expect(onErrorBlock).toHaveBeenCalledWith('msg_2');

    // Отправка текстового ввода
    act(() => {
      result.current.sendInput('Иван');
    });
    expect(currentSocket.emit).toHaveBeenCalledWith(
      'input',
      { text: 'Иван' },
      expect.any(Function),
    );
    expect(result.current.messages[3]).toMatchObject({ role: 'user', text: 'Иван' });

    // Нажатие кнопки
    act(() => {
      result.current.pressButton({ label: 'Терапевт', callbackData: 'opt_1:0' });
    });
    expect(currentSocket.emit).toHaveBeenCalledWith(
      'button',
      { callbackData: 'opt_1:0' },
      expect.any(Function),
    );

    // Перезапуск очищает чат и шлёт restart
    act(() => {
      result.current.restart();
    });
    expect(currentSocket.emit).toHaveBeenCalledWith('restart', expect.any(Function));
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.variables).toEqual({});
    expect(onErrorBlock).toHaveBeenLastCalledWith(null);
  });

  it('при повторном подключении (reconnect) сбрасывает состояние и добавляет системное сообщение о перезапуске', () => {
    const onCurrentBlock = vi.fn();
    const onErrorBlock = vi.fn();

    const { result } = renderHook(() =>
      usePreview({
        projectId: 'proj-1',
        enabled: true,
        onCurrentBlock,
        onErrorBlock,
      }),
    );

    // Первое подключение
    act(() => {
      currentSocket.trigger('connect');
      const ack = currentSocket.emit.mock.calls[0]![2] as (res: { chatId: string }) => void;
      ack({ chatId: 'preview:proj-1:s1' });
    });

    // Получаем сообщение и переменные
    act(() => {
      currentSocket.trigger('preview', {
        type: 'message',
        message: { kind: 'text', text: 'Привет' },
      });
      currentSocket.trigger('preview', {
        type: 'variables',
        variables: { foo: 'bar' },
      });
      currentSocket.trigger('preview', {
        type: 'currentBlock',
        blockId: 'block_1',
      });
      currentSocket.trigger('preview', {
        type: 'system',
        text: 'Ошибка блока',
        blockId: 'block_err',
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.variables).toEqual({ foo: 'bar' });
    expect(result.current.currentBlockId).toBe('block_1');
    expect(result.current.errorBlockId).toBe('block_err');

    onCurrentBlock.mockClear();
    onErrorBlock.mockClear();

    // Переподключение
    act(() => {
      currentSocket.trigger('connect');
    });

    expect(result.current.variables).toEqual({});
    expect(result.current.currentBlockId).toBeNull();
    expect(result.current.errorBlockId).toBeNull();
    expect(onCurrentBlock).toHaveBeenCalledWith(null);
    expect(onErrorBlock).toHaveBeenCalledWith(null);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: 'system',
      text: ru.preview.sessionRestartedAfterReconnect,
      blockId: null,
    });
  });

  it('при разрыве соединения (disconnect) сбрасывает подсветку текущего и ошибочного блоков', () => {
    const onCurrentBlock = vi.fn();
    const onErrorBlock = vi.fn();

    const { result } = renderHook(() =>
      usePreview({
        projectId: 'proj-1',
        enabled: true,
        onCurrentBlock,
        onErrorBlock,
      }),
    );

    act(() => {
      currentSocket.trigger('connect');
      const ack = currentSocket.emit.mock.calls[0]![2] as (res: { chatId: string }) => void;
      ack({ chatId: 'preview:proj-1:s1' });
      currentSocket.trigger('preview', { type: 'currentBlock', blockId: 'block_1' });
      currentSocket.trigger('preview', {
        type: 'system',
        text: 'Ошибка блока',
        blockId: 'block_err',
      });
    });

    expect(result.current.currentBlockId).toBe('block_1');
    expect(result.current.errorBlockId).toBe('block_err');

    onCurrentBlock.mockClear();
    onErrorBlock.mockClear();

    act(() => {
      currentSocket.trigger('disconnect');
    });

    expect(result.current.status).toBe('disconnected');
    expect(result.current.currentBlockId).toBeNull();
    expect(result.current.errorBlockId).toBeNull();
    expect(onCurrentBlock).toHaveBeenCalledWith(null);
    expect(onErrorBlock).toHaveBeenCalledWith(null);
  });

  it('обрабатывает ошибки start ack, input ack, connect_error и игнорирует поздние ack после закрытия', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => usePreview({ projectId: 'proj-1', enabled }),
      { initialProps: { enabled: true } },
    );

    // Ошибка connect_error
    act(() => {
      currentSocket.trigger('connect_error');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(ru.preview.startError);

    // Ошибка start ack
    act(() => {
      currentSocket.trigger('connect');
    });
    const startAck = currentSocket.emit.mock.calls.find(([ev]) => ev === 'start')![2] as (
      res: { chatId: string } | { error: string },
    ) => void;
    act(() => {
      startAck({ error: 'forbidden' });
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('forbidden');

    // Успешный старт, затем ошибка input ack
    act(() => {
      startAck({ chatId: 'preview:proj-1:s2' });
    });
    expect(result.current.status).toBe('connected');

    act(() => {
      result.current.sendInput('привет');
    });
    const inputAck = currentSocket.emit.mock.calls.find(([ev]) => ev === 'input')![2] as (
      res: { ok: true } | { error: string },
    ) => void;
    act(() => {
      inputAck({ error: 'Сеанс превью не запущен' });
    });
    expect(result.current.error).toBe('Сеанс превью не запущен');

    // Закрытие и повторное открытие: поздний ack от старого сокета игнорируется
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => {
      startAck({ error: 'stale-error' });
      inputAck({ error: 'stale-input-error' });
    });
    expect(result.current.status).toBe('connecting');
    expect(result.current.error).toBeNull();
  });
});
