import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  ERROR_STRATEGIES,
  HTTP_METHODS,
  type ErrorStrategy,
  type HttpHeader,
  type HttpMethod,
  type ResponseMapping,
} from '@chatbot/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ru } from '@/i18n/ru';
import type { BlockNodeData } from '../convert';
import { ExpressionInput } from '../fields/ExpressionInput';
import { TemplateInput } from '../fields/TemplateInput';
import { listIssues, minIssue, variableNameIssue } from '../validate';
import { ConditionBuilder } from './ConditionBuilder';
import { InsertableInput } from './InsertableInput';
import { useCodeMirrorInsertTarget } from './insert-target';

const s = ru.settings;

// Переменные, доступные в блоке, для подсказок в полях шаблонов и выражений
const VariablesContext = createContext<string[]>([]);

interface SettingsPaneProps {
  data: BlockNodeData;
  onChange: (data: BlockNodeData) => void;
  variables: string[];
}

function Field({
  label,
  hint,
  errors = [],
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  // Функция получает id для поля (Label htmlFor ↔ id) и id подписи (для CodeMirror: aria-labelledby)
  children: ReactNode | ((ids: { id: string; labelId: string }) => ReactNode);
}) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} htmlFor={typeof children === 'function' ? id : undefined}>
        {label}
      </Label>
      {typeof children === 'function' ? children({ id, labelId }) : children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="border-b pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function TextField({
  label,
  hint,
  value,
  errors,
  insertable = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  errors?: string[];
  // Поле может принимать имя переменной кнопкой «Вставить»
  insertable?: boolean;
  onChange: (value: string) => void;
}) {
  const invalid = errors !== undefined && errors.length > 0;
  return (
    <Field label={label} hint={hint} errors={errors}>
      {({ id }) =>
        insertable ? (
          <InsertableInput id={id} value={value} aria-invalid={invalid} onValueChange={onChange} />
        ) : (
          <Input
            id={id}
            value={value}
            aria-invalid={invalid}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}

// Имя переменной: латиница, цифры, _
function VariableNameField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const issue = variableNameIssue(value);
  return (
    <TextField
      label={label}
      hint={hint ?? s.variableHint}
      value={value}
      errors={issue ? [issue] : []}
      insertable
      onChange={onChange}
    />
  );
}

// Текст с подстановками {{переменная}}
function TemplateField({
  label,
  hint,
  value,
  multiline = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const variables = useContext(VariablesContext);
  const onCreateEditor = useCodeMirrorInsertTarget('template');
  return (
    <Field label={label} hint={hint}>
      {({ labelId }) => (
        <TemplateInput
          value={value}
          onChange={onChange}
          variables={variables}
          envNames={[]}
          multiline={multiline}
          ariaLabelledBy={labelId}
          onCreateEditor={onCreateEditor}
        />
      )}
    </Field>
  );
}

function ExpressionField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const variables = useContext(VariablesContext);
  const onCreateEditor = useCodeMirrorInsertTarget('expression');
  return (
    <Field label={label} hint={hint}>
      {({ labelId }) => (
        <ExpressionInput
          value={value}
          onChange={onChange}
          variables={variables}
          envNames={[]}
          ariaLabelledBy={labelId}
          onCreateEditor={onCreateEditor}
        />
      )}
    </Field>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  // Сырой текст храним локально, чтобы поле можно было очистить
  const [raw, setRaw] = useState(String(value));
  const issue = minIssue(value, min);
  return (
    <Field label={label} errors={issue ? [issue] : []}>
      {({ id }) => (
        <Input
          id={id}
          type="number"
          value={raw}
          aria-invalid={issue !== null}
          onChange={(event) => {
            setRaw(event.target.value);
            const parsed = Number.parseInt(event.target.value, 10);
            onChange(Number.isNaN(parsed) ? 0 : parsed);
          }}
        />
      )}
    </Field>
  );
}

function nonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Список значений «по строке на значение»: сырой текст храним локально,
// чтобы ввод перевода строки не терялся при фильтрации пустых строк
function LinesField({
  label,
  hint,
  value,
  forbidden,
  onChange,
}: {
  label: string;
  hint: string;
  value: string[];
  forbidden?: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const [raw, setRaw] = useState(value.join('\n'));
  // Пустые строки (только что нажатый Enter, пропуск в середине) в значения не попадают — ошибкой не считаем
  const errors = listIssues(nonEmptyLines(raw), forbidden);
  return (
    <Field label={label} hint={hint} errors={errors}>
      {({ id }) => (
        <Textarea
          id={id}
          value={raw}
          rows={5}
          aria-invalid={errors.length > 0}
          onChange={(event) => {
            setRaw(event.target.value);
            onChange(nonEmptyLines(event.target.value));
          }}
          // Пустые строки внутри списка при потере фокуса убираем
          onBlur={() => {
            const cleaned = nonEmptyLines(raw).join('\n');
            if (cleaned !== raw) setRaw(cleaned);
          }}
        />
      )}
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      {({ id }) => (
        <Select value={value} onValueChange={(next) => onChange(next as T)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

function HeadersEditor({
  value,
  onChange,
}: {
  value: HttpHeader[];
  onChange: (value: HttpHeader[]) => void;
}) {
  const variables = useContext(VariablesContext);
  const onCreateEditor = useCodeMirrorInsertTarget('template');
  const update = (index: number, patch: Partial<HttpHeader>) =>
    onChange(value.map((header, i) => (i === index ? { ...header, ...patch } : header)));
  return (
    <Field label={ru.fields.headers}>
      {value.map((header, index) => (
        <div key={index} className="flex flex-col gap-1.5 rounded-md border p-2">
          <InsertableInput
            placeholder={ru.fields.headerName}
            value={header.name}
            onValueChange={(name) => update(index, { name })}
          />
          {header.secret ? (
            <Input
              type="password"
              placeholder={header.secretMask ?? header.secretValue?.mask ?? ru.fields.headerValue}
              value={header.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
          ) : (
            <TemplateInput
              value={header.value}
              onChange={(next) => update(index, { value: next })}
              variables={variables}
              envNames={[]}
              placeholder={ru.fields.headerValue}
              ariaLabel={`${ru.fields.headerValue} ${index + 1}`}
              onCreateEditor={onCreateEditor}
            />
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={header.secret}
                onChange={(event) =>
                  update(index, {
                    secret: event.target.checked,
                    ...(event.target.checked
                      ? {}
                      : { secretMask: undefined, secretValue: undefined }),
                  })
                }
              />
              {ru.fields.headerSecret}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ru.fields.remove}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { name: '', value: '', secret: false }])}
      >
        <Plus className="size-4" />
        {ru.fields.addHeader}
      </Button>
    </Field>
  );
}

function MappingsEditor({
  value,
  onChange,
}: {
  value: ResponseMapping[];
  onChange: (value: ResponseMapping[]) => void;
}) {
  const update = (index: number, patch: Partial<ResponseMapping>) =>
    onChange(value.map((mapping, i) => (i === index ? { ...mapping, ...patch } : mapping)));
  return (
    <Field label={ru.fields.responseMappings} hint={s.mappingsHint}>
      {value.map((mapping, index) => {
        const issue = variableNameIssue(mapping.variableName);
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-md border p-2">
            <InsertableInput
              placeholder={ru.fields.jsonPath}
              value={mapping.jsonPath}
              insertMode="cursor"
              onValueChange={(jsonPath) => update(index, { jsonPath })}
            />
            <div className="flex items-center gap-1.5">
              <InsertableInput
                placeholder={ru.fields.mappingVariable}
                value={mapping.variableName}
                aria-invalid={issue !== null}
                onValueChange={(variableName) => update(index, { variableName })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={ru.fields.remove}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {issue && (
              <p role="alert" className="text-xs text-destructive">
                {issue}
              </p>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { jsonPath: '', variableName: '' }])}
      >
        <Plus className="size-4" />
        {ru.fields.addMapping}
      </Button>
    </Field>
  );
}

const METHOD_OPTIONS = HTTP_METHODS.map((method) => ({ value: method, label: method }));
const STRATEGY_LABELS: Record<ErrorStrategy, string> = {
  EXIT_ERROR: ru.fields.strategyExitError,
  SUSPEND: ru.fields.strategySuspend,
};
const STRATEGY_OPTIONS = ERROR_STRATEGIES.map((strategy) => ({
  value: strategy,
  label: STRATEGY_LABELS[strategy],
}));
const UNSAFE_RETRY_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH'];

// Поля, специфичные для типа блока, по группам
function TypeFields({
  data,
  onChange,
}: {
  data: BlockNodeData;
  onChange: (data: BlockNodeData) => void;
}) {
  const g = s.groups;
  const variables = useContext(VariablesContext);
  switch (data.type) {
    case 'ENTRY_POINT':
    case 'EXIT_POINT':
      return null;
    case 'TEXT_MESSAGE':
      return (
        <Group title={g.say}>
          <TemplateField
            label={ru.fields.text}
            hint={s.textHint}
            multiline
            value={data.text}
            onChange={(text) => onChange({ ...data, text })}
          />
        </Group>
      );
    case 'TEXT_INPUT':
      return (
        <>
          <Group title={g.say}>
            <TemplateField
              label={ru.fields.question}
              hint={s.questionHint}
              multiline
              value={data.question}
              onChange={(question) => onChange({ ...data, question })}
            />
          </Group>
          <Group title={g.save}>
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.saveVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
          </Group>
        </>
      );
    case 'OPTION_CHOICE':
      return (
        <>
          <Group title={g.say}>
            <TemplateField
              label={ru.fields.question}
              hint={s.questionHint}
              multiline
              value={data.question}
              onChange={(question) => onChange({ ...data, question })}
            />
          </Group>
          <Group title={g.options}>
            <LinesField
              label={ru.fields.options}
              hint={ru.fields.optionsHint}
              value={data.options}
              onChange={(options) => onChange({ ...data, options })}
            />
          </Group>
          <Group title={g.save}>
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.saveVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
          </Group>
        </>
      );
    case 'LIST_CHOICE':
      return (
        <>
          <Group title={g.say}>
            <TemplateField
              label={ru.fields.question}
              hint={s.questionHint}
              multiline
              value={data.question}
              onChange={(question) => onChange({ ...data, question })}
            />
          </Group>
          <Group title={g.options}>
            <VariableNameField
              label={ru.fields.listVariable}
              hint={`${s.listVariableHint}. ${s.variableHint}`}
              value={data.listVariable}
              onChange={(listVariable) => onChange({ ...data, listVariable })}
            />
            <TextField
              label={ru.fields.labelField}
              value={data.labelField}
              onChange={(labelField) => onChange({ ...data, labelField })}
            />
            <TextField
              label={ru.fields.valueField}
              value={data.valueField}
              onChange={(valueField) => onChange({ ...data, valueField })}
            />
          </Group>
          <Group title={g.save}>
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.saveVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
          </Group>
        </>
      );
    case 'ASSIGNMENT':
      return (
        <>
          <Group title={g.save}>
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.assignVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
          </Group>
          <Group title={g.value}>
            <ExpressionField
              label={s.expressionLabel}
              hint={s.assignExpressionHint}
              value={data.expression}
              onChange={(expression) => onChange({ ...data, expression })}
            />
          </Group>
        </>
      );
    case 'CONDITION':
      return (
        <Group title={g.condition}>
          <p className="text-xs text-muted-foreground">{s.conditionHint}</p>
          <ConditionBuilder
            expression={data.expression}
            variables={variables}
            onChange={(expression) => onChange({ ...data, expression })}
          />
        </Group>
      );
    case 'SWITCH':
      return (
        <>
          <Group title={g.check}>
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.switchVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
          </Group>
          <Group title={g.options}>
            <LinesField
              label={ru.fields.values}
              hint={ru.fields.valuesHint}
              value={data.values}
              forbidden={['else']}
              onChange={(values) => onChange({ ...data, values })}
            />
          </Group>
        </>
      );
    case 'HTTP_REQUEST':
      return (
        <>
          <Group title={g.request}>
            <SelectField
              label={ru.fields.method}
              value={data.method}
              options={METHOD_OPTIONS}
              onChange={(method) => onChange({ ...data, method })}
            />
            <TemplateField
              label={ru.fields.url}
              hint={s.urlHint}
              value={data.url}
              onChange={(url) => onChange({ ...data, url })}
            />
            <HeadersEditor
              value={data.headers}
              onChange={(headers) => onChange({ ...data, headers })}
            />
            <TemplateField
              label={ru.fields.body}
              hint={s.bodyHint}
              multiline
              value={data.body}
              onChange={(body) => onChange({ ...data, body })}
            />
          </Group>
          <Group title={g.parse}>
            <MappingsEditor
              value={data.responseMappings}
              onChange={(responseMappings) => onChange({ ...data, responseMappings })}
            />
            <VariableNameField
              label={ru.fields.variableName}
              hint={`${s.responseVariableHint}. ${s.variableHint}`}
              value={data.variableName}
              onChange={(variableName) => onChange({ ...data, variableName })}
            />
            <VariableNameField
              label={ru.fields.errorVariable}
              hint={`${s.errorVariableHint}. ${s.variableHint}`}
              value={data.errorVariable}
              onChange={(errorVariable) => onChange({ ...data, errorVariable })}
            />
          </Group>
          <Group title={g.retries}>
            <NumberField
              label={ru.fields.timeoutSec}
              value={data.timeoutSec}
              min={1}
              onChange={(timeoutSec) => onChange({ ...data, timeoutSec })}
            />
            <NumberField
              label={ru.fields.retryCount}
              value={data.retryCount}
              min={0}
              onChange={(retryCount) => onChange({ ...data, retryCount })}
            />
            <NumberField
              label={ru.fields.retryIntervalSec}
              value={data.retryIntervalSec}
              min={0}
              onChange={(retryIntervalSec) => onChange({ ...data, retryIntervalSec })}
            />
            {UNSAFE_RETRY_METHODS.includes(data.method) && data.retryCount > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-sm text-destructive"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {ru.fields.retryWarning}
              </div>
            )}
            <SelectField
              label={ru.fields.errorStrategy}
              value={data.errorStrategy}
              options={STRATEGY_OPTIONS}
              onChange={(errorStrategy) => onChange({ ...data, errorStrategy })}
            />
            {data.errorStrategy === 'SUSPEND' && (
              <TemplateField
                label={ru.fields.suspendText}
                multiline
                value={data.suspendText ?? ''}
                onChange={(suspendText) =>
                  onChange({ ...data, suspendText: suspendText === '' ? null : suspendText })
                }
              />
            )}
          </Group>
        </>
      );
  }
}

// Средняя колонка окна блока: все поля блока по группам
export function SettingsPane({ data, onChange, variables }: SettingsPaneProps) {
  return (
    <VariablesContext.Provider value={variables}>
      <div className="flex flex-col gap-6">
        <TypeFields data={data} onChange={onChange} />
      </div>
    </VariablesContext.Provider>
  );
}
