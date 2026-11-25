import { describe, expect, it } from 'vitest';
import { getOutputs } from './outputs';
import type { Block } from './blocks';

describe('getOutputs', () => {
  it('возвращает ["default"] для ENTRY_POINT', () => {
    const block: Block = {
      id: 'b1',
      type: 'ENTRY_POINT',
      title: 'Старт',
      x: 0,
      y: 0,
    };
    expect(getOutputs(block)).toEqual(['default']);
  });

  it('возвращает [] для EXIT_POINT', () => {
    const block: Block = {
      id: 'b2',
      type: 'EXIT_POINT',
      title: 'Конец',
      x: 100,
      y: 0,
    };
    expect(getOutputs(block)).toEqual([]);
  });

  it('возвращает ["default"] для TEXT_MESSAGE', () => {
    const block: Block = {
      id: 'b3',
      type: 'TEXT_MESSAGE',
      title: 'Приветствие',
      x: 200,
      y: 0,
      text: 'Здравствуйте!',
    };
    expect(getOutputs(block)).toEqual(['default']);
  });

  it('возвращает ["default"] для TEXT_INPUT', () => {
    const block: Block = {
      id: 'b4',
      type: 'TEXT_INPUT',
      title: 'ФИО',
      x: 300,
      y: 0,
      question: 'Как вас зовут?',
      variableName: 'fio',
    };
    expect(getOutputs(block)).toEqual(['default']);
  });

  it('возвращает список options для OPTION_CHOICE', () => {
    const block: Block = {
      id: 'b5',
      type: 'OPTION_CHOICE',
      title: 'Подтверждение',
      x: 400,
      y: 0,
      question: 'Подтвердить запись?',
      options: ['Да', 'Нет'],
      variableName: 'confirm',
    };
    expect(getOutputs(block)).toEqual(['Да', 'Нет']);
  });

  it('возвращает ["default", "noOptions"] для LIST_CHOICE', () => {
    const block: Block = {
      id: 'b6',
      type: 'LIST_CHOICE',
      title: 'Выбор слота',
      x: 500,
      y: 0,
      question: 'Выберите время',
      listVariable: 'slots',
      labelField: 'time',
      valueField: 'id',
      variableName: 'selectedSlot',
    };
    expect(getOutputs(block)).toEqual(['default', 'noOptions']);
  });

  it('возвращает ["default"] для ASSIGNMENT', () => {
    const block: Block = {
      id: 'b7',
      type: 'ASSIGNMENT',
      title: 'Счётчик',
      x: 600,
      y: 0,
      variableName: 'tries',
      expression: 'tries + 1',
    };
    expect(getOutputs(block)).toEqual(['default']);
  });

  it('возвращает ["yes", "no"] для CONDITION', () => {
    const block: Block = {
      id: 'b8',
      type: 'CONDITION',
      title: 'Проверка',
      x: 700,
      y: 0,
      expression: 'tries < 3',
    };
    expect(getOutputs(block)).toEqual(['yes', 'no']);
  });

  it('возвращает [...values, "else"] для SWITCH', () => {
    const block: Block = {
      id: 'b9',
      type: 'SWITCH',
      title: 'Статус',
      x: 800,
      y: 0,
      variableName: 'status',
      values: ['new', 'booked'],
    };
    expect(getOutputs(block)).toEqual(['new', 'booked', 'else']);
  });

  it('возвращает ["success", "error"] для HTTP_REQUEST', () => {
    const block: Block = {
      id: 'b10',
      type: 'HTTP_REQUEST',
      title: 'Слоты',
      x: 900,
      y: 0,
      method: 'GET',
      url: 'https://example.com/slots',
      headers: [],
      body: '',
      variableName: 'slotsResponse',
      errorVariable: 'slotsError',
      timeoutSec: 10,
      retryCount: 2,
      retryIntervalSec: 5,
      errorStrategy: 'EXIT_ERROR',
      suspendText: null,
      responseMappings: [],
    };
    expect(getOutputs(block)).toEqual(['success', 'error']);
  });
});
