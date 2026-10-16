import { describe, it, expect } from 'vitest';

import { endStreamOnUpstreamFailure } from '@/lib/sse-stream';

/**
 * An upstream failure must end the stream the way a normal finish does — the
 * ending Next pipes without throwing and EventSource reconnects from.
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
    // `TypeError: terminated` from `pull`, one read after a chunk — the
    // sequence a dying socket produces.
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
    // A client cancel must be forwarded to the upstream.
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
