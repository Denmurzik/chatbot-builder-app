import { useRef, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { useInsertRegistry } from './insert-target';

interface InsertableInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  // replace — «Вставить» заменяет всё значение (имя переменной); cursor — вставляет в позицию курсора
  insertMode?: 'replace' | 'cursor';
  // Поле ещё существует (для строк конструктора, которые могут исчезнуть)
  isAlive?: () => boolean;
}

// Обычное поле, которое становится целью «Вставить» из колонки «Вход», пока в нём фокус
export function InsertableInput({
  value,
  onValueChange,
  insertMode = 'replace',
  isAlive,
  onFocus,
  ...props
}: InsertableInputProps) {
  const { setTarget } = useInsertRegistry();
  // Всегда актуальные значение и обработчик: цель вставки живёт дольше одного рендера
  const latest = useRef({ value, onValueChange, isAlive });
  latest.current = { value, onValueChange, isAlive };

  return (
    <Input
      {...props}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onFocus={(event) => {
        onFocus?.(event);
        const element = event.currentTarget;
        setTarget({
          kind: 'variable',
          isAlive: () => element.isConnected && (latest.current.isAlive?.() ?? true),
          insert: (name) => {
            const current = latest.current.value;
            if (insertMode === 'replace') {
              latest.current.onValueChange(name);
              return;
            }
            const from = element.selectionStart ?? current.length;
            const to = element.selectionEnd ?? from;
            latest.current.onValueChange(current.slice(0, from) + name + current.slice(to));
          },
        });
      }}
    />
  );
}
