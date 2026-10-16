import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Shield, Users, Eye, Lock, Wallet, HandHeart, FileText, HeadphonesIcon, BookOpen, Quote, Phone, Mail, MapPin, GraduationCap, Heart, Briefcase, Calendar, Image as ImageIcon, LayoutDashboard } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { GeometricPanel } from '@/components/ui/geometric-panel';
import { LeafFlourish } from '@/components/ui/leaf-flourish';
import { SectionHeading } from '@/components/ui/section-heading';
import { ScrollReveal } from '@/components/ui/scroll-reveal';
import { AuthAwareCTA } from '@/components/ui/auth-aware-cta';
import { locales, type Locale } from '@/i18n';
import { createLocalizedMetadata, normalizeLocale, siteTitle } from '@/lib/seo';
import { StructuredData } from '@/components/seo/structured-data';

import { getPublicGalleryItems } from '@/lib/public-content';
import { getPublicSettings } from '@/lib/system-config';
import { localizedSetting } from '@/lib/localized-settings';
import { CountUp } from '@/components/ui/count-up';
import { contactDetails } from '@/lib/contact-details';
import { localePath } from '@/lib/locale-path';

/** Prerendered (WO-73); revalidateTag on settings PUT is the real invalidation. */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/',
    // siteTitle() — this overrides the layout's, so it is the most-crawled <title>.
    title: siteTitle(activeLocale),
    description:
      activeLocale === 'bn'
        ? 'কর্জে হাসানা ভিত্তিক সুদমুক্ত সমবায় অর্থায়ন প্ল্যাটফর্মে যোগ দিন।'
        : 'Join our Qard al-Hasan community for ethical, Sharia-compliant loans with zero interest.',
  });
}

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const t = await getTranslations({locale, namespace: 'common'});
  const tFeatures = await getTranslations({locale, namespace: 'features'});
  const tActivities = await getTranslations({locale, namespace: 'activities'});
  const tHero = await getTranslations({locale, namespace: 'hero'});
  const tStats = await getTranslations({locale, namespace: 'stats'});
  const tQuran = await getTranslations({locale, namespace: 'quran'});
  const tHadith = await getTranslations({locale, namespace: 'hadith'});
  const tGallery = await getTranslations({locale, namespace: 'gallery'});
  const tHowItWorks = await getTranslations({locale, namespace: 'howItWorks'});
  const tContact = await getTranslations({locale, namespace: 'contact'});
  const tDonation = await getTranslations({locale, namespace: 'donation'});
  
  // Neither accessor rejects (both fall back without a database).
  const [dbGalleryItems, settings] = await Promise.all([
    getPublicGalleryItems(6),
    getPublicSettings(),
  ]);

  const galleryItems: GalleryItem[] = dbGalleryItems.map(item => ({
    id: item.id,
    image: item.imageUrl,
    caption: locale === 'bn' ? (item.captionBn || item.captionEn || '') : (item.captionEn || item.captionBn || ''),
    date: item.date,
    likes: item.likes,
  }));

  const features = [
    {
      icon: Shield,
      title: tFeatures('noInterest.title'),
      description: tFeatures('noInterest.description'),
    },
    {
      icon: Users,
      title: tFeatures('community.title'),
      description: tFeatures('community.description'),
    },
    {
      icon: Eye,
      title: tFeatures('transparent.title'),
      description: tFeatures('transparent.description'),
    },
    {
      icon: Lock,
      title: tFeatures('secure.title'),
      description: tFeatures('secure.description'),
    },
  ];

  const activities = [
    {
      icon: Wallet,
      title: tActivities('finance.title'),
      description: tActivities('finance.description'),
    },
    {
      icon: GraduationCap,
      title: tActivities('education.title'),
      description: tActivities('education.description'),
    },
    {
      icon: Heart,
      title: tActivities('health.title'),
      description: tActivities('health.description'),
    },
    {
      icon: HandHeart,
      title: tActivities('charity.title'),
      description: tActivities('charity.description'),
    },
    {
      icon: Briefcase,
      title: tActivities('training.title'),
      description: tActivities('training.description'),
    },
    {
      icon: Calendar,
      title: tActivities('social.title'),
      description: tActivities('social.description'),
    },
  ];

  const partnerLogos = [
    settings['hero.partnerLogo1'],
    settings['hero.partnerLogo2'],
    settings['hero.partnerLogo3'],
  ]
    .map((logo) => logo?.trim())
    .filter((logo): logo is string => Boolean(logo));

  // The figures the foundation STATES about itself — never read from the
  // ledger (owner's ruling). Each key on the line that resolves it, so the
  // localized-settings census can read it.
  const statCards = [
    {
      value: localizedSetting(settings, 'stats.members', locale),
      label: tStats('totalMembers'),
      icon: <Users className="h-5 w-5 text-emerald-600 sm:h-6 sm:w-6" />,
    },
    {
      value: localizedSetting(settings, 'stats.deposits', locale),
      label: tStats('totalDeposits'),
      icon: <Wallet className="h-5 w-5 text-amber-600 sm:h-6 sm:w-6" />,
    },
    {
      value: localizedSetting(settings, 'stats.loans', locale),
      label: tStats('loansDistributed'),
      icon: <HandHeart className="h-5 w-5 text-blue-600 sm:h-6 sm:w-6" />,
    },
    {
      value: localizedSetting(settings, 'stats.charity', locale),
      label: tStats('charitableFund'),
      icon: <Heart className="h-5 w-5 text-rose-600 sm:h-6 sm:w-6" />,
    },
  ]
    .filter((card) => card.value.trim() !== '')
    .map((card, index) => ({ ...card, delay: index * 140 }));

  const contact = contactDetails(settings, locale);
  const contactCards = [
    { icon: MapPin, title: tContact('address'), value: contact.address },
    { icon: Phone, title: tContact('phone'), value: contact.phone },
    { icon: Mail, title: tContact('email'), value: contact.email },
  ].filter((card) => card.value !== '');

  const donationChannels = [
    { label: tDonation('bkash'), value: settings['donation.bkash']?.trim() || '' },
    { label: tDonation('nagad'), value: settings['donation.nagad']?.trim() || '' },
    { label: tDonation('rocket'), value: settings['donation.rocket']?.trim() || '' },
  ].filter((channel) => channel.value !== '');

  const steps = [
    { step: 1, icon: FileText, ...getStepContent(tHowItWorks, 'step1') },
    { step: 2, icon: Wallet, ...getStepContent(tHowItWorks, 'step2') },
    { step: 3, icon: HandHeart, ...getStepContent(tHowItWorks, 'step3') },
    { step: 4, icon: HeadphonesIcon, ...getStepContent(tHowItWorks, 'step4') },
  ];

  return (
    <>
      <StructuredData locale={normalizeLocale(locale)} path="/" settings={settings} />
      <Header settings={settings} />
      {/* One ground for everything below the hero (no alternating bands). */}
      <main className="surface-paper flex-1">
        {/* Hero Section */}
        {/* pt-24/md:pt-28 clears the fixed header at its tallest. */}
        <section className="relative overflow-hidden bg-linear-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950 dark:via-background dark:to-teal-950 lg:min-h-[78vh] flex items-center pt-24 md:pt-28">
          {settings['hero.backgroundImage'] && (
            <div className="absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={settings['hero.backgroundImage']}
                alt="Hero background"
                className="h-full w-full object-cover opacity-15"
              />
            </div>
          )}
          {/* The khatam lattice on its own layer (a gradient is already a background-image), masked to fade. */}
          <div
            aria-hidden="true"
            className="lattice-tile pointer-events-none absolute inset-0 [mask-image:radial-gradient(120%_100%_at_15%_0%,black,transparent_72%)]"
          />
          {/* w-full: as a flex item it would shrink to its text and misalign with the header (worse in Bengali). */}
          <div className="container-wide w-full py-10 md:py-16 lg:py-24 relative z-10">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
              <div className="space-y-6 md:space-y-8 animate-in slide-in-from-left-10 fade-in duration-700">
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 backdrop-blur-xs">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-600 mr-2 animate-pulse"></span>
                  {localizedSetting(settings, 'hero.tagline', locale) || tHero('tagline')}
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.1]">
                  {tHero('title')}
                </h1>
                <p className="text-lg md:text-xl text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
                  {tHero('subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <AuthAwareCTA locale={locale} ctaText={tHero('cta')} learnMoreText={tHero('learnMore')} variant="hero" />
                </div>
                
                {/* No placeholder skeleton when there are no partner logos. */}
                {partnerLogos.length > 0 && (
                  <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
                    <p className="text-sm text-slate-500 mb-4 font-medium uppercase tracking-wider">
                      {tHero('partners')}
                    </p>
                    <div className="flex flex-wrap gap-6 sm:gap-8 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-500">
                      {partnerLogos.map((logo, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={logo}
                          src={logo}
                          alt={tHero('partnerAlt', { number: index + 1 })}
                          className="h-8 w-24 rounded object-contain bg-white/30 p-1"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* The figures are the foundation's own stated values (system_config), never the ledger; GeometricPanel is the fallback when all four are blank. */}
              <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none animate-in slide-in-from-right-10 fade-in duration-1000 delay-200">
                {/* The bloom the cards float over. Decorative, and behind them. */}
                <div className="absolute inset-0 -z-10 scale-90 rounded-full bg-linear-to-tr from-emerald-500/25 to-teal-500/25 blur-3xl" />

                {statCards.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:gap-5">
                    {/* The left column starts a step lower — a margin, so space stays reserved. */}
                    <div className="mt-6 space-y-3 sm:mt-10 sm:space-y-5">
                      {statCards.filter((_, i) => i % 2 === 0).map((card) => (
                        <StatCard key={card.label} {...card} locale={locale} />
                      ))}
                    </div>
                    <div className="space-y-3 sm:space-y-5">
                      {statCards.filter((_, i) => i % 2 === 1).map((card) => (
                        <StatCard key={card.label} {...card} locale={locale} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <GeometricPanel className="aspect-5/4 sm:aspect-square" />
                )}
              </div>
            </div>
          </div>
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-linear-to-b from-emerald-100/30 to-transparent blur-3xl" />
          <div className="absolute bottom-0 left-0 w-1/3 h-1/3 bg-linear-to-t from-teal-100/30 to-transparent blur-3xl" />
        </section>

        {/* Islamic Teachings Section - Quran & Hadith */}
        {/* The sprigs: overflow-hidden crops them; `relative` keeps the text above them. */}
        <section className="surface-veil relative overflow-hidden py-16 md:py-20">
          <LeafFlourish className="absolute -left-24 bottom-0 h-[22rem] w-auto text-emerald-600/15 dark:text-emerald-400/10 sm:-left-16 sm:h-[28rem]" />
          <LeafFlourish
            flipped
            className="absolute -right-28 top-0 hidden h-[22rem] w-auto rotate-180 text-emerald-600/12 dark:text-emerald-400/8 lg:block"
          />
          <div className="container-wide relative">
            {/* Quran Section - First */}
            <div className="mb-16">
              <SectionHeading
                icon={<BookOpen className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />}
                title={tQuran('title')}
                subtitle={tQuran('subtitle')}
              />

              <div className="reveal-row grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="card-raise relative overflow-hidden border-emerald-100 bg-white dark:border-emerald-900/50 dark:bg-slate-900">
                    <CardContent className="pt-8 pb-8 px-6 relative">
                      <Quote className="absolute -bottom-4 -right-4 h-20 w-20 text-emerald-100 dark:text-emerald-900/50 rotate-180 z-0 opacity-40 pointer-events-none" />
                      <p className="text-base leading-relaxed mb-4 font-bengali relative z-10">
                        {tQuran(`ayah${num}.text`)}
                      </p>
                      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium relative z-10 text-right">
                        — {tQuran(`ayah${num}.source`)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Hadith Section - Second */}
            <div>
              <SectionHeading
                accent="amber"
                icon={<BookOpen className="h-7 w-7 text-amber-600 dark:text-amber-400" />}
                title={tHadith('title')}
                subtitle={tHadith('subtitle')}
              />

              <div className="reveal-row grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="card-raise relative overflow-hidden border-amber-100 bg-white dark:border-amber-900/50 dark:bg-slate-900">
                    <CardContent className="pt-8 pb-8 px-6 relative">
                      <Quote className="absolute -bottom-4 -right-4 h-20 w-20 text-amber-100 dark:text-amber-900/50 rotate-180 z-0 opacity-40 pointer-events-none" />
                      <p className="text-base leading-relaxed mb-4 font-bengali relative z-10">
                        {tHadith(`hadith${num}.text`)}
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 font-medium relative z-10 text-right">
                        — {tHadith(`hadith${num}.source`)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>



        {/* Activities Section */}
        {/* id="about" kept for old /#about links. */}
        <section id="about" className="surface-lattice py-16 md:py-20">
          <div className="container-wide">
            <SectionHeading title={tActivities('title')} subtitle={tActivities('subtitle')} />

            <div className="reveal-row grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {activities.map((activity, index) => (
                <Card key={index} className="card-raise group hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <CardContent className="pt-6 pb-6">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                      <activity.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2 text-lg">{activity.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {activity.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <SectionLink href={localePath(locale, '/activities')} label={t('readMore')} />
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-16 md:py-20">
          <div className="container-wide">
            <SectionHeading
              title={localizedSetting(settings, 'features.title', locale) || tFeatures('title')}
              subtitle={tFeatures('subtitle')}
            />

            <div className="reveal-row-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <Card key={index} className="card-raise group hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <CardContent className="pt-6 pb-6">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2 text-lg">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Gallery Section */}
        <section id="gallery" className="relative overflow-hidden py-20 md:py-32">
          <div className="container-wide relative z-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
              <div className="reveal-left max-w-2xl">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 mb-6">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 text-slate-900 dark:text-white">
                  {tGallery('title')}
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
                  {tGallery('subtitle')}
                </p>
              </div>
              <Link href={localePath(locale, '/gallery')} className="reveal-right">
                <Button variant="outline" className="hidden md:flex gap-2">
                    {tGallery('viewAll')} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="reveal-soft">
              <Gallery items={galleryItems} locale={locale} />
            </div>
            
            <div className="mt-12 text-center md:hidden">
              <Link href={localePath(locale, '/gallery')}>
                <Button variant="outline" className="w-full gap-2">
                    {tGallery('viewAll')} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="surface-veil py-16 md:py-20">
          <div className="container-wide">
            <SectionHeading title={tHowItWorks('title')} />

            <div className="reveal-row-4 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, index) => (
                <div key={index} className="relative">
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-4">
                      <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/25">
                        {step.step}
                      </div>
                      {index < steps.length - 1 && (
                        <div className="hidden lg:block absolute top-8 left-full w-full h-0.5 bg-linear-to-r from-primary/50 to-primary/10" />
                      )}
                    </div>
                    <h3 className="font-semibold mb-2 text-lg">{step.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" className="py-16 md:py-20">
          <div className="container-wide">
            <SectionHeading
              title={localizedSetting(settings, 'contact.title', locale) || tContact('title')}
            />

            {/* No invented fallback numbers — a placeholder looks like a real one. */}
            <div className="reveal-row grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {contactCards.map((item) => (
                <Card key={item.title} className="card-raise bg-white text-center transition-shadow hover:shadow-lg dark:bg-slate-900">
                  <CardContent className="pt-6 pb-6">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <SectionLink href={localePath(locale, '/contact')} label={t('readMore')} />
          </div>
        </section>

        <section id="donate" className="surface-lattice relative overflow-hidden py-16 md:py-20">
          <LeafFlourish
            flipped
            className="pointer-events-none absolute -right-24 bottom-0 hidden h-[22rem] w-auto text-emerald-600/15 dark:text-emerald-400/10 md:block"
          />
          <div className="container-wide relative">
            <SectionHeading
              title={localizedSetting(settings, 'donation.title', locale) || tDonation('title')}
              subtitle={localizedSetting(settings, 'donation.subtitle', locale) || tDonation('subtitle')}
            />

            {/* Unset channels are absent, never a placeholder number. */}
            <div className={donationChannels.length > 0 ? 'reveal-row grid md:grid-cols-3 gap-6 max-w-5xl mx-auto' : 'hidden'}>
              {donationChannels.map((item) => (
                <Card key={item.label} className="card-raise bg-white text-center transition-shadow hover:shadow-lg dark:bg-slate-900">
                  <CardContent className="pt-6 pb-6">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Wallet className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{item.label}</h3>
                    <p className="text-sm text-muted-foreground">{item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="reveal-soft max-w-4xl mx-auto mt-8">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground text-center leading-relaxed">
                    {localizedSetting(settings, 'donation.referenceNote', locale) ||
                      tDonation('referenceNote')}
                  </p>
                </CardContent>
              </Card>
            </div>

            <SectionLink href={localePath(locale, '/donate')} label={t('readMore')} />
          </div>
        </section>

        {/* CTA Section */}
        <AuthAwareCTA
          locale={locale}
          ctaText={tHero('cta')}
          variant="footer"
        />
      </main>
      <Footer settings={settings} />
      <ScrollReveal />
    </>
  );
}

/** "Read more →" from a home-page section to its full page. */
function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="reveal-soft mt-10 text-center">
      <Link href={href}>
        <Button variant="outline" className="gap-2">
          {label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

/**
 * One hero figure: frosted over the gradient, motion only via transitions.
 * `tabular-nums` stops the width jittering while it counts; no break-words, or
 * a number breaks between its own digits.
 */
function StatCard({
  value,
  label,
  icon,
  delay,
  locale,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
  delay: number;
  locale: string;
}) {
  return (
    <Card
      className="group animate-in zoom-in-95 fade-in fill-mode-both border-slate-100 bg-white/80 backdrop-blur-md transition-all duration-500 hover:-translate-y-1.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900/80"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col items-center p-5 text-center sm:p-6">
        <div className="mb-3 rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-100 transition-transform duration-300 group-hover:scale-110 dark:bg-slate-800 dark:ring-slate-700 sm:mb-4 sm:p-3">
          {icon}
        </div>
        <CountUp
          value={value}
          locale={locale}
          delay={delay}
          className="block text-xl font-extrabold leading-tight tracking-tight text-slate-900 tabular-nums dark:text-white sm:text-2xl lg:text-3xl"
        />
        <div className="mt-1.5 text-[0.7rem] font-medium uppercase leading-snug tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

function getStepContent(t: any, step: string) {
  return {
    title: t(`${step}.title`),
    description: t(`${step}.description`),
  };
}
