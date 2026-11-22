import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayarKecil } from './use-layar-kecil';

describe('useLayarKecil', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mengikuti media query dan berubah saat layar diputar', () => {
    let cocok = true;
    const pendengar = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return cocok;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => pendengar.add(fn),
      removeEventListener: (_: string, fn: () => void) => pendengar.delete(fn),
    }));
    const { result } = renderHook(() => useLayarKecil());
    expect(result.current).toBe(true);
    act(() => {
      cocok = false;
      pendengar.forEach((fn) => fn());
    });
    expect(result.current).toBe(false);
  });

  it('tanpa matchMedia dianggap layar lebar, tampilan bawaan tidak berubah', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useLayarKecil());
    expect(result.current).toBe(false);
  });
});
