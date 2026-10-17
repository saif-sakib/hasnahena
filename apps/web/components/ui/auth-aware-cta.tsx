'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getClientRoleFromToken, getValidatedClientToken } from '@/lib/client-auth';
import { localePath } from '@/lib/locale-path';

interface AuthAwareCTAProps {
  locale: string;
  ctaText: string;
  learnMoreText?: string;
  variant: 'hero' | 'footer';
}

/**
 * The home page call to action. The signed-OUT form renders on the server, so
 * the prerendered HTML always has "Become a Member"; a signed-in member sees
 * their dashboard link after hydration.
 */
export function AuthAwareCTA({ locale, ctaText, learnMoreText, variant }: AuthAwareCTAProps) {
  const t = useTranslations('hero');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState('member');

  useEffect(() => {
    const checkAuth = () => {
      const token = getValidatedClientToken();
      setIsLoggedIn(!!token);
      setUserRole(token ? getClientRoleFromToken() : 'member');
    };

    checkAuth();

    window.addEventListener('storage', checkAuth);
    window.addEventListener('auth-change', checkAuth);

    return () => {
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('auth-change', checkAuth);
    };
  }, []);

  if (variant === 'hero') {
    return (
      <div className="flex flex-col sm:flex-row gap-4 pt-2">
        {isLoggedIn ? (
          <Button asChild size="xl" className="gap-2 w-full sm:w-auto">
            <Link href={localePath(locale, `/dashboard/${userRole}`)}>
              <LayoutDashboard className="h-5 w-5" />
              {t('goToDashboard')}
            </Link>
          </Button>
        ) : (
          <Button asChild size="xl" className="gap-2 w-full sm:w-auto">
            <Link href={localePath(locale, '/register')}>
              {ctaText}
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" size="xl" className="w-full sm:w-auto">
          <Link href="#how-it-works">{learnMoreText}</Link>
        </Button>
      </div>
    );
  }

  // Footer variant — the closing invitation, which has nothing to say to
  // somebody who has already accepted it.
  if (isLoggedIn) {
    return null;
  }

  return (
    // Deep emerald, the colour of the menu overlay — a closing band, not a banner.
    <section className="py-16 md:py-20 bg-linear-to-br from-emerald-800 to-emerald-950 text-white">
      <div className="container-wide text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 text-balance">{t('ctaTitle')}</h2>
        <p className="text-lg mb-8 text-emerald-100/90 max-w-2xl mx-auto">{t('ctaSubtitle')}</p>
        <Button asChild size="xl" className="gap-2 bg-white text-emerald-900 hover:bg-emerald-50">
          <Link href={localePath(locale, '/register')}>
            {ctaText}
            <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
