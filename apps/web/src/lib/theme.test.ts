import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  initTheme,
  useTheme,
} from './theme';

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('возвращает тёмную тему по умолчанию при пустом или некорректном localStorage', () => {
    expect(getStoredTheme()).toBe('dark');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    expect(getStoredTheme()).toBe('dark');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(getStoredTheme()).toBe('light');
  });

  it('безопасно обрабатывает ошибки доступа к localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(getStoredTheme()).toBe('dark');
  });

  it('applyTheme переключает класс dark на html и сохраняет выбор', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('initTheme применяет сохранённую тему к documentElement', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(initTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(initTheme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('useTheme синхронизирует состояние между несколькими потребителями', () => {
    initTheme();
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());

    expect(first.result.current.theme).toBe('dark');
    expect(second.result.current.theme).toBe('dark');

    act(() => {
      first.result.current.toggleTheme();
    });

    expect(first.result.current.theme).toBe('light');
    expect(second.result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      second.result.current.setTheme('dark');
    });

    expect(first.result.current.theme).toBe('dark');
    expect(second.result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
