'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, ArrowRight, Home, Globe, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { setClientAuthToken } from '@/lib/client-auth';
import { fetchSettings } from '@/lib/settings-client';
import { localizedSetting } from '@/lib/localized-settings';
import { localePath, otherLocale } from '@/lib/locale-path';

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
    ? localePath(locale, '/dashboard/admin')
    : role === 'WORKER'
      ? localePath(locale, '/dashboard/worker')
      : localePath(locale, '/dashboard/member');
}

export default function LoginPage() {
  const t = useTranslations('auth');
  // This screen's own copy (WO-96).
  const tp = useTranslations('auth.login');
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
    // Anonymous; same helper as everywhere for one endpoint shape.
    fetchSettings()
      .then(data => {
        // A prose pair — through localizedSetting.
        const greeting = localizedSetting(data, 'auth.welcomeBack', locale);
        if (greeting) setWelcomeMessage(greeting);
      })
      .catch(() => {}); // Silently fail
  }, [locale]);

  const other = otherLocale(locale);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  /**
   * One login per press, checked synchronously before the first await:
   * isSubmitting is state and lags a render, and two racing logins can leave
   * the browser holding a replaced token.
   */
  const loginInFlight = useRef(false);

  const onSubmit = async (data: LoginFormData) => {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
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
        // Branch on the error CODE, never the English message.
        const errorCode = typeof payload?.error?.code === 'string' ? payload.error.code : '';
        const errorMessage = payload?.error?.message || 'Login failed';
        if (errorCode === 'AUTH_USER_INACTIVE') {
          setSubmitError(tp('accountNotActive'));
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
            tp('firstLoginSessionFailed')
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
          title: tp('firstLoginTitle'),
          description:
            tp('firstLoginSubtitle'),
          variant: 'success',
        });
        return;
      }

      if (token) {
        setClientAuthToken(token, typeof expiresIn === 'number' ? expiresIn : undefined);
        localStorage.removeItem('hn_force_password_change');
      }

      toast({
        title: tp('successTitle'),
        description: tp('successBody'),
        variant: 'success',
      });

      router.replace(getRolePath(role, locale));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setSubmitError(
          tp('serverSlow')
        );
        return;
      }
      setSubmitError(
        tp('serverUnavailable')
      );
    } finally {
      // Reset on success too: a failed navigation may bring the member back.
      loginInFlight.current = false;
    }
  };

  const handleFirstLoginPasswordUpdate = async () => {
    if (!pendingFirstLogin) {
      return;
    }

    setSubmitError(null);

    if (newPassword.length < 8) {
      setSubmitError(tp('passwordTooShort'));
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setSubmitError(
        tp('passwordTooSimple')
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setSubmitError(tp('passwordMismatch'));
      return;
    }
    if (newPassword === pendingFirstLogin.currentPassword) {
      setSubmitError(
        tp('passwordUnchanged')
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
        setSubmitError(changePayload?.error?.message || (tp('passwordUpdateFailed')));
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
          tp('passwordUpdatedSignInFailed')
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
        title: tp('passwordUpdatedTitle'),
        description:
          tp('passwordUpdatedBody'),
        variant: 'success',
      });

      router.replace(getRolePath(role, locale));
    } catch {
      setSubmitError(
        tp('passwordUpdateError')
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
        <Link href={localePath(locale)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors group px-3 py-2 rounded-full hover:bg-slate-200/50 ">
          <Home className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
          <span className="text-[13px] font-semibold tracking-wide">{tp('home')}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href={localePath(other, '/login')}>
            <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-full px-4  h-9">
              <Globe className="h-[14px] w-[14px] opacity-80" strokeWidth={2.5} />
              <span className="text-[13px] font-semibold">{locale === 'en' ? 'বাংলা' : 'English'}</span>
            </Button>
          </Link>
          <Link href={localePath(locale, '/#contact')} className="hidden sm:block">
            <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-full px-4 h-9">
              <HelpCircle className="h-[14px] w-[14px]" />
              <span className="text-[13px] font-semibold">{tp('help')}</span>
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
              <Link href={localePath(locale)} className="inline-flex items-center justify-center mb-2">
                <span className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2 shadow-xs ring-1 ring-black/5">
                  <Logo size="lg" priority />
                </span>
              </Link>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
                {welcomeMessage || tp('successBody')}
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
                  {tp('firstLoginHelp')}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-[13px] font-semibold text-slate-700 ml-1">
                    {tp('newPassword')}
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
                    {tp('confirmPassword')}
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
                      {tp('updating')}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 w-full">
                      {tp('setPasswordAndContinue')}
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
                  {tp('backToLoginForm')}
                </Button>
              </form>
            ) : (
              <form
                // Built in the event: a ref read at render is refused by the React Compiler.
                onSubmit={(event) => {
                  void handleSubmit(onSubmit)(event);
                }}
                className="space-y-4"
              >
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-[13px] font-semibold text-slate-700 ml-1">
                  {t('email')}
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  className="h-12 bg-white/60 border-slate-200/60 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-xs"
                  placeholder={tp('identifierPlaceholder')}
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
                    href={localePath(locale, '/forgot-password')}
                    className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
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
                  {/* Shown on EVERY failure: telling a pending applicant "under review" would confirm membership (ADR-032, rule 7a). */}
                  <p className="mt-2 text-[12px] text-red-700/80 leading-snug text-center">
                    {tp('pendingApplicationHint')}
                  </p>
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
                    {tp('authenticating')}
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
                  href={localePath(locale, '/register')}
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
          &copy; {new Date().getFullYear()} Hasnahena. {tp('allRightsReserved')}
        </div>
      </main>
    </div>
  );
}
