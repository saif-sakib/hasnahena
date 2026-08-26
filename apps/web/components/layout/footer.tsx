import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Facebook, Mail, Phone, MapPin } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { localePath } from '@/lib/locale-path';
import { orgName } from '@/lib/localized-settings';
import { contactDetails, telHref } from '@/lib/contact-details';

interface FooterProps {
  settings?: Record<string, string>;
}

export function Footer({ settings }: FooterProps) {
  const t = useTranslations('footer');
  const tNav = useTranslations('navigation');
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');

  // One reader for all four surfaces that show these — see
  // lib/contact-details.ts for what they used to disagree about.
  const { address, phone, email } = contactDetails(settings, locale);
  // The foundation names itself, in the reader's language, rather than a
  // literal in a message file. `footer.copyright` held "© 2024 Hasnahena" and
  // had done since 2024 — a stale year at the bottom of every public page, on
  // the live site, in both languages.
  const name = orgName(settings, locale) || 'Hasnahena Foundation';

  return (
    <footer className="border-t bg-slate-50/50 dark:bg-slate-900/50">
      <div className="container-wide py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand Section */}
          <div className="space-y-4 lg:col-span-1">
            <Link href={localePath(locale)} className="inline-block">
              <Logo
                size="md"
                src={settings?.['branding.logo'] || undefined}
              />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('description')}
            </p>
            <div className="flex space-x-3">
              <a
                href="https://www.facebook.com/share/18KYP6p25Z/"
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                aria-label={tA11y('facebookPage')}
              >
                <Facebook className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-foreground mb-4">
              {t('quickLinks')}
            </h3>
            <ul className="space-y-2.5">
              {[
                { href: localePath(locale), label: tNav('home') },
                { href: localePath(locale, '/about'), label: tNav('about') },
                { href: localePath(locale, '/activities'), label: tNav('activities') },
                // The one anchor left in the footer, and deliberately: "How it
                // works" is a section of the home page and not a page, so it is
                // linked as what it is rather than promoted to the menu.
                { href: localePath(locale, '/#how-it-works'), label: tNav('howItWorks') },
                { href: localePath(locale, '/contact'), label: tNav('contact') },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-foreground mb-4">
              {t('resources')}
            </h3>
            <ul className="space-y-2.5">
              {[
                { href: localePath(locale, '/faq'), label: t('faq') },
                { href: localePath(locale, '/support'), label: t('support') },
                { href: localePath(locale, '/privacy'), label: t('privacyPolicy') },
                { href: localePath(locale, '/terms'), label: t('termsOfService') },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-foreground mb-4">
              {tNav('contact')}
            </h3>
            <ul className="space-y-3">
              {address && (
                <li className="flex items-start gap-3 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>{address}</span>
                </li>
              )}
              {phone && (
                <li className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0 text-primary" />
                  <a href={telHref(phone)} className="hover:text-primary transition-colors">
                    {phone}
                  </a>
                </li>
              )}
              {email && (
                <li className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0 text-primary" />
                  <a href={`mailto:${email}`} className="hover:text-primary transition-colors">
                    {email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border/50 text-center">
          <p className="text-sm text-muted-foreground">
            {t('copyright', { year: new Date().getFullYear(), name })}
          </p>
        </div>
      </div>
    </footer>
  );
}
