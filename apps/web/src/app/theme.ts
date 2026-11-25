import { useSyncExternalStore } from 'react';

// Тёмная тема — класс .dark на <html> по системной настройке, с подпиской на изменения
export function applySystemTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (dark: boolean): void => {
    document.documentElement.classList.toggle('dark', dark);
  };
  apply(query.matches);
  const listener = (event: MediaQueryListEvent): void => apply(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

// Текущая тема для компонентов, которым нужен явный режим (React Flow colorMode)
export function useColorMode(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    },
    read,
    () => 'light',
  );
}
