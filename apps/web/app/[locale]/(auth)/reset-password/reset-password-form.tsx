'use client';

import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { localePath } from '@/lib/locale-path';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

export function ResetPasswordForm() {
  const locale = useLocale();
  const t = useTranslations('auth.reset');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setError(t('tokenMissing'));
        setIsValidating(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/v1/auth/reset-password?token=${encodeURIComponent(token)}`);
        const result = await response.json();
        const isSuccess = response.ok && Boolean(result?.success || result?.ok);
        const valid = Boolean(result?.data?.valid ?? result?.valid);
        const errorMessage =
          result?.error?.message ||
          result?.error ||
          (t('tokenInvalid'));

        if (isSuccess && valid) {
          setIsValid(true);
        } else {
          setError(errorMessage);
        }
      } catch {
        setError(t('tokenCheckFailed'));
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
    // `t` rather than `locale`: the copy is what this effect actually reads, and
    // next-intl returns one memoised `t` per namespace per locale — so the
    // dependency is stable *and* honest, where `locale` was a stand-in for it
    // that the exhaustive-deps rule could not verify.
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: t('errorTitle'),
        description: t('passwordTooShort'),
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: t('errorTitle'),
        description: t('passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const result = await response.json();
      const isSuccess = response.ok && Boolean(result?.success || result?.ok);
      const errorMessage = result?.error?.message || result?.error || 'Failed to reset password';

      if (isSuccess) {
        setIsSuccess(true);
        toast({
          title: t('successTitle'),
          description: t('successToast'),
          variant: 'success',
        });
      } else {
        throw new Error(errorMessage);
      }
    } catch (err) {
      toast({
        title: t('errorTitle'),
        description: err instanceof Error ? err.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-50 to-emerald-50 p-4">
        <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-emerald-600" />
            <p className="mt-4 text-muted-foreground">
              {t('validating')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid token state
  if (!isValid && !isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-50 to-emerald-50 p-4">
        <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="h-10 w-10 text-red-600" />
            </div>
            <CardTitle className="text-2xl">
              {t('invalidTitle')}
            </CardTitle>
            <CardDescription className="text-base">
              {error || (t('invalidBody'))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href={localePath(locale, '/forgot-password')}>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                {t('requestNewLink')}
              </Button>
            </Link>
            <Link href={localePath(locale, '/login')}>
              <Button variant="outline" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('backToLogin')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-50 to-emerald-50 p-4">
        <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl">
              {t('doneTitle')}
            </CardTitle>
            <CardDescription className="text-base">
              {t('doneBody')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={localePath(locale, '/login')}>
              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700">
                {t('goToLogin')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Reset form
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-50 to-emerald-50 p-4">
      <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <Logo size="lg" />
          </div>
          <div>
            <CardTitle className="text-2xl">
              {t('title')}
            </CardTitle>
            <CardDescription className="mt-2">
              {t('subtitle')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="password">
                {t('newPassword')}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-10 pr-10"
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('newPasswordPlaceholder')}
              </p>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t('confirmPassword')}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-12 pl-10 pr-10"
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700"
              disabled={isLoading || password.length < 6 || password !== confirmPassword}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('resetting')}
                </>
              ) : (
                t('submit')
              )}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 text-center">
            <Link
              href={localePath(locale, '/login')}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t('backToLogin')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
