import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnvVarView } from '@chatbot/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { EnvironmentEditor } from './EnvironmentEditor';

const value: EnvVarView[] = [
  { name: 'API_URL', secret: false, value: 'https://x.test' },
  { name: 'API_KEY', secret: true, mask: '••••1234' },
];

describe('EnvironmentEditor', () => {
  afterEach(cleanup);

  it('показывает маску вместо секрета и кнопку «Заменить»', () => {
    render(<EnvironmentEditor value={value} onSave={vi.fn()} />);
    const field = screen.getByLabelText(`${ru.environment.value} API_KEY`) as HTMLInputElement;
    expect(field.value).toBe('••••1234');
    expect(field.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: ru.environment.replace })).toBeTruthy();
  });

  it('нетронутый секрет уходит без value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={value} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(onSave).toHaveBeenCalledWith([
      { name: 'API_URL', secret: false, value: 'https://x.test' },
      { name: 'API_KEY', secret: true },
    ]);
  });

  it('заменённый секрет уходит с новым value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={value} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: ru.environment.replace }));
    await user.type(screen.getByLabelText(`${ru.environment.value} API_KEY`), 'new-secret');
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(onSave).toHaveBeenCalledWith([
      { name: 'API_URL', secret: false, value: 'https://x.test' },
      { name: 'API_KEY', secret: true, value: 'new-secret' },
    ]);
  });

  it('проверяет имя до отправки', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={[]} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: ru.environment.add }));
    await user.type(screen.getByLabelText(ru.environment.name), 'bad name');
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(screen.getByText(ru.environment.nameInvalid)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('блокирует повторяющееся имя', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={[{ name: 'A', secret: false, value: '1' }]} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: ru.environment.add }));
    const names = screen.getAllByLabelText(ru.environment.name);
    await user.type(names[1]!, 'A');
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(screen.getByText(ru.environment.nameDuplicate)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('«Оставить прежнее» возвращает маску', async () => {
    const user = userEvent.setup();
    render(<EnvironmentEditor value={value} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: ru.environment.replace }));
    await user.click(screen.getByRole('button', { name: ru.environment.cancelReplace }));
    const field = screen.getByLabelText(`${ru.environment.value} API_KEY`) as HTMLInputElement;
    expect(field.value).toBe('••••1234');
    expect(screen.getByRole('button', { name: ru.environment.replace })).toBeTruthy();
  });

  it('флажок «Секрет» на новой строке скрывает ввод значения', async () => {
    const user = userEvent.setup();
    render(<EnvironmentEditor value={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: ru.environment.add }));
    const input = screen.getByLabelText(ru.environment.value) as HTMLInputElement;
    expect(input.type).toBe('text');
    await user.click(screen.getByLabelText(ru.environment.secret));
    expect(input.type).toBe('password');
  });

  it('сохранённый секрет можно сделать обычной переменной, но нужно новое значение', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={[value[1]!]} onSave={onSave} />);
    await user.click(screen.getByLabelText(ru.environment.secret));
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(screen.getByText(ru.environment.valueRequired)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(`${ru.environment.value} API_KEY`), 'plain');
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(onSave).toHaveBeenCalledWith([{ name: 'API_KEY', secret: false, value: 'plain' }]);
  });

  it('требует значение у нового секрета', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentEditor value={[]} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: ru.environment.add }));
    await user.type(screen.getByLabelText(ru.environment.name), 'TOKEN');
    await user.click(screen.getByLabelText(ru.environment.secret));
    await user.click(screen.getByRole('button', { name: ru.environment.save }));
    expect(screen.getByText(ru.environment.secretRequired)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
