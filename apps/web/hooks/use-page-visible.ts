'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether this tab is the one being looked at, so the shell's polls suspend in
 * background tabs (WO-74). useSyncExternalStore; server snapshot `true`.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  // focus/blur cover a backgrounded window with no visibilitychange.
  window.addEventListener('focus', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
  };
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  );
}
