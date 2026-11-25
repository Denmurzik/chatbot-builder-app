import { useCallback, useRef } from 'react';

// Обработчик с постоянной ссылкой: @uiw/react-codemirror пересобирает расширения редактора
// при смене onChange, а это закрывало бы список подсказок при каждом рендере родителя
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
