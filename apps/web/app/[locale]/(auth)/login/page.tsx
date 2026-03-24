'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Eye, EyeOff, ArrowRight, Home, Globe, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo, LogoIcon } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';

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
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
      const response = await fetch(`${apiBase}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: data.identifier, password: data.password }),
      });

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
    if (token) {
      localStorage.setItem('hn_access_token', token);
      // Dispatch custom event for header to update
      window.dispatchEvent(new Event('auth-change'));
    }
    
    // Show success toast
    toast({
      title: locale === 'bn' ? 'সফলভাবে লগইন হয়েছে' : 'Login Successful',
      description: locale === 'bn' ? 'আপনাকে স্বাগতম!' : 'Welcome back!',
      variant: 'success',
    });
    
    const rolePath =
      role === 'ADMIN'
        ? `/${locale}/dashboard/admin`
        : role === 'WORKER'
          ? `/${locale}/dashboard/worker`
          : `/${locale}/dashboard/member`;

    router.push(rolePath);
    router.refresh();
    } catch {
      setSubmitError(
        locale === 'bn'
          ? 'সার্ভারের সাথে সংযোগ করতে ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Failed to connect to server. Please try again.'
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="container-wide flex h-14 items-center justify-between">
          <Link href={`/${locale}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">{locale === 'bn' ? 'হোম' : 'Home'}</span>
          </Link>
          
          <div className="flex items-center gap-3">
            <Link href={`/${otherLocale}/login`}>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span className="text-sm">{locale === 'en' ? 'বাংলা' : 'English'}</span>
              </Button>
            </Link>
            <Link href={`/${locale}/#contact`}>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <HelpCircle className="h-4 w-4" />
                <span className="text-sm hidden sm:inline">{locale === 'bn' ? 'সাহায্য' : 'Help'}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 flex pt-14">
        {/* Left Panel - Branding */}
        <aside className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-12 flex-col justify-between relative overflow-hidden">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 w-72 h-72 rounded-full border-2 border-white" />
            <div className="absolute bottom-32 right-10 w-48 h-48 rounded-full border-2 border-white" />
            <div className="absolute top-1/2 left-1/3 w-32 h-32 rounded-full border border-white" />
          </div>

          <div className="relative z-10">
            <Link href={`/${locale}`}>
              <Logo size="lg" variant="light" showTagline={false} />
            </Link>
          </div>

          <div className="relative z-10 space-y-6">
            <h1 className="text-4xl font-bold text-white leading-tight">
              {locale === 'bn' 
                ? 'সুদমুক্ত আর্থিক সেবায় স্বাগতম' 
                : 'Welcome to Interest-Free Finance'}
            </h1>
            <p className="text-lg text-emerald-100/90 max-w-md">
              {locale === 'bn'
                ? 'আপনার সমবায় অ্যাকাউন্টে লগইন করে সঞ্চয়, ঋণ এবং আরও অনেক কিছু পরিচালনা করুন।'
                : 'Login to your cooperative account to manage savings, loans, and more.'}
            </p>
          </div>

          <div className="relative z-10 space-y-4">
            <p className="text-sm text-emerald-200/80">
              {locale === 'bn' ? 'সংযোগ হোক আর্থিক আস্থায়' : 'Connecting people and trust'}
            </p>
            {/* Quick Links */}
            <div className="flex gap-4 text-sm">
              <Link href={`/${locale}/#about`} className="text-emerald-200 hover:text-white transition-colors">
                {locale === 'bn' ? 'আমাদের সম্পর্কে' : 'About Us'}
              </Link>
              <Link href={`/${locale}/#how-it-works`} className="text-emerald-200 hover:text-white transition-colors">
                {locale === 'bn' ? 'কিভাবে কাজ করে' : 'How It Works'}
              </Link>
              <Link href={`/${locale}/#contact`} className="text-emerald-200 hover:text-white transition-colors">
                {locale === 'bn' ? 'যোগাযোগ' : 'Contact'}
              </Link>
            </div>
          </div>
        </aside>

        {/* Right Panel - Login Form */}
        <main className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12 bg-slate-50">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden mb-8 text-center">
              <Link href={`/${locale}`} className="inline-block">
                <Logo size="md" showTagline={false} />
              </Link>
            </div>

            {/* Form Header */}
            <div className="mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                {t('loginTitle')}
              </h2>
              <p className="text-muted-foreground">
                {t('loginSubtitle')}
              </p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-sm font-medium">
                  {t('email')}
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  className="h-11 bg-white border-slate-200 focus:border-primary focus:ring-primary/20"
                  placeholder={locale === 'bn' ? 'ইমেইল বা ফোন নম্বর' : 'Email or phone number'}
                  {...register('identifier')}
                />
                {errors.identifier && (
                  <p className="text-sm text-red-500">{errors.identifier.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">
                    {t('password')}
                  </Label>
                  <Link
                    href={`/${locale}/forgot-password`}
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className="h-11 bg-white border-slate-200 pr-11 focus:border-primary focus:ring-primary/20"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-red-500">{errors.password.message}</p>
                )}
              </div>

              {submitError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                  <p className="text-sm text-red-600">{submitError}</p>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full h-11 text-base font-medium shadow-sm" 
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {locale === 'bn' ? 'অপেক্ষা করুন...' : 'Please wait...'}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {t('signIn')}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-50 px-3 text-muted-foreground">
                  {locale === 'bn' ? 'অথবা' : 'or continue with'}
                </span>
              </div>
            </div>

            {/* Social Login (Disabled for now) */}
            <div className="space-y-3">
              <Button 
                variant="outline" 
                className="w-full h-11 bg-white hover:bg-slate-50" 
                type="button" 
                disabled
              >
                <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </Button>
            </div>

            {/* Sign Up Link */}
            <p className="text-center text-sm text-muted-foreground mt-8">
              {t('noAccount')}{' '}
              <Link
                href={`/${locale}/register`}
                className="font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {t('signUp')}
              </Link>
            </p>
          </div>
        </main>
      </div>

      {/* Bottom Footer */}
      <footer className="bg-white border-t border-slate-100 py-4">
        <div className="container-wide flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Hasnahena</p>
          <div className="flex gap-4">
            <Link href={`/${locale}/privacy`} className="hover:text-foreground transition-colors">
              {locale === 'bn' ? 'গোপনীয়তা নীতি' : 'Privacy'}
            </Link>
            <Link href={`/${locale}/terms`} className="hover:text-foreground transition-colors">
              {locale === 'bn' ? 'শর্তাবলী' : 'Terms'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
