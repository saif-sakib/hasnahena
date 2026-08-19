import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { ResetPasswordForm } from './reset-password-form';

/**
 * The form is a client component that reads `?token=` through
 * `useSearchParams`, which is a request-scoped read. WO-73 gave `[locale]` a
 * `generateStaticParams`, so Next now tries to prerender every route beneath it
 * — and an unwrapped `useSearchParams` fails that build outright rather than
 * quietly opting the route out.
 *
 * The boundary is the documented answer and the better one: the shell is
 * prerendered and served immediately, and only the part that needs the token
 * waits for the client.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
