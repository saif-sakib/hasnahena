'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe, LogOut, LayoutDashboard, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { localePath, otherLocale, switchLocalePath } from '@/lib/locale-path';
import { localizedSetting } from '@/lib/localized-settings';
import { cn } from '@/lib/utils'; // Assuming this utility exists, otherwise check utils
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

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={localePath(locale, item.href)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                isScrolled ? 'text-slate-600 dark:text-slate-300 hover:text-primary' : 'text-slate-700 dark:text-slate-200 hover:text-primary'
              }`}
            >
              {navLabel(item.name)}
            </Link>
          ))}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-x-2 sm:gap-x-3 z-50">
          {/* Language Switcher */}
          <Link href={languageHref}>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`gap-2 transition-colors ${
                isScrolled || mobileMenuOpen 
                  ? mobileMenuOpen ? 'text-white hover:text-emerald-100 hover:bg-emerald-800' : 'text-muted-foreground hover:text-foreground'
                  : 'text-slate-700 dark:text-slate-200 hover:text-primary hover:bg-white/20'
              }`}
            >
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-medium uppercase tracking-wider">
                {locale === 'en' ? 'বাংলা' : 'EN'}
              </span>
            </Button>
          </Link>

          {/* Auth Buttons - Desktop */}
          <div className="hidden md:flex md:items-center md:gap-x-2">
            {isLoggedIn ? (
              <>
                <Link href={localePath(locale, `/dashboard/${userRole}`)}>
                  <Button variant="ghost" size="sm" className="gap-2 font-medium">
                    <LayoutDashboard className="h-4 w-4" />
                    {t('dashboard')}
                  </Button>
                </Link>
                <Button variant="outline" size="sm" className="gap-2 border-slate-200 dark:border-slate-700" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Link href={localePath(locale, '/login')}>
                  <Button variant="ghost" size="sm" className={isScrolled ? "text-slate-700 dark:text-slate-200" : "text-slate-800 dark:text-white hover:bg-white/20"}>
                    {t('login')}
                  </Button>
                </Link>
                <Link href={localePath(locale, '/register')}>
                  <Button size="sm" className="shadow-none font-medium bg-primary hover:bg-primary/90 text-primary-foreground animate-in fade-in zoom-in duration-300">
                    {t('register')}
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className={`md:hidden relative z-50 ${mobileMenuOpen ? 'text-white hover:bg-emerald-800' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={tA11y('toggleMenu')}
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
        className={`fixed inset-0 bg-linear-to-b from-emerald-800 to-emerald-950 backdrop-blur-xl z-49 md:hidden transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
        }`}
        style={{ top: '0', paddingTop: '96px', height: '100dvh' }}
      >
        <div className="flex flex-col h-full px-6 pb-24 overflow-y-auto">
          {!isLoggedIn && (
            <div className="grid grid-cols-1 gap-4 mb-6">
              <Link href={localePath(locale, '/login')} onClick={() => setMobileMenuOpen(false)}>
                <Button size="lg" className="w-full text-base h-12 shadow-none font-semibold bg-white text-emerald-900 hover:bg-emerald-50">
                  {t('login')}
                </Button>
              </Link>
              <Link href={localePath(locale, '/register')} onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" size="lg" className="w-full text-base h-12 border-emerald-600 text-white hover:bg-emerald-800 font-semibold bg-transparent">
                  {t('register')}
                </Button>
              </Link>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-4">
            {navigation.map((item, index) => (
              <Link
                key={item.name}
                href={localePath(locale, item.href)}
                className="group flex items-center justify-between py-4 text-lg font-medium border-b border-emerald-700/30 text-emerald-100 hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(false)}
                style={{ transitionDelay: `${index * 50}ms` }}
              >
                <span>
                  {navLabel(item.name)}
                </span>
                <ChevronRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-emerald-200" />
              </Link>
            ))}
          </div>

          <div className="mt-auto mb-8 space-y-4">
            {isLoggedIn ? (
              <div className="grid gap-3">
                <Link href={localePath(locale, `/dashboard/${userRole}`)} onClick={() => setMobileMenuOpen(false)}>
                  <Button size="lg" className="w-full gap-2 text-base bg-white text-emerald-900 hover:bg-emerald-50">
                    <LayoutDashboard className="h-5 w-5" />
                    {t('dashboard')}
                  </Button>
                </Link>
                <Button variant="outline" size="lg" className="w-full gap-2 text-base border-emerald-600 text-white hover:bg-emerald-800 bg-transparent" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}>
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
