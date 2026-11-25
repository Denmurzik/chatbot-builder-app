import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { BLOCK_META } from '../block-meta';
import type { BlockNodeData } from '../convert';
import { setupCodeMirrorJsdom } from '../fields/cm-test-setup';
import { SettingsPane } from './SettingsPane';

beforeAll(() => {
  setupCodeMirrorJsdom();
});

function httpData(method: 'GET' | 'POST', retryCount: number): BlockNodeData {
  const base = BLOCK_META.HTTP_REQUEST.defaults();
  if (base.type !== 'HTTP_REQUEST') throw new Error('ожидался HTTP_REQUEST');
  return { ...base, method, retryCount };
}

function renderPane(data: BlockNodeData, onChange = vi.fn(), variables: string[] = []) {
  return render(<SettingsPane data={data} onChange={onChange} variables={variables} />);
}

describe('SettingsPane', () => {
  afterEach(cleanup);

  it('предупреждение о повторах показано для POST с retryCount > 0', () => {
    renderPane(httpData('POST', 2));
    expect(screen.getByText(/Повторы для POST, PUT и PATCH небезопасны/)).toBeTruthy();
  });

  it('предупреждения нет для GET и для POST без повторов', () => {
    const { rerender } = renderPane(httpData('GET', 2));
    expect(screen.queryByText(/Повторы для POST/)).toBeNull();
    rerender(<SettingsPane data={httpData('POST', 0)} onChange={vi.fn()} variables={[]} />);
    expect(screen.queryByText(/Повторы для POST/)).toBeNull();
  });

  it('повторяющийся вариант показывает ошибку рядом с полем', () => {
    renderPane(BLOCK_META.OPTION_CHOICE.defaults());
    fireEvent.change(screen.getByDisplayValue(/Да/), { target: { value: 'Да\nДа' } });
    expect(screen.getByText('Повторяющееся значение: «Да»')).toBeTruthy();
  });

  it('пустые строки в списке вариантов не показываются ошибкой и убираются при потере фокуса', () => {
    const onChange = vi.fn();
    renderPane(BLOCK_META.OPTION_CHOICE.defaults(), onChange);
    const field = screen.getByRole('textbox', { name: ru.fields.options }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Да\n\n\nНет' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field.value).toBe('Да\n\n\nНет');
    fireEvent.blur(field);
    expect(field.value).toBe('Да\nНет');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: ['Да', 'Нет'] }));
  });

  it('подписи полей связаны с полями (htmlFor и aria-labelledby)', () => {
    renderPane(BLOCK_META.TEXT_INPUT.defaults());
    const question = screen.getByLabelText(ru.fields.question);
    expect(question).toBeTruthy();
    const name = screen.getByLabelText(ru.fields.variableName);
    expect(name.tagName).toBe('INPUT');
    // Поле CodeMirror получает имя через aria-labelledby
    const labelled = document.querySelector('[aria-labelledby]');
    expect(labelled).toBeTruthy();
    expect(document.getElementById(labelled!.getAttribute('aria-labelledby')!)?.textContent).toBe(
      ru.fields.question,
    );
  });

  it('значение «else» в переключателе показывает ошибку', () => {
    renderPane(BLOCK_META.SWITCH.defaults());
    fireEvent.change(screen.getByDisplayValue(/значение1/), { target: { value: 'else' } });
    expect(screen.getByText('Значение «else» зарезервировано')).toBeTruthy();
  });

  it('тайм-аут 0 показывает ошибку', () => {
    renderPane({ ...httpData('GET', 0), timeoutSec: 0 } as BlockNodeData);
    expect(screen.getByText('Значение должно быть не меньше 1')).toBeTruthy();
  });

  it('числовое поле можно очистить', () => {
    renderPane(httpData('GET', 0));
    const input = screen.getByDisplayValue('10') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
  });

  it('секретный заголовок с secretValue показывает маску как placeholder и пустое поле значения', () => {
    const onChange = vi.fn();
    const base = httpData('GET', 0);
    if (base.type !== 'HTTP_REQUEST') throw new Error('ожидался HTTP_REQUEST');
    renderPane(
      {
        ...base,
        headers: [
          {
            name: 'Authorization',
            value: '',
            secret: true,
            secretValue: { cipherText: 'v1:iv:tag:ct', mask: '••••ijkl' },
          },
        ],
      },
      onChange,
    );
    const input = screen.getByPlaceholderText('••••ijkl') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'Bearer new-secret-token' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [
          expect.objectContaining({
            name: 'Authorization',
            value: 'Bearer new-secret-token',
            secret: true,
          }),
        ],
      }),
    );
  });

  it('секретный заголовок с secretMask (без secretValue) показывает маску, сохраняет её при пустом значении и сбрасывает при отключении флага', () => {
    const onChange = vi.fn();
    const base = httpData('GET', 0);
    if (base.type !== 'HTTP_REQUEST') throw new Error('ожидался HTTP_REQUEST');
    renderPane(
      {
        ...base,
        headers: [
          {
            name: 'X-Api-Key',
            value: '',
            secret: true,
            secretMask: '••••9876',
          },
        ],
      },
      onChange,
    );

    // Маска показывается как placeholder, поле значения пустое
    const valueInput = screen.getByPlaceholderText('••••9876') as HTMLInputElement;
    expect(valueInput.value).toBe('');

    // Изменение имени заголовка при пустом value сохраняет secretMask
    const nameInput = screen.getByDisplayValue('X-Api-Key') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'X-Auth-Key' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: [
          expect.objectContaining({
            name: 'X-Auth-Key',
            value: '',
            secret: true,
            secretMask: '••••9876',
          }),
        ],
      }),
    );

    // Ввод нового значения передаётся в onChange для перешифрования на сервере
    fireEvent.change(valueInput, { target: { value: 'new-key-value' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: [
          expect.objectContaining({
            name: 'X-Api-Key',
            value: 'new-key-value',
            secret: true,
          }),
        ],
      }),
    );

    // Снятие флага secret очищает secretMask и secretValue
    const secretCheckbox = screen.getByLabelText(ru.fields.headerSecret) as HTMLInputElement;
    fireEvent.click(secretCheckbox);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: [
          expect.objectContaining({
            name: 'X-Api-Key',
            secret: false,
            secretMask: undefined,
            secretValue: undefined,
          }),
        ],
      }),
    );
  });

  it('поля сгруппированы по смыслу', () => {
    renderPane(httpData('GET', 0));
    for (const name of ['Запрос', 'Разбор ответа', 'Повторы и ошибки']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
  });

  it('недопустимое имя переменной показывает подсказку «латиница, цифры, _»', () => {
    const data = { ...BLOCK_META.TEXT_INPUT.defaults(), variableName: 'имя' } as BlockNodeData;
    renderPane(data);
    expect(screen.getByText(/латиница, цифры и _/)).toBeTruthy();
  });

  it('переменная со списком показывает ошибку рядом с полем', () => {
    const data = { ...BLOCK_META.LIST_CHOICE.defaults(), listVariable: 'список' } as BlockNodeData;
    renderPane(data);
    expect(screen.getByText(/латиница, цифры и _/)).toBeTruthy();
  });

  it('у «Присваивания» есть подсказка с примерами выражений', () => {
    renderPane(BLOCK_META.ASSIGNMENT.defaults());
    expect(screen.getByText(/tries \+ 1/)).toBeTruthy();
  });
});
