'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect } from 'react';
import { Eye, EyeOff, ArrowRight, Home, Globe, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { setClientAuthToken } from '@/lib/client-auth';
import { fetchSettings } from '@/lib/settings-client';

const loginSchema = z.object({
  identifier: z.string().min(3, 'Email or phone is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

type PendingFirstLogin = {
  identifier: string;
  currentPassword: string;
  token: string;
  role?: string;
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

function getRolePath(role: string | undefined, locale: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
    ? `/${locale}/dashboard/admin`
    : role === 'WORKER'
      ? `/${locale}/dashboard/worker`
      : `/${locale}/dashboard/member`;
}

export default function LoginPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [pendingFirstLogin, setPendingFirstLogin] = useState<PendingFirstLogin | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    // Anonymous by definition — nobody is signed in on this screen — and
    // `auth.welcomeBack` is in the public tier, so this is the one caller WO-77
    // changes nothing for. It goes through the same helper as the rest so there
    // is one place that knows this endpoint's shape.
    fetchSettings()
      .then(data => {
        if (data && data['auth.welcomeBack']) {
          setWelcomeMessage(data['auth.welcomeBack']);
        }
      })
      .catch(() => {}); // Silently fail
  }, []);

  const otherLocale = locale === 'en' ? 'bn' : 'en';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setSubmitError(null);

    try {
      const controller = new AbortController();
      // Increased timeout to 60s to handle Render cold starts
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      let response: Response;
      try {
        response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: data.identifier, password: data.password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        // Handle pending user case with a more helpful message
        const errorMessage = payload?.error?.message || 'Login failed';
        if (errorMessage.toLowerCase().includes('not active')) {
          setSubmitError(
            locale === 'bn'
              ? 'আপনার অ্যাকাউন্ট এখনও সক্রিয় হয়নি। অনুগ্রহ করে অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।'
              : 'Your account is not active yet. Please wait for admin approval.'
          );
        } else {
          setSubmitError(errorMessage);
        }
        return;
      }

      const role = payload?.data?.user?.role;
      const token = payload?.data?.accessToken;
      const expiresIn = payload?.data?.expiresIn;
      const mustChangePassword = Boolean(payload?.data?.user?.mustChangePassword);

      if (mustChangePassword) {
        if (!token) {
          setSubmitError(
            locale === 'bn'
              ? 'পাসওয়ার্ড আপডেটের জন্য সেশন তৈরি করা যায়নি। আবার লগইন করুন।'
              : 'Unable to initialize first-login password update. Please sign in again.'
          );
          return;
        }

        setPendingFirstLogin({
          identifier: data.identifier,
          currentPassword: data.password,
          token,
          role,
        });
        setNewPassword('');
        setConfirmPassword('');
        setSubmitError(null);

        toast({
          title: locale === 'bn' ? 'নতুন পাসওয়ার্ড সেট করুন' : 'Set a new password',
          description:
            locale === 'bn'
              ? 'প্রথম লগইনের জন্য একটি নতুন পাসওয়ার্ড দিন এবং এটি পরবর্তী লগইনের জন্য মনে রাখুন।'
              : 'For your first login, set a new password and remember it for your next login.',
          variant: 'success',
        });
        return;
      }

      if (token) {
        setClientAuthToken(token, typeof expiresIn === 'number' ? expiresIn : undefined);
        localStorage.removeItem('hn_force_password_change');
      }

      toast({
        title: locale === 'bn' ? 'সফলভাবে লগইন হয়েছে' : 'Login Successful',
        description: locale === 'bn' ? 'আপনাকে স্বাগতম!' : 'Welcome back!',
        variant: 'success',
      });

      router.replace(getRolePath(role, locale));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setSubmitError(
          locale === 'bn'
            ? 'লগইন সার্ভার সাড়া দিতে দেরি করছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Login server is taking too long. Please try again.'
        );
        return;
      }
      setSubmitError(
        locale === 'bn'
          ? 'লগইন আপাতত সম্ভব হচ্ছে না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
          : 'Login is temporarily unavailable. Please try again shortly.'
      );
    }
  };

  const handleFirstLoginPasswordUpdate = async () => {
    if (!pendingFirstLogin) {
      return;
    }

    setSubmitError(null);

    if (newPassword.length < 8) {
      setSubmitError(locale === 'bn' ? 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' : 'New password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setSubmitError(
        locale === 'bn'
          ? 'নতুন পাসওয়ার্ডে অন্তত একটি বড় হাতের অক্ষর, একটি ছোট হাতের অক্ষর এবং একটি সংখ্যা থাকতে হবে।'
          : 'New password must include at least one uppercase letter, one lowercase letter, and one number.'
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setSubmitError(locale === 'bn' ? 'নতুন পাসওয়ার্ড এবং নিশ্চিতকরণ মিলেনি।' : 'New password and confirmation do not match.');
      return;
    }
    if (newPassword === pendingFirstLogin.currentPassword) {
      setSubmitError(
        locale === 'bn'
          ? 'নতুন পাসওয়ার্ড অস্থায়ী পাসওয়ার্ডের মতো হতে পারবে না।'
          : 'New password cannot be the same as the temporary password.'
      );
      return;
    }

    setIsChangingPassword(true);
    try {
      const changeResponse = await fetch(`${API_BASE_URL}/v1/dashboard/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingFirstLogin.token}`,
        },
        body: JSON.stringify({
          currentPassword: pendingFirstLogin.currentPassword,
          newPassword,
        }),
      });

      const changePayload = await changeResponse.json().catch(() => ({}));
      if (!changeResponse.ok || !changePayload?.success) {
        setSubmitError(changePayload?.error?.message || (locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন করা যায়নি।' : 'Failed to update password.'));
        return;
      }

      const loginResponse = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: pendingFirstLogin.identifier,
          password: newPassword,
        }),
      });

      const loginPayload = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok || !loginPayload?.success) {
        setSubmitError(
          locale === 'bn'
            ? 'পাসওয়ার্ড পরিবর্তন হয়েছে, কিন্তু স্বয়ংক্রিয় লগইন ব্যর্থ হয়েছে। নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন।'
            : 'Password updated, but automatic sign-in failed. Please sign in again with your new password.'
        );
        setPendingFirstLogin(null);
        return;
      }

      const finalToken = loginPayload?.data?.accessToken;
      const expiresIn = loginPayload?.data?.expiresIn;
      const role = loginPayload?.data?.user?.role;
      if (finalToken) {
        setClientAuthToken(finalToken, typeof expiresIn === 'number' ? expiresIn : undefined);
      }
      localStorage.removeItem('hn_force_password_change');

      toast({
        title: locale === 'bn' ? 'পাসওয়ার্ড আপডেট সম্পন্ন' : 'Password updated',
        description:
          locale === 'bn'
            ? 'নতুন পাসওয়ার্ড সেট হয়েছে। পরবর্তী লগইনে এই পাসওয়ার্ড ব্যবহার করুন।'
            : 'Your new password is set. Use this password for your next login.',
        variant: 'success',
      });

      router.replace(getRolePath(role, locale));
    } catch {
      setSubmitError(
        locale === 'bn'
          ? 'পাসওয়ার্ড পরিবর্তনের সময় সমস্যা হয়েছে। আবার চেষ্টা করুন।'
          : 'Something went wrong while updating password. Please try again.'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col relative w-full items-center justify-center bg-zinc-50 overflow-hidden">
      {/* Immersive Nature Background */}
      <div className="absolute inset-0 z-0 bg-slate-50">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 h-[500px] w-[500px] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 h-[500px] w-[500px] rounded-full bg-teal-200/40 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-size-[24px_24px]" />
      </div>

      {/* Top Navigation Bar - Floating & Glassy */}
      <header className="absolute top-0 left-0 right-0 z-50 p-4 sm:p-6 w-full flex justify-between items-center">
        <Link href={`/${locale}`} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors group px-3 py-2 rounded-full hover:bg-slate-200/50 ">
          <Home className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
          <span className="text-[13px] font-semibold tracking-wide">{locale === 'bn' ? 'হোম' : 'Home'}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/${otherLocale}/login`}>
            <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-full px-4  h-9">
              <Globe className="h-[14px] w-[14px] opacity-80" strokeWidth={2.5} />
              <span className="text-[13px] font-semibold">{locale === 'en' ? 'বাংলা' : 'English'}</span>
            </Button>
          </Link>
          <Link href={`/${locale}/#contact`} className="hidden sm:block">
            <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-full px-4 h-9">
              <HelpCircle className="h-[14px] w-[14px]" />
              <span className="text-[13px] font-semibold">{locale === 'bn' ? 'সাহায্য' : 'Help'}</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Login Card - Glassmorphism Mobile-First */}
      <main className="relative z-10 w-full max-w-[440px] px-4 sm:px-6 py-10 flex-1 flex flex-col justify-center animate-in slide-in-from-bottom-8 fade-in-50 duration-700">
        
        {/* Card Container */}
        <div className="bg-white/70 backdrop-blur-xl sm:bg-white border border-white/20 shadow-2xl shadow-emerald-900/30 rounded-[28px] overflow-hidden">
          
          {/* Decorative Top Accent */}
          <div className="h-1.5 w-full bg-linear-to-r from-emerald-400 via-emerald-500 to-teal-400" />
          
          <div className="p-6 sm:p-10">
            {/* Form Header */}
            <div className="text-center mb-4 flex flex-col items-center">
              <Link href={`/${locale}`} className="inline-flex items-center justify-center mb-2">
                <span className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2 shadow-xs ring-1 ring-black/5">
                  <Logo size="lg" priority />
                </span>
              </Link>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
                {welcomeMessage || t('welcomeBack')}
              </h2>
              <p className="text-[14px] text-slate-500 font-medium">
                {t('loginSubtitle')}
              </p>
            </div>

            {/* Login / First Login Form */}
            {pendingFirstLogin ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleFirstLoginPasswordUpdate();
                }}
                className="space-y-4"
              >
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                  {locale === 'bn'
                    ? 'প্রথম লগইনের জন্য একটি নতুন পাসওয়ার্ড সেট করুন। দয়া করে এটি মনে রাখুন, পরবর্তী লগইনে এই পাসওয়ার্ডই লাগবে।'
                    : 'Set a new password for your first login. Please remember it, as this password will be required for your next login.'}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-[13px] font-semibold text-slate-700 ml-1">
                    {locale === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      className="h-12 bg-white/60 border-slate-200/60 pr-12 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-xs"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center z-10 text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 rounded-lg transition-colors"
                      aria-label={tA11y('togglePassword')}
                    >
                      {showNewPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-[13px] font-semibold text-slate-700 ml-1">
                    {locale === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'}
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="h-12 bg-white/60 border-slate-200/60 pr-12 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-xs"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center z-10 text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 rounded-lg transition-colors"
                      aria-label={tA11y('togglePassword')}
                    >
                      {showConfirmPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>

                {submitError && (
                  <div className="p-4 mt-2 rounded-xl bg-red-50/80 border border-red-100 backdrop-blur-xs shadow-xs animate-in fade-in zoom-in-95 duration-200">
                    <p className="text-[13px] font-semibold text-red-600 leading-snug text-center">{submitError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 mt-4 text-[15px] font-bold shadow-lg shadow-emerald-600/20 bg-emerald-600 hover:bg-emerald-500 hover:-translate-y-0.5 active:translate-y-0 text-white transition-all rounded-xl"
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      {locale === 'bn' ? 'আপডেট হচ্ছে...' : 'Updating...'}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 w-full">
                      {locale === 'bn' ? 'পাসওয়ার্ড সেট করে লগইন করুন' : 'Set Password and Continue'}
                      <ArrowRight className="h-[18px] w-[18px] opacity-80" />
                    </span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full h-11 text-[13px] font-semibold text-slate-600"
                  onClick={() => {
                    setPendingFirstLogin(null);
                    setNewPassword('');
                    setConfirmPassword('');
                    setSubmitError(null);
                  }}
                >
                  {locale === 'bn' ? 'লগইন ফর্মে ফিরে যান' : 'Back to login form'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-[13px] font-semibold text-slate-700 ml-1">
                  {t('email')}
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  className="h-12 bg-white/60 border-slate-200/60 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-xs"
                  placeholder={locale === 'bn' ? 'ইমেইল বা ফোন নম্বর' : 'name@example.com'}
                  {...register('identifier')}
                />
                {errors.identifier && (
                  <p className="text-[12px] font-medium text-red-500 ml-1">{errors.identifier.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between ml-1">
                  <Label htmlFor="password" className="text-[13px] font-semibold text-slate-700">
                    {t('password')}
                  </Label>
                  <Link
                    href={`/${locale}/forgot-password`}
                    className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    data-no-native-password-toggle
                    className="h-12 bg-white/60 border-slate-200/60 pr-12 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-xs"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center z-10 text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 rounded-lg transition-colors"
                    aria-label={tA11y('togglePassword')}
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-[12px] font-medium text-red-500 ml-1">{errors.password.message}</p>
                )}
              </div>

              {submitError && (
                <div className="p-4 mt-2 rounded-xl bg-red-50/80 border border-red-100 backdrop-blur-xs shadow-xs animate-in fade-in zoom-in-95 duration-200">
                  <p className="text-[13px] font-semibold text-red-600 leading-snug text-center">{submitError}</p>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full h-12 mt-4 text-[15px] font-bold shadow-lg shadow-emerald-600/20 bg-emerald-600 hover:bg-emerald-500 hover:-translate-y-0.5 active:translate-y-0 text-white transition-all rounded-xl" 
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    {locale === 'bn' ? 'অপেক্ষা করুন...' : 'Authenticating...'}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2 w-full">
                    {t('signIn')}
                    <ArrowRight className="h-[18px] w-[18px] opacity-80" />
                  </span>
                )}
              </Button>
            </form>
            )}

            <div className="mt-8 text-center">
              <p className="text-[13px] text-slate-500 font-medium">
                {t('noAccount')}{' '}
                <Link
                  href={`/${locale}/register`}
                  className="font-bold text-emerald-600 hover:text-emerald-700 transition-colors underline decoration-emerald-600/30 underline-offset-4 hover:decoration-emerald-600"
                >
                  {t('signUp')}
                </Link>
              </p>
            </div>
          </div>
        </div>
        
        {/* Footer Credit Layer */}
        <div className="mt-8 text-center text-slate-500/80 text-[12px] font-medium">
          &copy; {new Date().getFullYear()} Hasnahena. {locale === 'bn' ? 'সর্বসত্ব সংরক্ষিত' : 'All rights reserved.'}
        </div>
      </main>
    </div>
  );
}
