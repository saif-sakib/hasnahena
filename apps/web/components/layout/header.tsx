'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe, LogOut, LayoutDashboard, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { localePath, otherLocale, pathWithoutLocale, switchLocalePath } from '@/lib/locale-path';
import { localizedSetting } from '@/lib/localized-settings';
import {
  clearClientAuthState,
  getClientRoleFromToken,
  getValidatedClientToken,
} from '@/lib/client-auth';

/**
 * The menu points at PAGES, not home-page anchors (T-10). "How it works" is a
 * home-page section, so only the footer links it.
 */
const navigation = [
  { name: 'home', href: '/' },
  { name: 'about', href: '/about' },
  { name: 'activities', href: '/activities' },
  { name: 'gallery', href: '/gallery' },
  { name: 'donate', href: '/donate' },
  { name: 'contact', href: '/contact' },
];

interface HeaderProps {
  settings?: Record<string, string>;
}

export function Header({ settings }: HeaderProps) {
  const t = useTranslations('navigation');
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState('member');

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // The open menu covers the page: the page must not scroll behind it, and
  // Escape closes it, as it would a dialog.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen]);

  // Check login status from localStorage
  useEffect(() => {
    const checkAuth = () => {
      const token = getValidatedClientToken();
      setIsLoggedIn(!!token);
      setUserRole(token ? getClientRoleFromToken() : 'member');
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
    clearClientAuthState();
    setIsLoggedIn(false);
    // router.replace: clearClientAuthState dispatches auth-change, and back
    // must not return to a signed-in page.
    router.replace(localePath(locale));
  };

  /** A menu item's text; only "Donate" is overridable, as a prose pair. */
  const navLabel = (name: string) =>
    (name === 'donate' && localizedSetting(settings, 'navigation.donate', locale)) || t(name);

  /** The page the reader is on, for the menu's current-page marker. */
  const currentPath = pathWithoutLocale(pathname);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);

  const other = otherLocale(locale);
  // switchLocalePath keeps the reader where they are (WO-95).
  const languageHref = switchLocalePath(pathname, other);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        mobileMenuOpen
          ? 'bg-emerald-900/98 backdrop-blur-md border-b border-emerald-800'
          : isScrolled
            ? 'bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-none border-b border-slate-200/50 dark:border-slate-800/50' 
            : 'bg-transparent border-transparent'
      }`}
    >
      {/* Height follows the lockup: 96px at the top (logo 64), 64px scrolled (logo 40) — never smaller, or the Bengali tagline becomes unreadable. */}
      <nav
        className={`container-wide flex items-center justify-between transition-all duration-300 ${
          isScrolled || mobileMenuOpen ? 'h-16 md:h-20' : 'h-24 md:h-28'
        }`}
      >
        {/* Logo */}
        <Link href={localePath(locale)} className="flex items-center z-50 relative">
          <Logo
            size="lg"
            priority
            variant={mobileMenuOpen ? 'light' : 'default'}
            src={settings?.['branding.logo'] || undefined}
            className={`transition-all duration-300 ${
              isScrolled || mobileMenuOpen ? 'h-12 md:h-14' : 'h-16 md:h-20'
            }`}
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-x-1 lg:gap-x-2">
          {navigation.map((item) => {
            const current = isCurrent(item.href);
            return (
              <Link
                key={item.name}
                href={localePath(locale, item.href)}
                aria-current={current ? 'page' : undefined}
                // The rule under the current item is the same brushed emerald as the section headings.
                className={`relative px-3 py-2 rounded-sm text-sm font-medium transition-colors duration-200 hover:text-primary after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-emerald-500 after:transition-transform after:duration-300 ${
                  current
                    ? 'text-emerald-800 dark:text-emerald-300 after:scale-x-100'
                    : 'text-slate-700 dark:text-slate-200 after:scale-x-0 hover:after:scale-x-100'
                }`}
              >
                {navLabel(item.name)}
              </Link>
            );
          })}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-x-2 sm:gap-x-3 z-50">
          {/* Language Switcher */}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={`gap-2 transition-colors ${
              isScrolled || mobileMenuOpen
                ? mobileMenuOpen ? 'text-white hover:text-emerald-100 hover:bg-emerald-800' : 'text-muted-foreground hover:text-foreground'
                : 'text-slate-700 dark:text-slate-200 hover:text-primary hover:bg-white/20'
            }`}
          >
            <Link href={languageHref} hrefLang={other}>
              <Globe className="h-4 w-4" aria-hidden="true" />
              {/* Visually hidden on a phone, still the link's name there. */}
              <span lang={other} className="sr-only sm:not-sr-only text-xs font-medium uppercase tracking-wider">
                {locale === 'en' ? 'বাংলা' : 'EN'}
              </span>
            </Link>
          </Button>

          {/* Auth Buttons - Desktop */}
          <div className="hidden md:flex md:items-center md:gap-x-2">
            {isLoggedIn ? (
              <>
                <Button asChild variant="ghost" size="sm" className="gap-2 font-medium">
                  <Link href={localePath(locale, `/dashboard/${userRole}`)}>
                    <LayoutDashboard className="h-4 w-4" />
                    {t('dashboard')}
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-slate-200 dark:border-slate-700"
                  onClick={handleLogout}
                  aria-label={t('logout')}
                  title={t('logout')}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className={isScrolled ? "text-slate-700 dark:text-slate-200" : "text-slate-800 dark:text-white hover:bg-white/20"}>
                  <Link href={localePath(locale, '/login')}>{t('login')}</Link>
                </Button>
                <Button asChild size="sm" className="font-medium">
                  <Link href={localePath(locale, '/register')}>{t('register')}</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className={`md:hidden relative z-50 ${mobileMenuOpen ? 'text-white hover:bg-emerald-800' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={tA11y(mobileMenuOpen ? 'closeMenu' : 'openMenu')}
            aria-expanded={mobileMenuOpen}
            aria-controls="site-menu"
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>
        </div>
      </nav>

      {/* Mobile Navigation Overlay */}
      <div
        id="site-menu"
        inert={!mobileMenuOpen}
        className={`fixed inset-0 bg-linear-to-b from-emerald-800 to-emerald-950 backdrop-blur-xl z-49 md:hidden transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
        }`}
        style={{ top: '0', paddingTop: '96px', height: '100dvh' }}
      >
        <div className="flex flex-col h-full px-6 pb-24 overflow-y-auto">
          {!isLoggedIn && (
            <div className="grid grid-cols-1 gap-4 mb-6">
              <Button asChild size="lg" className="w-full text-base h-12 font-semibold bg-white text-emerald-900 hover:bg-emerald-50">
                <Link href={localePath(locale, '/login')} onClick={() => setMobileMenuOpen(false)}>
                  {t('login')}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full text-base h-12 border-emerald-600 text-white hover:bg-emerald-800 hover:text-white font-semibold bg-transparent">
                <Link href={localePath(locale, '/register')} onClick={() => setMobileMenuOpen(false)}>
                  {t('register')}
                </Link>
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-4">
            {navigation.map((item) => {
              const current = isCurrent(item.href);
              return (
                <Link
                  key={item.name}
                  href={localePath(locale, item.href)}
                  aria-current={current ? 'page' : undefined}
                  className={`group flex items-center justify-between py-4 text-lg font-medium border-b border-emerald-700/30 transition-colors ${
                    current ? 'text-white' : 'text-emerald-100 hover:text-white'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="flex items-center gap-3">
                    {/* The current page is marked by more than colour. */}
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${current ? 'bg-emerald-300' : 'bg-transparent'}`}
                    />
                    {navLabel(item.name)}
                  </span>
                  <ChevronRight className="h-5 w-5 text-emerald-300/70 transition-transform group-hover:translate-x-0.5" />
                </Link>
              );
            })}
          </div>

          <div className="mt-auto mb-8 space-y-4">
            {isLoggedIn ? (
              <div className="grid gap-3">
                <Button asChild size="lg" className="w-full gap-2 text-base bg-white text-emerald-900 hover:bg-emerald-50">
                  <Link href={localePath(locale, `/dashboard/${userRole}`)} onClick={() => setMobileMenuOpen(false)}>
                    <LayoutDashboard className="h-5 w-5" />
                    {t('dashboard')}
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="w-full gap-2 text-base border-emerald-600 text-white hover:bg-emerald-800 hover:text-white bg-transparent" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}>
                  <LogOut className="h-5 w-5" />
                  {t('logout')}
                </Button>
              </div>
            ) : null}
            
          </div>
        </div>
      </div>
    </header>
  );
}
