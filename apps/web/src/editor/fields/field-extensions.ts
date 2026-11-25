import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  decorationPlugin,
  expandPadding,
  fieldTheme,
  singleLineEnter,
  singleLineFilter,
  templateAutoClose,
} from './cm-base';
import {
  createExpressionCompletionSource,
  createTemplateCompletionSource,
  type CompletionDocs,
} from './completions';
import { expressionDecorations, templateDecorations } from './highlight';

export interface FieldExtensionOptions {
  variables: readonly string[];
  envNames: readonly string[];
  docs: CompletionDocs;
  multiline: boolean;
  // Справа есть кнопка «развернуть»
  expandable?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // Атрибуты ошибки (только выражения)
  invalid?: boolean;
  errorId?: string;
}

function ariaAttributes(options: FieldExtensionOptions): Extension {
  return EditorView.contentAttributes.of({
    role: 'textbox',
    'aria-multiline': options.multiline ? 'true' : 'false',
    ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}),
    ...(options.ariaLabelledBy ? { 'aria-labelledby': options.ariaLabelledBy } : {}),
    ...(options.invalid && options.errorId
      ? { 'aria-invalid': 'true', 'aria-describedby': options.errorId }
      : {}),
  });
}

// Расширения CodeMirror поля выражения: подсветка, подсказки с документацией, парные кавычки
export function expressionExtensions(options: FieldExtensionOptions): Extension[] {
  return [
    ariaAttributes(options),
    fieldTheme(options.multiline),
    ...(options.expandable ? [expandPadding] : []),
    ...(options.multiline ? [EditorView.lineWrapping] : [singleLineFilter, singleLineEnter]),
    autocompletion({
      override: [
        createExpressionCompletionSource(options.variables, options.envNames, options.docs),
      ],
    }),
    // Парные только скобки и кавычки выражения (не «{»)
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '"', "'"] } }]),
    decorationPlugin((doc) => expressionDecorations(doc, new Set(options.variables))),
  ];
}

// Расширения CodeMirror поля шаблона: «таблетки» {{…}}, подсказки, автозакрытие «{{»
export function templateExtensions(options: FieldExtensionOptions): Extension[] {
  return [
    ariaAttributes(options),
    fieldTheme(options.multiline),
    ...(options.expandable ? [expandPadding] : []),
    ...(options.multiline ? [EditorView.lineWrapping] : [singleLineFilter, singleLineEnter]),
    templateAutoClose,
    autocompletion({
      override: [createTemplateCompletionSource(options.variables, options.envNames, options.docs)],
    }),
    decorationPlugin((doc) => templateDecorations(doc, new Set(options.variables))),
  ];
}
