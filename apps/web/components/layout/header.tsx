'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const navigation = [
  { name: 'home', href: '/' },
  { name: 'about', href: '/#about' },
  { name: 'howItWorks', href: '/#how-it-works' },
  { name: 'contact', href: '/#contact' },
];

export function Header() {
  const t = useTranslations('navigation');
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const otherLocale = locale === 'en' ? 'bn' : 'en';
  const localePath = pathname.replace(`/${locale}`, `/${otherLocale}`);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container-wide flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center space-x-2">
          <Image
            src="/images/logo.png"
            alt="Hasnahena Logo"
            width={40}
            height={40}
            className="rounded-full"
          />
          <span className="font-bold text-xl hidden sm:block">
            {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-x-6">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={`/${locale}${item.href === '/' ? '' : item.href}`}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(item.name)}
            </Link>
          ))}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-x-2">
          {/* Language Switcher */}
          <Link href={localePath}>
            <Button variant="ghost" size="sm" className="gap-2">
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">
                {locale === 'en' ? 'বাংলা' : 'English'}
              </span>
            </Button>
          </Link>

          {/* Auth Buttons - Desktop */}
          <div className="hidden md:flex md:items-center md:gap-x-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">
                {t('login')}
              </Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t('register')}</Button>
            </Link>
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
        <div className="md:hidden border-t bg-background">
          <div className="space-y-1 px-4 pb-4 pt-2">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={`/${locale}${item.href === '/' ? '' : item.href}`}
                className="block py-2 text-base font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t(item.name)}
              </Link>
            ))}
            <div className="flex gap-2 pt-4">
              <Link href={`/${locale}/login`} className="flex-1">
                <Button variant="outline" className="w-full">
                  {t('login')}
                </Button>
              </Link>
              <Link href={`/${locale}/register`} className="flex-1">
                <Button className="w-full">{t('register')}</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
