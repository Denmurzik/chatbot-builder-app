import { describe, expect, it } from 'vitest';
import { mapUpdate } from './update-mapper';

const chat = { id: 555, type: 'private' as const, first_name: 'A' };
const from = { id: 777, is_bot: false, first_name: 'A' };

describe('mapUpdate', () => {
  it('текстовое сообщение -> TEXT_MESSAGE с префиксами tg:', () => {
    const r = mapUpdate('bot1', {
      update_id: 10,
      message: { message_id: 1, date: 0, chat, from, text: 'привет' },
    });
    expect(r).toEqual({
      event: {
        type: 'TEXT_MESSAGE',
        channel: 'MESSENGER',
        botId: 'bot1',
        chatId: 'tg:555',
        userId: 'tg:777',
        payload: 'привет',
      },
      jobId: 'tg-bot1-10',
    });
  });

  it('/start -> START_COMMAND (в том числе с параметром)', () => {
    for (const text of ['/start', '/start ref123']) {
      const r = mapUpdate('bot1', {
        update_id: 11,
        message: { message_id: 1, date: 0, chat, from, text },
      });
      expect(r?.event.type).toBe('START_COMMAND');
    }
  });

  it('другая команда, начинающаяся похоже (/starting), остаётся текстом', () => {
    const r = mapUpdate('bot1', {
      update_id: 12,
      message: { message_id: 1, date: 0, chat, from, text: '/starting' },
    });
    expect(r?.event.type).toBe('TEXT_MESSAGE');
  });

  it('нажатие кнопки -> BUTTON_PRESS, sourceBlockId — часть до двоеточия', () => {
    const r = mapUpdate('bot1', {
      update_id: 13,
      callback_query: {
        id: 'cb',
        from,
        chat_instance: 'x',
        data: 'choice_1:2',
        message: { message_id: 5, date: 0, chat },
      },
    });
    expect(r).toEqual({
      event: {
        type: 'BUTTON_PRESS',
        channel: 'MESSENGER',
        botId: 'bot1',
        chatId: 'tg:555',
        userId: 'tg:777',
        payload: 'choice_1:2',
        sourceBlockId: 'choice_1',
      },
      jobId: 'tg-bot1-13',
    });
  });

  it('фото без подписи -> TEXT_MESSAGE с пустым payload', () => {
    const r = mapUpdate('bot1', {
      update_id: 14,
      message: {
        message_id: 1,
        date: 0,
        chat,
        from,
        photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }],
      },
    });
    expect(r?.event.type).toBe('TEXT_MESSAGE');
    expect(r?.event.payload).toBe('');
  });

  it('неподдерживаемые обновления и кнопка без message -> null', () => {
    expect(
      mapUpdate('bot1', {
        update_id: 15,
        edited_message: { message_id: 1, date: 0, chat, from, text: 'x' },
      }),
    ).toBeNull();
    expect(
      mapUpdate('bot1', {
        update_id: 16,
        callback_query: { id: 'cb', from, chat_instance: 'x', data: 'a:1' },
      }),
    ).toBeNull();
  });

  it('некорректные обновления без chat или from -> null без TypeError', () => {
    expect(
      mapUpdate('bot1', {
        update_id: 17,
        message: { message_id: 1, date: 0, from, text: 'привет' } as never,
      }),
    ).toBeNull();
    expect(
      mapUpdate('bot1', {
        update_id: 18,
        message: { message_id: 1, date: 0, chat, text: 'привет' } as never,
      }),
    ).toBeNull();
    expect(
      mapUpdate('bot1', {
        update_id: 19,
        callback_query: {
          id: 'cb',
          from,
          chat_instance: 'x',
          data: 'a:1',
          message: { message_id: 5, date: 0 } as never,
        },
      }),
    ).toBeNull();
    expect(
      mapUpdate('bot1', {
        update_id: 20,
        callback_query: {
          id: 'cb',
          chat_instance: 'x',
          data: 'a:1',
          message: { message_id: 5, date: 0, chat },
        } as never,
      }),
    ).toBeNull();
  });
});
