import { useCallback, useEffect, useRef, useState } from 'react';

// Наведение с задержкой скрытия: при уходе курсора элемент гаснет не сразу,
// чтобы можно было перевести мышь на всплывающие кнопки
export function useHoverDelay(delayMs = 150) {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    clear();
    setHovered(true);
  }, [clear]);

  const onMouseLeave = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      setHovered(false);
    }, delayMs);
  }, [clear, delayMs]);

  useEffect(() => clear, [clear]);

  return { hovered, handlers: { onMouseEnter, onMouseLeave } };
}
