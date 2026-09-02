/**
 * An upstream event stream, with its failures turned into a clean end of stream.
 *
 * Sentry, `GET /api/v1/dashboard/support/[...path]`, unhandled and ongoing:
 * **`failed to pipe response`**. That is Next's `E180`, thrown by
 * `pipeToNodeResponse` when a streamed body errors with anything that is not an
 * abort:
 *
 * ```js
 * } catch (err) {
 *   if (isAbortError(err)) return;                              // client left — silent
 *   throw new Error('failed to pipe response', { cause: err })  // everything else
 * }
 * ```
 *
 * Exactly one route in this application returns a streamed body — the support
 * proxy handing the Go API's SSE response to `NextResponse` — and the piping
 * happens *inside Next*, after the handler has returned. So no `try/catch` in
 * the route can reach it: the route's own catch covers the `fetch`, and every
 * failure after that point is unhandled by construction and reported by
 * `onRequestError`.
 *
 * **And the failure it reports is not a fault.** An SSE connection ends for
 * ordinary reasons all day: the member closes the tab, a phone loses signal, a
 * proxy between here and Render times the connection out, the API is redeployed.
 * Each of those surfaces as `TypeError: terminated` / `ECONNRESET` on the
 * upstream body — never an `AbortError` — so each became a 500-shaped error
 * event for a connection whose client is already reconnecting
 * (`hooks/use-server-events.ts`).
 *
 * This wrapper reads the upstream itself and **closes** on a read failure
 * instead of erroring. Downstream, that is indistinguishable from the upstream
 * having said what it had to say and hung up — which for an event stream is a
 * normal ending, and the ending the client is built to handle.
 *
 * What it deliberately does not do is swallow a *failure to connect*: the route
 * still awaits the `fetch`, still answers 502 when the API is unreachable and
 * 499 when the member is already gone. This only governs a stream that opened
 * successfully and then stopped.
 */
export function endStreamOnUpstreamFailure(
  body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> {
  const reader = body?.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader) {
        controller.close();
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        // The upstream went away mid-stream. Release it and end the response
        // normally — the alternative is the error this whole module exists for.
        await reader.cancel().catch(() => {});
        controller.close();
      }
    },
    async cancel(reason) {
      // The reader is ours, so cancelling has to be forwarded or the upstream
      // connection stays open on the Go API for as long as the process lives —
      // which is the leak `signal: req.signal` was added to close.
      await reader?.cancel(reason).catch(() => {});
    },
  });
}
