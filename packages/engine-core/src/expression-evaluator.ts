import { evaluate, toBoolean } from './expression';
import type { VariableScope } from './scope';
import { extractVariableNames, substitute, type RenderMode } from './template';

// Класс модели BCE для вычисления выражений, условий и подстановки переменных в шаблоны
export class ExpressionEvaluator {
  evaluate(expr: string, scope: VariableScope): string | number | boolean {
    return evaluate(expr, scope);
  }

  // Вычисляет логическое условие блока «Условие» (UC-U-22)
  evaluateCondition(expr: string, scope: VariableScope): boolean {
    return toBoolean(evaluate(expr, scope));
  }

  // Вычисляет выражение блока «Присваивание» и возвращает строковое значение (UC-U-21)
  evaluateExpression(expr: string, scope: VariableScope): string {
    return String(evaluate(expr, scope));
  }

  extractVariableNames(template: string): string[] {
    return extractVariableNames(template);
  }

  substitute(template: string, values: Record<string, string>, mode: RenderMode): string {
    return substitute(template, values, mode);
  }
}
