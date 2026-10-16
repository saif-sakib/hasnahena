import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { ResetPasswordForm } from './reset-password-form';

/** Suspense around useSearchParams, or prerendering under [locale] fails the build (WO-73). */
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
