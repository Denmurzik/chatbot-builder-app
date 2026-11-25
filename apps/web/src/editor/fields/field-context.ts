import { createContext, useContext } from 'react';

// Данные окна блока для полей: тестовые значения колонки «Вход» (нигде не сохраняются)
// и названия блоков, записавших переменные
export interface FieldContextValue {
  testValues: Record<string, string>;
  sources: Record<string, string>;
}

export const FieldContext = createContext<FieldContextValue>({ testValues: {}, sources: {} });

export function useFieldContext(): FieldContextValue {
  return useContext(FieldContext);
}
