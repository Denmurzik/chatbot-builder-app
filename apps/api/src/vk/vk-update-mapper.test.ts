import { describe, expect, it } from 'vitest';
import { mapVkUpdate } from './vk-update-mapper';

describe('mapVkUpdate', () => {
  it('преобразует /start и «Начать» (в любом регистре) в START_COMMAND', () => {
    for (const text of ['/start', '  /START  ', '/start payload', 'Начать', 'начать', 'НАЧАТЬ']) {
      const res = mapVkUpdate('bot-1', {
        type: 'message_new',
        event_id: 'evt-1',
        object: {
          message: { id: 10, conversation_message_id: 20, peer_id: 2000001, from_id: 42, text },
        },
      });
      expect(res).toEqual({
        event: {
          type: 'START_COMMAND',
          channel: 'MESSENGER',
          botId: 'bot-1',
          chatId: 'vk:2000001',
          userId: 'vk:42',
        },
        jobId: 'vk-bot-1-evt-1',
      });
    }
  });

  it('преобразует обычное текстовое сообщение в TEXT_MESSAGE и использует fallback для jobId', () => {
    const res = mapVkUpdate('bot-2', {
      type: 'message_new',
      object: {
        message: { conversation_message_id: 55, peer_id: 100, from_id: 100, text: 'Привет, мир!' },
      },
    });
    expect(res).toEqual({
      event: {
        type: 'TEXT_MESSAGE',
        channel: 'MESSENGER',
        botId: 'bot-2',
        chatId: 'vk:100',
        userId: 'vk:100',
        payload: 'Привет, мир!',
      },
      jobId: 'vk-bot-2-55',
    });
  });

  it('игнорирует исходящие сообщения (out === 1) и пустой текст', () => {
    expect(
      mapVkUpdate('bot-1', {
        type: 'message_new',
        event_id: 'e1',
        object: { message: { id: 1, peer_id: 10, from_id: 10, text: 'hi', out: 1 } },
      }),
    ).toBeNull();

    expect(
      mapVkUpdate('bot-1', {
        type: 'message_new',
        event_id: 'e2',
        object: { message: { id: 2, peer_id: 10, from_id: 10, text: '   ' } },
      }),
    ).toBeNull();

    expect(
      mapVkUpdate('bot-1', {
        type: 'message_new',
        event_id: 'e3',
        object: { message: { id: 3, peer_id: 10, from_id: 10 } },
      }),
    ).toBeNull();
  });

  it('преобразует message_event с payload-объектом, JSON-строкой и сырой строкой в BUTTON_PRESS', () => {
    for (const payload of [
      { callbackData: 'block-q1:2' },
      JSON.stringify({ callbackData: 'block-q1:2' }),
      'block-q1:2',
    ]) {
      const res = mapVkUpdate('bot-3', {
        type: 'message_event',
        object: {
          user_id: 77,
          peer_id: 77,
          event_id: 'ev-btn-9',
          payload,
        },
      });
      expect(res).toEqual({
        event: {
          type: 'BUTTON_PRESS',
          channel: 'MESSENGER',
          botId: 'bot-3',
          chatId: 'vk:77',
          userId: 'vk:77',
          payload: 'block-q1:2',
          sourceBlockId: 'block-q1',
        },
        jobId: 'vk-bot-3-ev-btn-9',
      });
    }
  });

  it('игнорирует неподдерживаемые типы событий и message_event без payload', () => {
    expect(mapVkUpdate('bot-1', { type: 'wall_post_new', object: {} })).toBeNull();
    expect(
      mapVkUpdate('bot-1', {
        type: 'message_event',
        object: { user_id: 1, peer_id: 1, event_id: 'e1' },
      }),
    ).toBeNull();
  });
});
