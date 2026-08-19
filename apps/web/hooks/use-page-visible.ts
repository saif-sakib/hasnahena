'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether this tab is the one the member is looking at.
 *
 * WO-74. The dashboard shell polls three endpoints on intervals, and it did so
 * whether or not anyone was watching — a tab left open in a background window
 * kept asking a free Render instance for notifications every twenty seconds,
 * for as long as the browser lived. Most open tabs are not the focused tab, so
 * suspending on `document.hidden` removes most of the traffic on its own, which
 * is why WO-74 says this half is worth doing even if the SSE work stalls.
 *
 * `useSyncExternalStore` rather than an effect writing state: the value is read
 * from the browser, not derived from a render, and this is the hook React
 * provides for exactly that. It also gives a correct server snapshot — `true`,
 * because a server render has no hidden tab and starting suspended would mean
 * a page that never loads its data if the event never fires.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  // A tab can also stop being visible without a visibilitychange — moved to a
  // background window, or the browser minimised — and blur/focus is what those
  // report. Cheap to listen for, and the alternative is a poll that never stops.
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
