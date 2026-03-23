'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe, LogOut, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import Image from 'next/image';

const navigation = [
  { name: 'home', href: '/' },
  { name: 'about', href: '/#about' },
  { name: 'gallery', href: '/#gallery' },
  { name: 'howItWorks', href: '/#how-it-works' },
  { name: 'contact', href: '/#contact' },
];

export function Header() {
  const t = useTranslations('navigation');
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check login status from localStorage - use the correct token key
  useEffect(() => {
    const checkAuth = () => {
      const token = typeof window !== 'undefined' 
        ? localStorage.getItem('hn_access_token') 
        : null;
      setIsLoggedIn(!!token);
    };
    
    checkAuth();
    
    // Listen for storage changes (login/logout from other tabs)
    window.addEventListener('storage', checkAuth);
    
    // Custom event for same-tab login updates
    window.addEventListener('auth-change', checkAuth);
    
    return () => {
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('auth-change', checkAuth);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('hn_access_token');
    setIsLoggedIn(false);
    // Dispatch custom event for other components
    window.dispatchEvent(new Event('auth-change'));
    window.location.href = `/${locale}`;
  };

  const otherLocale = locale === 'en' ? 'bn' : 'en';
  const localePath = pathname.replace(`/${locale}`, `/${otherLocale}`);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
      <nav className="container-wide flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center">
          <span className="hidden sm:block">
            <Logo size="sm" showTagline={false} />
          </span>
          <span className="sm:hidden flex items-center gap-2">
            <Image
              src="/images/dashboard-logo.png"
              alt="হাসনাহেনা"
              width={32}
              height={32}
              className="object-contain rounded-lg"
              priority
            />
            <span className="font-bold text-base text-primary">
              {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
            </span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-x-8">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={`/${locale}${item.href === '/' ? '' : item.href}`}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              {t(item.name)}
            </Link>
          ))}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-x-3">
          {/* Language Switcher */}
          <Link href={localePath}>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">
                {locale === 'en' ? 'বাংলা' : 'EN'}
              </span>
            </Button>
          </Link>

          {/* Auth Buttons - Desktop */}
          <div className="hidden md:flex md:items-center md:gap-x-2">
            {isLoggedIn ? (
              <>
                <Link href={`/${locale}/dashboard/member`}>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    {t('dashboard')}
                  </Button>
                </Link>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  {t('logout')}
                </Button>
              </>
            ) : (
              <>
                <Link href={`/${locale}/login`}>
                  <Button variant="ghost" size="sm">
                    {t('login')}
                  </Button>
                </Link>
                <Link href={`/${locale}/register`}>
                  <Button size="sm" className="shadow-sm">{t('register')}</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-background/98 backdrop-blur-md">
          <div className="space-y-1 px-4 pb-4 pt-3">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={`/${locale}${item.href === '/' ? '' : item.href}`}
                className="block py-2.5 text-base font-medium text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t(item.name)}
              </Link>
            ))}
            <div className="flex gap-3 pt-4 border-t mt-2">
              {isLoggedIn ? (
                <>
                  <Link href={`/${locale}/dashboard/member`} className="flex-1">
                    <Button variant="outline" className="w-full gap-2">
                      <LayoutDashboard className="h-4 w-4" />
                      {t('dashboard')}
                    </Button>
                  </Link>
                  <Button variant="destructive" className="flex-1 gap-2" onClick={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                  </Button>
                </>
              ) : (
                <>
                  <Link href={`/${locale}/login`} className="flex-1">
                    <Button variant="outline" className="w-full">
                      {t('login')}
                    </Button>
                  </Link>
                  <Link href={`/${locale}/register`} className="flex-1">
                    <Button className="w-full">{t('register')}</Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
