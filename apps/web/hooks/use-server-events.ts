'use client';

import { useEffect, useRef, useState } from 'react';

import { apiPost } from '@/lib/api';

/**
 * A live server-sent-events connection to the support stream.
 *
 * WO-74. The dashboard shell polled `/support/threads` every 7 seconds and the
 * open thread's messages alongside it — about 26 requests a minute per open
 * tab, forever, for data that changes a few times an hour. At twenty concurrent
 * members that is ~500 requests/minute against a free Render instance and a
 * free Neon compute.
 *
 * The replacement already existed and had never been used: `GET
 * /v1/dashboard/support/stream` is a live authenticated SSE endpoint, with a
 * ticket endpoint beside it because `EventSource` cannot set an `Authorization`
 * header. `EventSource` appeared nowhere in this app.
 *
 * What the stream does and does not carry
 * ---------------------------------------
 * It is per-thread and it carries one signal: "the message count for this
 * thread changed". It does not carry the messages themselves, and it does not
 * carry the thread *list*. So this hook reports an event and the caller
 * refetches — which is the right shape anyway, because the refetch is the thing
 * that applies the caller's own authorisation.
 *
 * Everything the stream cannot cover keeps a slow poll. That is not a
 * concession, it is the design: an SSE connection that silently dies leaves a
 * chat that looks fine and never updates again, and a 60-second backstop turns
 * that into a delay instead of a defect.
 */

/** Tickets are single-use and expire in 60 s, so a reconnect fetches a new one. */
const TICKET_PATH = '/v1/dashboard/support/stream/ticket';

/**
 * Give up after this many consecutive failures to open a stream and let the
 * caller's polling carry the feature.
 *
 * Two, per WO-74. One failure is a dropped connection, which is normal and
 * worth retrying; two in a row means something structural — a proxy that does
 * not pass through SSE, a corporate middlebox buffering the response — and
 * retrying forever would then be a reconnect loop that costs *more* than the
 * polling it replaced.
 */
const MAX_CONSECUTIVE_FAILURES = 2;

/** Backoff between reconnect attempts. Short: this is a chat window. */
const RECONNECT_DELAY_MS = 2_000;

export type ServerEventsState = {
  /**
   * True while a stream is open.
   *
   * The only thing this hook reports, and it is deliberately the only thing: a
   * caller uses it to decide whether its backstop poll is load-bearing. Updates
   * are delivered by the `onUpdate` callback rather than by a counter the
   * caller watches, so there is nothing else to hand back — and "the stream gave
   * up after two failures" is already visible here as a `connected` that stops
   * coming true.
   */
  connected: boolean;
};

/**
 * Everything this hook knows, tagged with the subscription it belongs to.
 *
 * Tagged with a `key` rather than held as a bare flag, and that is not
 * tidiness. Resetting it when the thread changes would mean writing state
 * synchronously in the effect body — `react-hooks/set-state-in-effect`, the rule
 * WO-27 spent an order clearing from this codebase, and the cascading render it
 * warns about is real now that the React compiler is on. Tagging the state with
 * its subscription key means a stale value is *derived* away instead of written
 * away: it simply stops matching, and the reset costs no render.
 */
type StreamStatus = {
  key: string | null;
  connected: boolean;
};

const IDLE: StreamStatus = { key: null, connected: false };

/**
 * Subscribe to one support thread's change signal.
 *
 * Pass `threadId: null`, or `enabled: false`, to hold no connection — closing
 * the popup, signing out, or backgrounding the tab all end the stream rather
 * than leaving it open. That matters on the server too: RUN-02 ends streams
 * first at shutdown precisely because open streams eat the drain window.
 */
export function useServerEvents(
  threadId: string | null,
  enabled = true,
  onUpdate?: (threadId: string) => void,
): ServerEventsState {
  const [status, setStatus] = useState<StreamStatus>(IDLE);

  const key = enabled && threadId ? threadId : null;

  /**
   * The caller's refetch, called from the stream's own event listener.
   *
   * A callback rather than a counter the caller watches in an effect, and the reason is
   * the rule `react-hooks/set-state-in-effect` states in its own message:
   * subscribing to an external system means calling setState *in a callback
   * when the external state changes*, not writing state during a render pass
   * that observed a counter. The effect version compiled fine and added a
   * warning, because the React compiler follows the call graph into the
   * callee — the same finding WO-27 records elsewhere in this file.
   *
   * Held in a ref so that a caller passing an inline arrow does not reopen the
   * stream on every render. Reconnecting a chat once per keystroke is a
   * plausible accident and an expensive one.
   */
  const onUpdateRef = useRef(onUpdate);
  // In an effect, not during render: the React compiler refuses a ref write in
  // the render pass, and it is right to — a render can be thrown away and
  // re-run, so a ref written there is not reliably the value that shipped.
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Failures are counted across reconnect attempts, so they live in a ref: in
  // state they would re-run the effect and reset the count it accumulates.
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
        // Stop trying. The caller's poll is the feature from here on, and a
        // `connected` that never becomes true is how it knows.
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
        // A fresh ticket every time. They are single-use and 60 s, so a
        // reconnect that reused the last one would fail authentication and
        // look exactly like a server that has gone away.
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

      // Same-origin through the Next proxy, which is what `lib/api.ts` does for
      // everything under /v1/dashboard/support — EventSource cannot send an
      // Authorization header, hence the ticket in the query string. A full
      // access token there would end up in access logs; the Go handler refuses
      // one for exactly that reason.
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
        // The event carries no payload worth reading — it says "something
        // changed". The caller refetches, which is what applies authorisation.
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

  // Derived, never reset by an effect: a status left over from the previous
  // thread does not match the current key and reads as "not connected", which
  // is the truth — its EventSource was closed by the cleanup above.
  const current = status.key === key ? status : IDLE;
  return { connected: Boolean(key) && current.connected };
}
