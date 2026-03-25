'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const locale = useLocale();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  });

  const onSubmit = async () => {
    // In a real implementation, this would send a password reset email
    // For now, just show success message
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setSubmitted(true);
  };

  const content = {
    en: {
      title: 'Reset Password',
      subtitle: 'Enter your email address and we\'ll send you instructions to reset your password.',
      email: 'Email Address',
      emailPlaceholder: 'name@example.com',
      submit: 'Send Reset Link',
      backToLogin: 'Back to Login',
      successTitle: 'Check Your Email',
      successMessage: 'If an account exists with that email, we\'ve sent password reset instructions.',
      note: 'Note: Password reset functionality is being set up. Please contact the administrator if you need immediate assistance.',
    },
    bn: {
      title: 'পাসওয়ার্ড রিসেট করুন',
      subtitle: 'আপনার ইমেইল ঠিকানা দিন এবং আমরা পাসওয়ার্ড রিসেট করার নির্দেশনা পাঠাবো।',
      email: 'ইমেইল ঠিকানা',
      emailPlaceholder: 'name@example.com',
      submit: 'রিসেট লিংক পাঠান',
      backToLogin: 'লগইনে ফিরুন',
      successTitle: 'আপনার ইমেইল চেক করুন',
      successMessage: 'যদি এই ইমেইলে কোনো অ্যাকাউন্ট থাকে, তাহলে আমরা পাসওয়ার্ড রিসেটের নির্দেশনা পাঠিয়েছি।',
      note: 'দ্রষ্টব্য: পাসওয়ার্ড রিসেট ফিচার সেটআপ করা হচ্ছে। জরুরি সাহায্যের জন্য অনুগ্রহ করে প্রশাসকের সাথে যোগাযোগ করুন।',
    },
  };

  const t = content[locale as keyof typeof content] || content.en;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-[400px]">
        <div className="mb-10 text-center">
          <Link href={`/${locale}`} className="inline-block mb-8">
            <Logo size="md" showTagline={false} />
          </Link>

          {submitted ? (
            <>
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Mail className="h-8 w-8 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                {t.successTitle}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mb-6">
                {t.successMessage}
              </p>
              <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg mb-6">
                {t.note}
              </p>
              <Link href={`/${locale}/login`}>
                <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t.backToLogin}
                </Button>
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                {t.title}
              </h1>
              <p className="text-slate-500 dark:text-slate-400">
                {t.subtitle}
              </p>
            </>
          )}
        </div>

        {!submitted && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                {t.email}
              </Label>
              <Input
                id="email"
                type="email"
                className="h-12 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 focus:border-emerald-500 focus:ring-emerald-500/20 rounded-lg"
                placeholder={t.emailPlaceholder}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
              {t.note}
            </p>

            <Button
              type="submit"
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </span>
              ) : (
                t.submit
              )}
            </Button>

            <div className="text-center">
              <Link
                href={`/${locale}/login`}
                className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.backToLogin}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
