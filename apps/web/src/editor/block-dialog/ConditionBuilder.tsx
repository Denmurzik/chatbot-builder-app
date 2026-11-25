import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ru } from '@/i18n/ru';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExpressionInput } from '../fields/ExpressionInput';
import { expressionIssue } from '../validate';
import {
  conditionToExpression,
  emptyCondition,
  expressionToCondition,
  isPlainNumber,
  type ConditionJoin,
  type ConditionModel,
  type ConditionOperator,
  type ConditionRow,
} from './condition-model';
import { InsertableInput } from './InsertableInput';
import { useCodeMirrorInsertTarget, useInsertRegistry } from './insert-target';

const t = ru.condition;

const OPERATOR_GROUPS: { label: string; operators: ConditionOperator[] }[] = [
  { label: t.groups.compare, operators: ['eq', 'neq'] },
  { label: t.groups.number, operators: ['gt', 'lt', 'gte', 'lte'] },
  { label: t.groups.empty, operators: ['empty', 'notEmpty'] },
];

// Выпадающий список shadcn (Radix): темы оформления применяются и к списку; пункты — группами
function GroupedSelect({
  value,
  onValueChange,
  groups,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  groups: { label?: string; options: { value: string; label: string }[] }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group, index) => (
          <SelectGroup key={group.label ?? index}>
            {group.label && <SelectLabel>{group.label}</SelectLabel>}
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const OPERATOR_SELECT_GROUPS = OPERATOR_GROUPS.map((group) => ({
  label: group.label,
  options: group.operators.map((op) => ({ value: op, label: t.operators[op] })),
}));

const JOIN_SELECT_GROUPS = [
  {
    options: [
      { value: 'and', label: t.all },
      { value: 'or', label: t.any },
    ],
  },
];

const NUMERIC_OPERATORS: ConditionOperator[] = ['gt', 'lt', 'gte', 'lte'];

// Переменная в строке: имя из доступных блоков или ссылка {{env.ИМЯ}}
function isKnownVariable(name: string, variables: string[]): boolean {
  return name === '' || name.startsWith('{{env.') || variables.includes(name);
}

function RowEditor({
  row,
  index,
  variables,
  listId,
  canRemove,
  isAlive,
  onChange,
  onRemove,
}: {
  row: ConditionRow;
  index: number;
  variables: string[];
  listId: string;
  canRemove: boolean;
  isAlive: () => boolean;
  onChange: (patch: Partial<ConditionRow>) => void;
  onRemove: () => void;
}) {
  const needsValue = row.op !== 'empty' && row.op !== 'notEmpty';
  const unknown = !isKnownVariable(row.variable.trim(), variables);
  // Движок сравнивает числа, только если обе стороны числа; иначе — строки
  const stringCompare =
    NUMERIC_OPERATORS.includes(row.op) && row.value.trim() !== '' && !isPlainNumber(row.value);
  return (
    <div className="flex flex-col gap-1" data-testid="condition-row">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-2 sm:flex-nowrap sm:rounded-none sm:border-0 sm:p-0">
        <InsertableInput
          className="min-w-0 flex-1 basis-[calc(50%-0.25rem)] sm:basis-auto"
          list={listId}
          placeholder={t.variable}
          aria-label={`${t.variable} ${index + 1}`}
          value={row.variable}
          isAlive={isAlive}
          onValueChange={(variable) => onChange({ variable })}
        />
        <GroupedSelect
          ariaLabel={`${t.operator} ${index + 1}`}
          value={row.op}
          groups={OPERATOR_SELECT_GROUPS}
          className="max-w-full"
          onValueChange={(op) => onChange({ op: op as ConditionOperator })}
        />
        {needsValue ? (
          <InsertableInput
            className="min-w-0 flex-1 basis-[calc(100%-2.75rem)] sm:basis-auto"
            placeholder={t.value}
            aria-label={`${t.value} ${index + 1}`}
            value={row.value}
            insertMode="cursor"
            isAlive={isAlive}
            onValueChange={(value) => onChange({ value })}
          />
        ) : (
          <span className="hidden flex-1 sm:inline" />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t.remove}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {stringCompare && (
        <p role="status" className="flex items-start gap-1.5 text-xs text-amber-600">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {t.stringCompare}
        </p>
      )}
      {unknown && (
        <p role="status" className="flex items-start gap-1.5 text-xs text-amber-600">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {t.unknownVariable(row.variable.trim())}
        </p>
      )}
    </div>
  );
}

interface ConditionFieldProps {
  expression: string;
  onChange: (expression: string) => void;
  variables: string[];
}

// Условие: переключатель «Конструктор / Выражение» (как «Fixed / Expression» в n8n)
export function ConditionBuilder({ expression, onChange, variables }: ConditionFieldProps) {
  const listId = useId();
  const initial = expressionToCondition(expression);
  const [model, setModel] = useState<ConditionModel>(() => initial ?? emptyCondition());
  const [mode, setMode] = useState<'builder' | 'expression'>(initial ? 'builder' : 'expression');
  // Свежая модель для обработчиков, живущих дольше рендера (цель «Вставить»)
  const modelRef = useRef(model);
  // Стабильные id строк (только для интерфейса): ключи React и «жива ли строка» для цели «Вставить»
  const idsRef = useRef<string[]>([]);
  const nextIdRef = useRef(0);
  const newId = () => `row-${nextIdRef.current++}`;
  if (idsRef.current.length === 0) idsRef.current = initial ? initial.rows.map(newId) : [newId()];
  const { target, setTarget } = useInsertRegistry();
  const onCreateEditor = useCodeMirrorInsertTarget('expression');

  const commit = (next: ConditionModel) => {
    modelRef.current = next;
    setModel(next);
    onChange(conditionToExpression(next));
  };
  // Правка от свежей модели, а не от модели рендера, в котором создан обработчик
  const update = (change: (prev: ConditionModel) => ConditionModel) =>
    commit(change(modelRef.current));

  // Выражение изменили снаружи (например, отмена): пересобираем конструктор
  useEffect(() => {
    if (mode !== 'builder' || expression === conditionToExpression(modelRef.current)) return;
    const next = expressionToCondition(expression);
    if (next) {
      modelRef.current = next;
      idsRef.current = next.rows.map(newId);
      setModel(next);
    } else {
      setMode('expression');
    }
  }, [expression, mode]);

  // Из режима «Выражение» в конструктор можно перейти, только если выражение в него укладывается
  const parsed = mode === 'expression' ? expressionToCondition(expression) : model;
  const canUseBuilder = parsed !== null;

  const switchMode = (next: 'builder' | 'expression') => {
    if (next === mode) return;
    if (next === 'builder') {
      if (!parsed) return;
      modelRef.current = parsed;
      idsRef.current = parsed.rows.map(newId);
      setModel(parsed);
    }
    setMode(next);
  };

  const builderIssue = mode === 'builder' ? expressionIssue(conditionToExpression(model)) : null;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={t.modeLabel}
        className="inline-flex self-start rounded-md border p-0.5"
      >
        <Button
          type="button"
          size="sm"
          variant={mode === 'builder' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'builder'}
          disabled={!canUseBuilder}
          title={canUseBuilder ? undefined : t.notRepresentable}
          onClick={() => switchMode('builder')}
        >
          {t.builder}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'expression' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'expression'}
          onClick={() => switchMode('expression')}
        >
          {t.expression}
        </Button>
      </div>
      {!canUseBuilder && mode === 'expression' && (
        <p className="text-xs text-muted-foreground">{t.notRepresentable}</p>
      )}
      {mode === 'builder' ? (
        <div className="flex flex-col gap-2">
          <datalist id={listId}>
            {variables.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {model.rows.map((row, index) => {
            const rowId = idsRef.current[index]!;
            return (
              <RowEditor
                key={rowId}
                row={row}
                index={index}
                variables={variables}
                listId={listId}
                canRemove={model.rows.length > 1}
                isAlive={() => idsRef.current.includes(rowId)}
                onChange={(patch) =>
                  update((prev) => {
                    // Строку ищем по id, а не по номеру: после удаления соседних номера сдвигаются
                    const at = idsRef.current.indexOf(rowId);
                    return at === -1
                      ? prev
                      : {
                          ...prev,
                          rows: prev.rows.map((r, i) => (i === at ? { ...r, ...patch } : r)),
                        };
                  })
                }
                onRemove={() => {
                  const at = idsRef.current.indexOf(rowId);
                  if (at === -1) return;
                  idsRef.current = idsRef.current.filter((_, i) => i !== at);
                  update((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== at) }));
                  // Цель «Вставить» исчезнувшей строки сбрасываем сразу
                  if (target && !target.isAlive()) setTarget(null);
                }}
              />
            );
          })}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                idsRef.current = [...idsRef.current, newId()];
                update((prev) => ({
                  ...prev,
                  rows: [...prev.rows, { variable: '', op: 'eq', value: '' }],
                }));
              }}
            >
              <Plus className="size-4" />
              {t.add}
            </Button>
            {model.rows.length > 1 && (
              <GroupedSelect
                ariaLabel={t.join}
                value={model.join}
                groups={JOIN_SELECT_GROUPS}
                onValueChange={(join) =>
                  update((prev) => ({ ...prev, join: join as ConditionJoin }))
                }
              />
            )}
          </div>
          {builderIssue && (
            <p role="alert" className="text-xs text-destructive">
              {builderIssue}
            </p>
          )}
        </div>
      ) : (
        <ExpressionInput
          value={expression}
          onChange={onChange}
          variables={variables}
          envNames={[]}
          ariaLabel={ru.fields.expression}
          resultKind="condition"
          onCreateEditor={onCreateEditor}
        />
      )}
    </div>
  );
}
