import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ENV_VAR_NAME_PATTERN, type EnvVarInput, type EnvVarView } from '@chatbot/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';

interface Row {
  key: number;
  name: string;
  secret: boolean;
  value: string;
  // Маска сохранённого секрета; пока она есть и значение не заменяется, секрет не трогаем
  mask: string | null;
  replacing: boolean;
}

function toRows(value: EnvVarView[], nextKey: () => number): Row[] {
  return value.map((item) =>
    item.secret
      ? { key: nextKey(), name: item.name, secret: true, value: '', mask: item.mask, replacing: false }
      : { key: nextKey(), name: item.name, secret: false, value: item.value, mask: null, replacing: false },
  );
}

type RowErrors = Partial<Record<'name' | 'value', string>>;

function validate(rows: Row[]): Map<number, RowErrors> {
  const errors = new Map<number, RowErrors>();
  const seen = new Set<string>();
  for (const row of rows) {
    const rowErrors: RowErrors = {};
    if (!ENV_VAR_NAME_PATTERN.test(row.name)) rowErrors.name = ru.environment.nameInvalid;
    else if (seen.has(row.name)) rowErrors.name = ru.environment.nameDuplicate;
    seen.add(row.name);
    const needsValue = row.secret && (row.mask === null || row.replacing);
    if (needsValue && row.value === '') rowErrors.value = ru.environment.secretRequired;
    // Сохранённый секрет, ставший обычной переменной: прежнее значение недоступно, нужно новое
    if (!row.secret && row.mask !== null && row.value === '') {
      rowErrors.value = ru.environment.valueRequired;
    }
    if (rowErrors.name || rowErrors.value) errors.set(row.key, rowErrors);
  }
  return errors;
}

function toInput(row: Row): EnvVarInput {
  if (!row.secret) return { name: row.name, secret: false, value: row.value };
  if (row.mask !== null && !row.replacing) return { name: row.name, secret: true };
  return { name: row.name, secret: true, value: row.value };
}

// Редактор переменных окружения: имя / значение / секрет. Значение сохранённого секрета не показывается
export function EnvironmentEditor(props: {
  value: EnvVarView[];
  onSave: (input: EnvVarInput[]) => void | Promise<unknown>;
  saving?: boolean;
  // Сообщение сервера об ошибке сохранения
  error?: string | null;
}) {
  const counter = useRef(0);
  const nextKey = () => (counter.current += 1);
  const [rows, setRows] = useState<Row[]>(() => toRows(props.value, nextKey));
  const [errors, setErrors] = useState<Map<number, RowErrors>>(new Map());

  // Перечитываем строки, когда сохранённое окружение действительно изменилось
  const signature = JSON.stringify(props.value);
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setRows(toRows(props.value, nextKey));
    setErrors(new Map());
  }, [signature]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = () => {
    const found = validate(rows);
    setErrors(found);
    if (found.size > 0) return;
    void props.onSave(rows.map(toInput));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{ru.environment.hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ru.environment.empty}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const rowErrors = errors.get(row.key);
          const saved = row.mask !== null;
          return (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex flex-col gap-2 rounded-md border p-2.5 sm:flex-row sm:items-center sm:border-0 sm:p-0">
                <Input
                  className="font-mono sm:min-w-0 sm:flex-1"
                  aria-label={ru.environment.name}
                  placeholder={ru.environment.name}
                  value={row.name}
                  disabled={saved}
                  aria-invalid={rowErrors?.name ? true : undefined}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                />
                {row.secret && saved && !row.replacing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      readOnly
                      className="min-w-0 flex-1 bg-muted font-mono text-muted-foreground"
                      aria-label={`${ru.environment.value} ${row.name}`}
                      value={row.mask ?? ''}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 sm:h-9"
                      onClick={() => update(row.key, { replacing: true })}
                    >
                      {ru.environment.replace}
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      aria-label={`${ru.environment.value} ${row.name}`}
                      placeholder={ru.environment.value}
                      type={row.secret ? 'password' : 'text'}
                      autoComplete="off"
                      value={row.value}
                      aria-invalid={rowErrors?.value ? true : undefined}
                      onChange={(event) => update(row.key, { value: event.target.value })}
                    />
                    {saved && row.secret ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 sm:h-9"
                        onClick={() => update(row.key, { replacing: false, secret: true, value: '' })}
                      >
                        {ru.environment.cancelReplace}
                      </Button>
                    ) : null}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-start">
                  <label className="flex shrink-0 items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      aria-label={ru.environment.secret}
                      checked={row.secret}
                      onChange={(event) =>
                        update(
                          row.key,
                          saved
                            ? { secret: event.target.checked, replacing: false, value: '' }
                            : { secret: event.target.checked },
                        )
                      }
                    />
                    {ru.environment.secret}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={ru.environment.remove}
                    title={ru.environment.remove}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {rowErrors?.name ? (
                <p className="text-sm text-destructive">{rowErrors.name}</p>
              ) : null}
              {rowErrors?.value ? (
                <p className="text-sm text-destructive">{rowErrors.value}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: nextKey(), name: '', secret: false, value: '', mask: null, replacing: false },
            ])
          }
        >
          <Plus />
          {ru.environment.add}
        </Button>
        <Button type="button" onClick={submit} disabled={props.saving}>
          {props.saving ? ru.environment.saving : ru.environment.save}
        </Button>
      </div>
    </div>
  );
}
