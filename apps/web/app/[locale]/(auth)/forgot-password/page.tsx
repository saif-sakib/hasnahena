'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { Mail, Phone, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';

export default function ForgotPasswordPage() {
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [inputType, setInputType] = useState<'email' | 'phone'>('email');
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim()) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'ইমেইল বা ফোন নম্বর দিন' : 'Please enter email or phone',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [inputType]: inputValue,
          locale,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        setEmailSent(true);
        toast({
          title: locale === 'bn' ? 'সফল' : 'Success',
          description: result.message,
          variant: 'success',
        });
      } else {
        throw new Error(result.error || 'Failed to send reset email');
      }
    } catch (error) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 p-4">
        <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl">
              {locale === 'bn' ? 'ইমেইল পাঠানো হয়েছে!' : 'Email Sent!'}
            </CardTitle>
            <CardDescription className="text-base">
              {locale === 'bn'
                ? 'যদি এই ইমেইল/ফোন আমাদের সিস্টেমে থাকে, আপনি একটি পাসওয়ার্ড রিসেট লিঙ্ক পাবেন। আপনার ইনবক্স চেক করুন।'
                : 'If this email/phone exists in our system, you will receive a password reset link. Please check your inbox.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
              {locale === 'bn'
                ? '💡 টিপস: স্প্যাম ফোল্ডারও চেক করুন। লিঙ্কটি ১ ঘন্টার মধ্যে মেয়াদ উত্তীর্ণ হবে।'
                : '💡 Tip: Check your spam folder too. The link expires in 1 hour.'}
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
                {locale === 'bn' ? 'আবার চেষ্টা করুন' : 'Try Again'}
              </Button>
              <Link href={`/${locale}/login`}>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {locale === 'bn' ? 'লগইন পেজে ফিরুন' : 'Back to Login'}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 p-4">
      <Card className="w-full max-w-md rounded-2xl border-slate-200 shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <Logo size="lg" />
          </div>
          <div>
            <CardTitle className="text-2xl">
              {locale === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot Password?'}
            </CardTitle>
            <CardDescription className="mt-2">
              {locale === 'bn'
                ? 'আপনার ইমেইল বা ফোন নম্বর দিন। আমরা আপনাকে রিসেট লিঙ্ক পাঠাব।'
                : 'Enter your email or phone number. We\'ll send you a reset link.'}
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
                    ? 'bg-white shadow-sm text-emerald-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mail className="h-4 w-4 inline mr-2" />
                {locale === 'bn' ? 'ইমেইল' : 'Email'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputType('phone');
                  setInputValue('');
                }}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  inputType === 'phone'
                    ? 'bg-white shadow-sm text-emerald-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Phone className="h-4 w-4 inline mr-2" />
                {locale === 'bn' ? 'ফোন' : 'Phone'}
              </button>
            </div>

            {/* Input Field */}
            <div className="space-y-2">
              <Label htmlFor="input">
                {inputType === 'email'
                  ? (locale === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address')
                  : (locale === 'bn' ? 'ফোন নম্বর' : 'Phone Number')}
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
                  {locale === 'bn' ? 'পাঠানো হচ্ছে...' : 'Sending...'}
                </>
              ) : (
                locale === 'bn' ? 'রিসেট লিঙ্ক পাঠান' : 'Send Reset Link'
              )}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 text-center">
            <Link
              href={`/${locale}/login`}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {locale === 'bn' ? 'লগইন পেজে ফিরুন' : 'Back to Login'}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
