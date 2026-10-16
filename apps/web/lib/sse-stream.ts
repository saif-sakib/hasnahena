/**
 * Wrap an upstream SSE body so a mid-stream failure ENDS the stream instead of
 * erroring. Next pipes a streamed body after the handler returns, so no route
 * catch can reach it, and a dropped connection (TypeError: terminated,
 * ECONNRESET) surfaced as `failed to pipe response`. A failure to CONNECT is
 * still the route's to answer (502/499).
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
        // Upstream went away: release it and end normally.
        await reader.cancel().catch(() => {});
        controller.close();
      }
    },
    async cancel(reason) {
      // Forward the cancel, or the Go API connection stays open.
      await reader?.cancel(reason).catch(() => {});
    },
  });
}
