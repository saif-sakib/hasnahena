// Sentry for the Next.js server runtime (route handlers, server components).
//
// Everything here is a no-op without NEXT_PUBLIC_SENTRY_DSN, which is the
// normal state locally and in CI — a missing DSN must never fail a build.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // Vercel exposes the deployed commit; tagging with it is what makes an error
  // spike point at a deploy rather than at a day.
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
  // Errors only. Tracing on the free plan burns the quota that should be
  // holding actual exceptions.
  tracesSampleRate: 0,
  // This app renders member names, phone numbers, NID numbers and balances.
  // None of that belongs in an error tracker.
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
      event.request.query_string = undefined;
    }
    return event;
  },
});
