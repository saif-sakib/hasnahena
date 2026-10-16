'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Read a localStorage value during render without a hydration mismatch or a
 * setState-in-effect (WO-27): useSyncExternalStore with a null server
 * snapshot, subscribed to changes from other tabs.
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

  // No localStorage on the server.
  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
