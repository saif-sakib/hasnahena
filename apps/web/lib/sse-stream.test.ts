import { describe, it, expect } from 'vitest';

import { endStreamOnUpstreamFailure } from '@/lib/sse-stream';

/**
 * The Sentry issue this exists for is `failed to pipe response`, unhandled and
 * ongoing on `GET /api/v1/dashboard/support/[...path]`. Next throws it from
 * `pipeToNodeResponse` when a streamed body errors with anything that is not an
 * abort — and the piping happens after the route handler has returned, so the
 * route cannot catch it. The only place to fix it is the stream itself.
 *
 * So the assertions are about the *shape of the ending*: a stream that fails
 * upstream must end the way a stream that finished normally ends, because that
 * is the ending Next pipes without throwing and the ending EventSource
 * reconnects from.
 */

const encoder = new TextEncoder();

/** Read a stream to the end, returning the chunks as text. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const out: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.push(new TextDecoder().decode(value));
  }
  return out;
}

describe('endStreamOnUpstreamFailure', () => {
  it('passes a healthy stream through unchanged', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: update\ndata: messages\n\n'));
        controller.enqueue(encoder.encode(': ping\n\n'));
        controller.close();
      },
    });

    expect(await drain(endStreamOnUpstreamFailure(upstream))).toEqual([
      'event: update\ndata: messages\n\n',
      ': ping\n\n',
    ]);
  });

  it('ends cleanly when the upstream errors mid-stream, keeping what arrived', async () => {
    // `TypeError: terminated` is what undici raises when the socket under a
    // fetch body goes away — a redeploy of the Go API, a proxy's idle timeout,
    // a phone losing signal. Unwrapped, this is the error Next reports.
    //
    // The failure is raised from `pull`, one read after a chunk was delivered,
    // because that is the sequence a dying socket produces: bytes arrive, then
    // the connection breaks. (`controller.error()` from `start` models
    // something else — it discards the queue, so nothing was ever delivered.)
    let pulls = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode('event: update\ndata: messages\n\n'));
          return;
        }
        throw new TypeError('terminated');
      },
    });

    // The assertion is that this resolves at all: `drain` rejects if the
    // wrapped stream errors, which is the unfixed behaviour.
    expect(await drain(endStreamOnUpstreamFailure(upstream))).toEqual([
      'event: update\ndata: messages\n\n',
    ]);
  });

  it('ends cleanly when the upstream fails before sending anything', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('ECONNRESET'));
      },
    });

    expect(await drain(endStreamOnUpstreamFailure(upstream))).toEqual([]);
  });

  it('ends cleanly when there is no upstream body at all', async () => {
    // `Response.body` is nullable, and a 204 or a HEAD upstream has none.
    // Reading `.getReader()` off null would throw inside the route.
    expect(await drain(endStreamOnUpstreamFailure(null))).toEqual([]);
  });

  it('cancels the upstream when the client goes away', async () => {
    // The member closing the tab has to reach the Go API, or the connection
    // stays open there for the life of the process — the leak `signal:
    // req.signal` was added to close. Wrapping the body puts a reader of our
    // own in the middle, so the cancel has to be forwarded explicitly.
    let cancelledWith: unknown = 'not cancelled';
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': ping\n\n'));
      },
      cancel(reason) {
        cancelledWith = reason;
      },
    });

    const wrapped = endStreamOnUpstreamFailure(upstream);
    const reader = wrapped.getReader();
    await reader.read();
    await reader.cancel('client disconnected');

    expect(cancelledWith).toBe('client disconnected');
  });
});
