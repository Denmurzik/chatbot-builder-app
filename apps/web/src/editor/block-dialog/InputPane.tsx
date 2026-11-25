import type { AvailableVariable } from '@chatbot/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';
import { useInsertRegistry } from './insert-target';

const t = ru.blockDialog;

interface InputPaneProps {
  variables: AvailableVariable[];
  // Название блока-источника по id
  titles: Map<string, string>;
  testValues: Record<string, string>;
  onTestValueChange: (name: string, value: string) => void;
}

// Левая колонка: переменные, доступные в блоке, и их тестовые значения
export function InputPane({ variables, titles, testValues, onTestValueChange }: InputPaneProps) {
  const { target, setTarget } = useInsertRegistry();

  const insert = (name: string) => {
    if (!target) return;
    if (!target.isAlive()) {
      setTarget(null);
      return;
    }
    target.insert(name);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t.inputHint}</p>
      {variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.inputEmpty}</p>
      ) : (
        <>
          {!target && <p className="text-xs text-muted-foreground">{t.insertHint}</p>}
          <ul className="flex flex-col gap-3">
            {variables.map((variable) => (
              <li key={variable.name} className="flex flex-col gap-1.5 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate rounded bg-muted px-1.5 py-0.5 text-sm">
                    {variable.name}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!target}
                    aria-label={`${t.insert} ${variable.name}`}
                    // mousedown не должен уводить фокус из поля настроек
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insert(variable.name)}
                  >
                    {t.insert}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.fromBlock(titles.get(variable.sourceBlockId) ?? variable.sourceBlockId)}
                </p>
                <Input
                  placeholder={t.testValue}
                  aria-label={`${t.testValue}: ${variable.name}`}
                  value={testValues[variable.name] ?? ''}
                  onChange={(event) => onTestValueChange(variable.name, event.target.value)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
