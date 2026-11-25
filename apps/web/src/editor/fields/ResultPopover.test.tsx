import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultPopover, computeResult } from './ResultPopover';

describe('ResultPopover', () => {
  afterEach(cleanup);

  it('шаблон «Привет, {{name}}» при name=Аня даёт «Привет, Аня» и подсвечивает подстановку', () => {
    const { container } = render(
      <ResultPopover kind="template" value="Привет, {{name}}" testValues={{ name: 'Аня' }} />,
    );
    expect(screen.getByText('Результат')).toBeTruthy();
    expect(screen.getByTestId('result-value').textContent).toBe('Привет, Аня');
    expect(container.querySelector('.cm-result-sub')?.textContent).toBe('Аня');
  });

  it('выражение «tries < 3» при tries=1 показывает «да»', () => {
    render(<ResultPopover kind="value" value="tries < 3" testValues={{ tries: '1' }} />);
    expect(screen.getByTestId('result-value').textContent).toBe('да');
  });

  it('для условия показывает, какой выход сработает', () => {
    render(<ResultPopover kind="condition" value="tries < 3" testValues={{ tries: '5' }} />);
    expect(screen.getByTestId('result-value').textContent).toBe('нет');
    expect(screen.getByText(/Сработает выход: Нет/)).toBeTruthy();
  });

  it('ошибка синтаксиса показывается по-русски', () => {
    render(<ResultPopover kind="value" value="a +" testValues={{ a: '1' }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/[А-Яа-яЁё]/);
  });

  it('переменная без тестового значения помечается серым «нет тестового значения»', () => {
    render(<ResultPopover kind="template" value="Привет, {{name}}" testValues={{}} />);
    expect(screen.getByText('нет тестового значения')).toBeTruthy();
  });

  it('выражение с переменной без тестового значения не вычисляется', () => {
    render(<ResultPopover kind="value" value="tries < 3" testValues={{}} />);
    expect(screen.getByText(/нет тестового значения: tries/)).toBeTruthy();
  });

  it('{{env.X}} в шаблоне: «подставится из окружения при запуске», не «нет тестового значения»', () => {
    render(<ResultPopover kind="template" value="Ключ {{env.API_KEY}}" testValues={{}} />);
    expect(screen.getByText('подставится из окружения при запуске')).toBeTruthy();
    expect(screen.queryByText('нет тестового значения')).toBeNull();
  });

  it('{{env.X}} в выражении не вычисляется и не считается отсутствующим значением', () => {
    render(<ResultPopover kind="value" value={'{{env.MODE}} == "a"'} testValues={{}} />);
    expect(screen.getByText('подставится из окружения при запуске')).toBeTruthy();
  });

  it('с anchor блок рисуется в портале на body, а не внутри поля', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const { container } = render(
      <div>
        <ResultPopover
          anchor={{ current: anchor }}
          kind="template"
          value="Привет"
          testValues={{}}
        />
      </div>,
    );
    const value = screen.getByTestId('result-value');
    expect(container.contains(value)).toBe(false);
    expect(document.body.contains(value)).toBe(true);
    anchor.remove();
  });

  it('computeResult: числовое выражение', () => {
    expect(computeResult('value', 'tries + 1', { tries: '2' }).text).toBe('3');
  });
});
