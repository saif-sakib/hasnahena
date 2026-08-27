import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * `data-no-native-password-toggle` used to be handled here, by setting
 * `-webkit-text-security: disc` on an input that was already `type="password"`.
 * That is a no-op — the property only masks text inputs — so the browser's own
 * reveal control was never suppressed and every password field in this
 * application showed **two** eyes on Edge: ours and the platform's.
 *
 * It is one CSS rule in `app/globals.css` now (`input::-ms-reveal`), applied to
 * every password field there has ever been and every one there will be, rather
 * than to whichever ones somebody remembered to mark.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
