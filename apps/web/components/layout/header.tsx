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
 * The menu, pointing at pages rather than at sections of the home page — T-10,
 * the owner's ruling of 2026-08-26.
 *
 * What it used to be, and why that was wrong. Every item was an anchor:
 * `/#about`, `/#donate`, `/#contact`, `/#features`. Meanwhile `/about`,
 * `/activities`, `/contact` and `/donate` existed as real pages with their own
 * content, their own metadata and their own JSON-LD — and the audit's link crawl
 * found **24 links to `/#about` and exactly one to `/about`**, which was the
 * language switcher on the page itself. Four pages in the sitemap that nothing
 * on the site linked to, each duplicating a home-page section that said
 * something different.
 *
 * `/#features` was worse than an orphan: the home page has never had an element
 * with `id="features"`, so that item scrolled nowhere on every page it appeared
 * on. It is gone, and with it the `navigation.features` setting that relabelled
 * it — a control for a link that did nothing.
 *
 * `howItWorks` is deliberately not here. It is a section of the home page and
 * nothing else, so the footer links it as an anchor and the header does not
 * offer it as though it were a page.
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
    // `router.replace`, not `window.location.href`. The hard navigation was here
    // to guarantee that nothing kept a stale token in memory, and it does not
    // need to: `clearClientAuthState` dispatches `auth-change`, which is what
    // every component listening for a session actually reacts to. `replace`
    // rather than `push` for the same reason a dead session uses it elsewhere —
    // the back button should not return to a signed-in page.
    //
    // It is also the form the `no-location-assign-relative-destination` lint
    // rule asks for. Worth saying plainly: passing `localePath(locale)` to
    // `window.location.href` silenced that rule by making the destination
    // unanalysable, which is the rule being defeated rather than satisfied.
    router.replace(localePath(locale));
  };

  /**
   * A menu item's text.
   *
   * Only "Donate" is overridable, and it now reads through `localizedSetting`
   * so the override is a **pair**: `navigation.donate` is the Bengali label and
   * `navigation.donateEn` the English one. It used to be a single box, labelled
   * in English on the admin screen, rendered to both audiences — so a Bengali
   * admin naming the menu item for their own members put Bengali in the English
   * menu, on every page. See lib/localized-settings.ts.
   */
  const navLabel = (name: string) =>
    (name === 'donate' && localizedSetting(settings, 'navigation.donate', locale)) || t(name);

  const other = otherLocale(locale);
  // WO-95. This was `pathname.replace('/en', '/bn')`, which had two problems and
  // now has three: it matched `/enrolment` as readily as the locale segment, it
  // could not add a prefix to a path that has none, and under `as-needed` the
  // English pathname *has* none. `switchLocalePath` strips a known locale
  // segment and re-applies the rule, so the reader stays exactly where they are.
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
      {/*
        The header's height is set by the lockup it has to hold, not the other
        way round — and it changes with the page position, which is the classic
        way to have both.
        -------------------------------------------------------------------
        **At the top** the header is transparent over the hero and the brand
        should dominate: 96 px, with the lockup at 64. **Once scrolled** it is a
        sticky utility bar and should get out of the way: 64 px, lockup at 40.
        The transition is the same 300 ms as the background's.

        The sizes are the correction to a correction. `logo.tsx` originally
        rendered every call site at the asset's intrinsic 192 × 108 inside a
        64 px header, so the leaf covered the hero's tagline badge; constraining
        it to 40 px fixed the overlap and made the wordmark unreadable — the
        tagline beneath হাসনাহেনা is two lines of small Bengali type, and at
        40 px those are about eight pixels each. On a cheap Android in sunlight
        that is not a logo, it is a smudge.
      */}
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
              isScrolled || mobileMenuOpen ? 'h-10 md:h-12' : 'h-16 md:h-20'
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
