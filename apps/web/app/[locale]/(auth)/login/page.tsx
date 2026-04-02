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
import { Logo, LogoIcon } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { setClientAuthToken } from '@/lib/client-auth';

const loginSchema = z.object({
  identifier: z.string().min(3, 'Email or phone is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState('');

  useEffect(() => {
    fetch('/api/v1/settings')
      .then(res => res.json())
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
    if (token) {
      setClientAuthToken(token, typeof expiresIn === 'number' ? expiresIn : undefined);
      if (mustChangePassword) {
        localStorage.setItem('hn_force_password_change', '1');
      } else {
        localStorage.removeItem('hn_force_password_change');
      }
    }
    
    // Show success toast
    toast({
      title: locale === 'bn' ? 'সফলভাবে লগইন হয়েছে' : 'Login Successful',
      description: locale === 'bn' ? 'আপনাকে স্বাগতম!' : 'Welcome back!',
      variant: 'success',
    });
    
    const rolePath =
      role === 'ADMIN' || role === 'SUPER_ADMIN'
        ? `/${locale}/dashboard/admin`
        : role === 'WORKER'
          ? `/${locale}/dashboard/worker`
          : `/${locale}/dashboard/member`;

    if (mustChangePassword) {
      router.replace(`${rolePath}/profile?forcePasswordChange=1`);
    } else {
      router.replace(rolePath);
    }
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

  return (
    <div className="min-h-[100dvh] flex flex-col relative w-full items-center justify-center bg-zinc-50 overflow-hidden">
      {/* Immersive Nature Background */}
      <div className="absolute inset-0 z-0 bg-slate-50">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 h-[500px] w-[500px] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 h-[500px] w-[500px] rounded-full bg-teal-200/40 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
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
          <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400" />
          
          <div className="p-6 sm:p-10">
            {/* Form Header */}
            <div className="text-center mb-4 flex flex-col items-center">
              <Link href={`/${locale}`} className="inline-flex items-center justify-center mb-2">
                <Logo size="lg" className="drop-shadow-sm" />
              </Link>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
                {welcomeMessage || t('welcomeBack')}
              </h2>
              <p className="text-[14px] text-slate-500 font-medium">
                {t('loginSubtitle')}
              </p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-[13px] font-semibold text-slate-700 ml-1">
                  {t('email')}
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  className="h-12 bg-white/60 border-slate-200/60 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-sm"
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
                    className="h-12 bg-white/60 border-slate-200/60 pr-12 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20 rounded-xl transition-all text-slate-900 px-4 placeholder:text-slate-400 shadow-sm"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center z-10 text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 rounded-lg transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-[12px] font-medium text-red-500 ml-1">{errors.password.message}</p>
                )}
              </div>

              {submitError && (
                <div className="p-4 mt-2 rounded-xl bg-red-50/80 border border-red-100 backdrop-blur-sm shadow-sm animate-in fade-in zoom-in-95 duration-200">
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
