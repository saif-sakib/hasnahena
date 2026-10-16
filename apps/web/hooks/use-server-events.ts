'use client';

import { useEffect, useRef, useState } from 'react';

import { apiPost } from '@/lib/api';

/**
 * A live SSE connection to the support stream (WO-74), replacing a 7-second
 * poll. The stream only signals "this thread's count changed"; the caller
 * refetches (which applies authorisation). Callers keep a slow backstop poll,
 * since a silently dead stream would otherwise never update again.
 */

/** Tickets are single-use and expire in 60 s, so a reconnect fetches a new one. */
const TICKET_PATH = '/v1/dashboard/support/stream/ticket';

/**
 * Give up after two consecutive failures to open (WO-74): that means something
 * structural, and retrying would cost more than the poll.
 */
const MAX_CONSECUTIVE_FAILURES = 2;

/** Backoff between reconnect attempts. Short: this is a chat window. */
const RECONNECT_DELAY_MS = 2_000;

export type ServerEventsState = {
  /** True while a stream is open — tells the caller whether its poll is the backstop. */
  connected: boolean;
};

/**
 * Status tagged with its subscription key, so a stale value is derived away
 * rather than reset with setState in an effect (WO-27).
 */
type StreamStatus = {
  key: string | null;
  connected: boolean;
};

const IDLE: StreamStatus = { key: null, connected: false };

/**
 * Subscribe to one thread's change signal. A null threadId or enabled=false
 * holds no connection.
 */
export function useServerEvents(
  threadId: string | null,
  enabled = true,
  onUpdate?: (threadId: string) => void,
): ServerEventsState {
  const [status, setStatus] = useState<StreamStatus>(IDLE);

  const key = enabled && threadId ? threadId : null;

  /**
   * The caller's refetch, called from the stream's listener (setState in a
   * callback, not in an effect). In a ref so an inline arrow does not reopen
   * the stream every render.
   */
  const onUpdateRef = useRef(onUpdate);
  // Ref written in an effect — the compiler refuses ref writes during render.
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Failures persist across reconnects, so a ref (state would reset the effect).
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!key) return;

    failuresRef.current = 0;

    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const closeSource = () => {
      if (source) {
        source.close();
        source = null;
      }
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        // Stop; the caller's poll carries the feature.
        setStatus({ key, connected: false });
        return;
      }
      retryTimer = setTimeout(() => {
        void open();
      }, RECONNECT_DELAY_MS);
    };

    const open = async () => {
      if (cancelled) return;
      closeSource();

      let ticket = '';
      try {
        // A fresh single-use, 60s ticket every time.
        const issued = await apiPost<{ ticket: string }>(TICKET_PATH, {});
        ticket = issued?.ticket ?? '';
      } catch {
        scheduleRetry();
        return;
      }
      if (cancelled) return;
      if (!ticket) {
        scheduleRetry();
        return;
      }

      // Same-origin via the Next proxy; a ticket, never the access token, in the URL.
      const url =
        `/api/v1/dashboard/support/stream` +
        `?threadId=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`;

      const es = new EventSource(url);
      source = es;

      es.addEventListener('open', () => {
        if (cancelled) return;
        failuresRef.current = 0;
        setStatus({ key, connected: true });
      });

      es.addEventListener('update', () => {
        if (cancelled) return;
        // No payload worth reading; the caller refetches.
        setStatus({ key, connected: true });
        onUpdateRef.current?.(key);
      });

      es.addEventListener('error', () => {
        if (cancelled) return;
        closeSource();
        setStatus({ key, connected: false });
        scheduleRetry();
      });
    };

    void open();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      closeSource();
    };
  }, [key]);

  // Derived: a status from a previous thread does not match and reads as disconnected.
  const current = status.key === key ? status : IDLE;
  return { connected: Boolean(key) && current.connected };
}
