import type { OutgoingButton } from '@chatbot/engine-core';

// Максимальная длина подписи кнопки в VK API
const VK_BUTTON_LABEL_MAX_LENGTH = 40;
// Ограничения inline-клавиатуры VK: максимум 10 кнопок и 6 рядов
const VK_INLINE_MAX_BUTTONS = 10;
const VK_INLINE_MAX_ROWS = 6;

export interface VkCallbackAction {
  type: 'callback';
  label: string;
  payload: string;
}

export interface VkKeyboardButton {
  action: VkCallbackAction;
}

export interface VkInlineKeyboard {
  inline: true;
  buttons: VkKeyboardButton[][];
}

// Проверяет, относится ли chatId к ВКонтакте (префикс vk:)
export function isVkChatId(chatId: string): boolean {
  return chatId.startsWith('vk:');
}

// chatId вида `vk:123` → положительный числовой peer_id ВКонтакте
export function parseVkChatId(chatId: string): number {
  if (!isVkChatId(chatId)) {
    throw new Error(`Некорректный chatId VK (ожидается префикс vk:): ${chatId}`);
  }
  const raw = chatId.slice(3);
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Некорректный chatId VK (ожидается положительное целое число): ${chatId}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Некорректный chatId VK (число вне безопасного диапазона): ${chatId}`);
  }
  return parsed;
}

function toVkButton(button: OutgoingButton): VkKeyboardButton {
  return {
    action: {
      type: 'callback',
      label: button.label.slice(0, VK_BUTTON_LABEL_MAX_LENGTH),
      payload: JSON.stringify({ callbackData: button.callbackData }),
    },
  };
}

// Кнопки вопроса → inline-клавиатура VK с соблюдением лимитов (до 10 кнопок, до 6 рядов)
export function toVkInlineKeyboard(buttons: readonly OutgoingButton[]): VkInlineKeyboard {
  const limited = buttons.slice(0, VK_INLINE_MAX_BUTTONS);
  if (limited.length <= VK_INLINE_MAX_ROWS) {
    return {
      inline: true,
      buttons: limited.map((button) => [toVkButton(button)]),
    };
  }
  // При 7..10 кнопках раскладываем по 2 в ряд (4..5 рядов ≤ 6)
  const rows: VkKeyboardButton[][] = [];
  for (let i = 0; i < limited.length; i += 2) {
    rows.push(limited.slice(i, i + 2).map(toVkButton));
  }
  return { inline: true, buttons: rows };
}
