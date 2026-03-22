import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Facebook, Twitter, Mail, Phone, MapPin } from 'lucide-react';

export function Footer() {
  const t = useTranslations('footer');
  const tNav = useTranslations('navigation');
  const locale = useLocale();

  return (
    <footer className="border-t bg-muted/50">
      <div className="container-wide section-padding">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand Section */}
          <div className="space-y-4">
            <Link href={`/${locale}`} className="flex items-center space-x-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xl">
                হ
              </div>
              <span className="font-bold text-xl">
                {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
              </span>
            </Link>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
            <div className="flex space-x-4">
              <a
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Twitter className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">{t('quickLinks')}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={`/${locale}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {tNav('home')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/about`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {tNav('about')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/how-it-works`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {tNav('howItWorks')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/contact`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {tNav('contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold mb-4">{t('resources')}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={`/${locale}/faq`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('faq')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/support`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('support')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/privacy`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('privacyPolicy')}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/terms`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('termsOfService')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-4">{tNav('contact')}</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Dhaka, Bangladesh</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4 flex-shrink-0" />
                <span>+880 1XXX-XXXXXX</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span>contact@hasnahena.org</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
          {t('copyright')}
        </div>
      </div>
    </footer>
  );
}
