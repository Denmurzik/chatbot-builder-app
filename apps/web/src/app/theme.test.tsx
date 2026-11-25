import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useColorMode } from './theme';

describe('useColorMode', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('dark');
  });

  it('следует за классом .dark на <html>', async () => {
    const { result } = renderHook(() => useColorMode());
    expect(result.current).toBe('light');
    await act(async () => {
      document.documentElement.classList.add('dark');
      await Promise.resolve();
    });
    expect(result.current).toBe('dark');
  });
});
