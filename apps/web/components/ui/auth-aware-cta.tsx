'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AuthAwareCTAProps {
  locale: string;
  ctaText: string;
  learnMoreText?: string;
  variant: 'hero' | 'footer';
}

export function AuthAwareCTA({ locale, ctaText, learnMoreText, variant }: AuthAwareCTAProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
      const token = typeof window !== 'undefined'
        ? localStorage.getItem('hn_access_token')
        : null;
      setIsLoggedIn(!!token);
      setIsLoading(false);
    };

    checkAuth();

    window.addEventListener('storage', checkAuth);
    window.addEventListener('auth-change', checkAuth);

    return () => {
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('auth-change', checkAuth);
    };
  }, []);

  // Show loading placeholder to prevent layout shift
  if (isLoading) {
    if (variant === 'hero') {
      return (
        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <div className="h-12 w-40 bg-primary/20 rounded-lg animate-pulse" />
          <div className="h-12 w-32 bg-muted rounded-lg animate-pulse" />
        </div>
      );
    }
    return <div className="h-40 bg-emerald-500/50 animate-pulse" />;
  }

  if (variant === 'hero') {
    if (isLoggedIn) {
      return (
        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <Link href={`/${locale}/dashboard/member`}>
            <Button size="xl" className="gap-2 w-full sm:w-auto shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
              <LayoutDashboard className="h-5 w-5" />
              {locale === 'bn' ? 'ড্যাশবোর্ডে যান' : 'Go to Dashboard'}
            </Button>
          </Link>
          <Link href="#how-it-works">
            <Button variant="outline" size="xl" className="w-full sm:w-auto">
              {learnMoreText}
            </Button>
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-col sm:flex-row gap-4 pt-2">
        <Link href={`/${locale}/register`}>
          <Button size="xl" className="gap-2 w-full sm:w-auto shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
            {ctaText}
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <Link href="#how-it-works">
          <Button variant="outline" size="xl" className="w-full sm:w-auto">
            {learnMoreText}
          </Button>
        </Link>
      </div>
    );
  }

  // Footer variant - hidden when logged in
  if (isLoggedIn) {
    return null;
  }

  return (
    <section className="py-16 md:py-20 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-white">
      <div className="container-wide text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
          {locale === 'bn'
            ? 'আজই সুদমুক্ত অর্থায়নে যোগ দিন'
            : 'Join Interest-Free Finance Today'}
        </h2>
        <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
          {locale === 'bn'
            ? 'হাসনাহেনার সদস্য হয়ে সুদমুক্ত ঋণের সুবিধা নিন'
            : 'Become a member of Hasnahena and enjoy interest-free loans'}
        </p>
        <Link href={`/${locale}/register`}>
          <Button
            size="xl"
            variant="secondary"
            className="gap-2 text-primary shadow-lg hover:shadow-xl transition-all"
          >
            {ctaText}
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
      </div>
    </section>
  );
}
