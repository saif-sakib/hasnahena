'use client';

// Catches React rendering errors that escape every other boundary — the ones
// that would otherwise leave a member looking at a blank white page with no
// trace of what happened anywhere.
//
// Deliberately not translated. next-intl's provider lives inside the layout
// this replaces, so calling useTranslations here would throw a second error on
// top of the first. Plain English is the honest trade.
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#555', marginBottom: '1rem' }}>
            The problem has been reported. Your account and balances are unaffected.
          </p>
          {/*
            A plain <a>, deliberately, and not next/link. global-error replaces
            the root layout when the layout itself has thrown, so the router
            context this page renders in cannot be trusted — a client-side
            navigation would be asking the broken tree to render the next page.
            A full document load is the whole point: it rebuilds the app from
            scratch. Next 15 promoted no-html-link-for-pages to an error, which
            is right everywhere except here.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ color: '#0a6', textDecoration: 'underline' }}>
            Return to the home page
          </a>
        </div>
      </body>
    </html>
  );
}
