'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Read a `localStorage` value during render, safely — WO-27.
 *
 * ## Why not just read it
 *
 * `localStorage.getItem(...)` in a component body is a hydration bug waiting to
 * happen. These are client components, but Next still renders them on the
 * server for the initial HTML, where there is no `localStorage` — so the server
 * markup says one thing, the first client render says another, and React
 * discards the tree with a mismatch warning.
 *
 * ## Why not an effect
 *
 * Reading it in an effect and calling `setState` is the exact
 * `react-hooks/set-state-in-effect` shape WO-27 exists to remove, and it also
 * renders one frame with the wrong answer.
 *
 * `useSyncExternalStore` is the primitive built for this: a server snapshot
 * (always `null`, matching the SSR pass), a client snapshot read at render
 * time, and a subscription so a change in another tab is picked up. React
 * handles the hydration boundary itself.
 */
export function useLocalStorageValue(key: string): string | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined') return () => {};
    // `storage` fires for other tabs only. `auth-change` is this app's own
    // same-tab signal, already dispatched wherever it writes these keys.
    window.addEventListener('storage', onChange);
    window.addEventListener('auth-change', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('auth-change', onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Safari in private mode throws rather than returning null.
      return null;
    }
  }, [key]);

  // The server has no localStorage, so the server snapshot is the absence of a
  // value. Anything else would guarantee the mismatch this hook exists to
  // avoid.
  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
