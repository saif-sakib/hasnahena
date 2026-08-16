// Next.js loads this once per runtime, before anything else. It is the
// supported place to start error tracking for the server and edge runtimes.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Reports a server-side rendering error to Sentry. Next calls this for errors
// thrown in server components, route handlers and middleware.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
