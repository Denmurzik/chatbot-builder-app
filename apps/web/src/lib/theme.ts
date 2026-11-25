import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'chatbot-theme';

const listeners = new Set<() => void>();
let fallbackTheme: Theme = 'dark';

function readStorage(): Theme | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

/** Возвращает сохранённую тему (по умолчанию — тёмная). Безопасно при отсутствии localStorage. */
export function getStoredTheme(): Theme {
  return readStorage() ?? 'dark';
}

function getSnapshot(): Theme {
  return readStorage() ?? fallbackTheme;
}

function getServerSnapshot(): Theme {
  return 'dark';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Применяет тему к documentElement, сохраняет в localStorage и уведомляет подписчиков. */
export function applyTheme(theme: Theme): void {
  fallbackTheme = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Игнорируем недоступность localStorage (приватный режим, тесты)
  }
  notify();
}

/** Инициализирует тему при старте приложения. */
export function initTheme(): Theme {
  const theme = getStoredTheme();
  fallbackTheme = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
  notify();
  return theme;
}

/** Хук для чтения и переключения текущей темы с синхронизацией всех экземпляров. */
export function useTheme(): {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(getSnapshot() === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme, setTheme };
}
