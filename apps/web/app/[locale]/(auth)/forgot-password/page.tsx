'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Mail, Phone, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { AuthBackdrop } from '@/components/layout/auth-backdrop';
import { toast } from '@/hooks/use-toast';
import { localePath } from '@/lib/locale-path';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

export default function ForgotPasswordPage() {
  const locale = useLocale();
  const t = useTranslations('auth.forgot');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [inputType, setInputType] = useState<'email' | 'phone'>('email');
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim()) {
      toast({
        title: t('errorTitle'),
        description: t('identifierRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: inputValue.trim(),
          locale,
        }),
      });

      const result = await response.json();
      const isSuccess = response.ok && Boolean(result?.success || result?.ok);
      const successMessage = result?.data?.message || result?.message;
      const errorMessage = result?.error?.message || result?.error || 'Failed to send reset email';

      if (isSuccess) {
        setEmailSent(true);
        toast({
          title: t('successTitle'),
          description:
            successMessage ||
            (t('successToast')),
          variant: 'success',
        });
      } else {
        throw new Error(errorMessage);
      }
    } catch (error) {
      toast({
        title: t('errorTitle'),
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center p-4">
        <AuthBackdrop />
        <Card className="relative z-10 w-full max-w-md rounded-2xl border-slate-200 card-raise">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            {/* Conditional wording: the API answers identically for members and non-members (WO-88). */}
            <CardTitle as="h1" className="text-2xl">
              {t('sentTitle')}
            </CardTitle>
            <CardDescription className="text-base">
              {t('sentBody')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
              {t('sentTip')}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEmailSent(false);
                  setInputValue('');
                }}
                className="w-full"
              >
                {t('tryAgain')}
              </Button>
              <Link href={localePath(locale, '/login')}>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t('backToLogin')}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4">
        <AuthBackdrop />
      <Card className="relative z-10 w-full max-w-md rounded-2xl border-slate-200 card-raise">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <Logo size="lg" />
          </div>
          <div>
            <CardTitle as="h1" className="text-2xl">
              {t('title')}
            </CardTitle>
            <CardDescription className="mt-2">
              {t('subtitle')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Input Type Toggle */}
            <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setInputType('email');
                  setInputValue('');
                }}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  inputType === 'email'
                    ? 'bg-white shadow-xs text-emerald-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mail className="h-4 w-4 inline mr-2" />
                {t('emailTab')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputType('phone');
                  setInputValue('');
                }}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  inputType === 'phone'
                    ? 'bg-white shadow-xs text-emerald-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Phone className="h-4 w-4 inline mr-2" />
                {t('phoneTab')}
              </button>
            </div>

            {/* Input Field */}
            <div className="space-y-2">
              <Label htmlFor="input">
                {inputType === 'email'
                  ? (t('emailLabel'))
                  : (t('phoneLabel'))}
              </Label>
              <Input
                id="input"
                type={inputType === 'email' ? 'email' : 'tel'}
                placeholder={
                  inputType === 'email'
                    ? 'example@email.com'
                    : '01XXXXXXXXX'
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="h-12"
                disabled={isLoading}
              />
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('sending')}
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
