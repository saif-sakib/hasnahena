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

/**
 * WO-73. This page's content changes when an admin edits a setting, which is to
 * say almost never — so it is prerendered and served from the edge instead of
 * opening a Neon connection on every visit. `revalidateTag('system-config')` in
 * the settings `PUT` is what makes an edit appear immediately; this interval is
 * only the backstop.
 */
export const revalidate = 3600;

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = normalizeLocale(locale);
  return createLocalizedMetadata({
    locale: activeLocale,
    path: '/',
    // siteTitle(), not a fourth copy. This page's generateMetadata overrides
    // the layout's, so whatever is written here is the site's most-crawled
    // <title> — and the string it used to hold said "Hasnahena" while every
    // other surface had been changed to "Hasnahena Foundation".
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
  
  // Neither accessor rejects — each falls back to empty when the database is
  // unreachable, which is what lets this page prerender in an image build that
  // has no database. The `try` that used to be here said the same thing, in
  // only two of the eight pages that needed it.
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

  // The figures the foundation **states** about itself, and only those.
  //
  // They were briefly read from the ledger — the member count and the real
  // balances, which is a nicer engineering answer and the wrong product one.
  // The owner's ruling (2026-08-26) is that the fund's true numbers are not
  // published, so the reader is `system_config` and there is no other path;
  // `lib/public-stats.ts` was deleted rather than switched off.
  //
  // Each key sits on the line that resolves it, deliberately: the pair census in
  // `localized-settings.test.ts` reads line by line and refuses a prose key
  // named anywhere that does not also call `localizedSetting`. A table of bare
  // keys mapped through the resolver three lines below is exactly the shape it
  // cannot tell apart from the bug.
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
      <main className="flex-1">
        {/* Hero Section */}
        {/*
          `pt-24`/`md:pt-28` matches the header at the top of the page, where it
          is at its tallest. Without it the hero's first element sits under a
          transparent header and the logo — deliberately large now, so the
          wordmark can be read — covers the tagline badge outright.
        */}
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
          {/*
            `w-full`, and it is the fix for a misalignment that had been on this
            page since it was written.

            The section is `flex items-center` (to centre the hero vertically),
            which makes this container a **flex item** — and a flex item with no
            width shrinks to fit its contents instead of filling its parent. So
            `container-wide`'s `max-w-7xl` never applied: the hero's width was
            whatever its own text happened to measure, and the headline started
            at a different x from the header's logo and from every section below
            it. It moved with the **language**, because Bengali is the wider
            script — which is what "the layout breaks in Bengali" turned out to
            be. It moved when the figures were shortened, too.
          */}
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
                
                {/*
                  T-10. The `else` branch here used to render three grey boxes
                  with `animate-pulse` — a loading skeleton for content that was
                  never loading. On the live site, under the heading "Trusted by
                  community", three placeholders had been shimmering since the
                  page was written. A section with nothing in it is not a section.
                */}
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

              {/*
                The hero's right column: the figures, floating.
                -------------------------------------------------------------
                It has been four things, and this is the first one again.

                It began as this — two columns of frosted white cards, the left
                column dropped by a step so they read as *floating* rather than
                as a table, over a soft emerald bloom. Then the figures inside
                it turned out to be invented (`125+ members`), and fixing that
                honestly cost the design: they became settings, the settings
                were seeded empty, and the column became a bare decorative panel
                because an empty hero looks broken. Counting them from the
                ledger filled it again and was the wrong answer for a different
                reason — the fund's real balances are not for publication
                (owner, 2026-08-26).

                So the figures are the foundation's own stated ones, in
                `system_config`, and the layout is the one that was elegant
                before any of that happened. `GeometricPanel` stays as the
                fallback for a deployment that has cleared all four, which is
                the state that started the whole sequence.
              */}
              <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none animate-in slide-in-from-right-10 fade-in duration-1000 delay-200">
                {/* The bloom the cards float over. Decorative, and behind them. */}
                <div className="absolute inset-0 -z-10 scale-90 rounded-full bg-linear-to-tr from-emerald-500/25 to-teal-500/25 blur-3xl" />

                {statCards.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:gap-5">
                    {/*
                      Two columns, and the left one starts a step lower. That
                      offset is the whole character of this panel — square with
                      it, four cards are a spreadsheet; staggered, they are a
                      composition. It is a margin rather than a transform, so the
                      column's own height still reserves the space and nothing
                      below the hero moves.
                    */}
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
        <section className="py-16 md:py-20 bg-linear-to-b from-emerald-50/50 to-white dark:from-emerald-950/10 dark:to-background">
          <div className="container-wide">
            {/* Quran Section - First */}
            <div className="mb-16">
              <div className="text-center mb-12">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4">
                  <BookOpen className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                  {tQuran('title')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {tQuran('subtitle')}
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="relative overflow-hidden border-emerald-100 dark:border-emerald-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xs">
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
              <div className="text-center mb-12">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 mb-4">
                  <BookOpen className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                  {tHadith('title')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {tHadith('subtitle')}
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="relative overflow-hidden border-amber-100 dark:border-amber-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xs">
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
        {/*
          `id="about"` is kept so an existing external link to `/#about` still
          lands somewhere, but the menu now points at /activities and /about —
          the pages this section summarises. See components/layout/header.tsx.
        */}
        <section id="about" className="py-16 md:py-20 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {tActivities('title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {tActivities('subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {activities.map((activity, index) => (
                <Card key={index} className="group hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
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
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {localizedSetting(settings, 'features.title', locale) || tFeatures('title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {tFeatures('subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <Card key={index} className="group hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 border-slate-100 dark:border-slate-800">
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
        {/*
          The decorative layer here referenced `/patterns/grid.svg`, which has
          never existed in `public/`. Every visit to the home page — the live
          one included — fetched it and got a 404.
        */}
        <section id="gallery" className="py-20 md:py-32 bg-slate-50 dark:bg-slate-900 relative overflow-hidden">
          <div className="container-wide relative z-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
              <div className="max-w-2xl">
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
              <Link href={localePath(locale, '/gallery')}>
                <Button variant="outline" className="hidden md:flex gap-2">
                    {tGallery('viewAll')} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <Gallery items={galleryItems} locale={locale} />
            
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
        <section id="how-it-works" className="py-16 md:py-20 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">
                {tHowItWorks('title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
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
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {localizedSetting(settings, 'contact.title', locale) || tContact('title')}
              </h2>
            </div>

            {/*
              WO-67 took the invented fallbacks off /donate and /support and
              left them here: `+880 1XXX-XXXXXX` under the heading "Phone", on
              the most-visited page on the site. A visitor cannot tell a
              placeholder from a number nobody answers.
            */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {contactCards.map((item) => (
                <Card key={item.title} className="text-center hover:shadow-lg transition-shadow">
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

        <section id="donate" className="py-16 md:py-20 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {localizedSetting(settings, 'donation.title', locale) || tDonation('title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {localizedSetting(settings, 'donation.subtitle', locale) || tDonation('subtitle')}
              </p>
            </div>

            {/*
              Same rule as the /donate page, and here it matters most: a donor
              reading the home page was being shown `+880 1XXXXXXXXX` as a
              mobile-banking number to send money to. Unset means absent.
            */}
            <div className={donationChannels.length > 0 ? 'grid md:grid-cols-3 gap-6 max-w-5xl mx-auto' : 'hidden'}>
              {donationChannels.map((item) => (
                <Card key={item.label} className="text-center hover:shadow-lg transition-shadow">
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

            <div className="max-w-4xl mx-auto mt-8">
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
    </>
  );
}

/**
 * "Read more →", from a home-page section to the page it summarises.
 *
 * The home page and the four standalone pages now say the same thing at two
 * depths rather than competing: the section is the summary, the page is the
 * whole of it. Before T-10 the menu pointed at the sections and nothing pointed
 * at the pages at all.
 */
function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-10 text-center">
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
 * One counted figure on the hero panel.
 *
 * White on emerald, no icon. The four cards this replaced each carried a
 * coloured lucide glyph — amber, blue, rose — which were legible on the white
 * band they used to sit in and are four clashing colours on a green field. A
 * number and what it counts is the whole of what this has to say, and saying
 * only that is what makes the panel read as classic rather than as a dashboard.
 *
 * `tabular-nums` so the four values line up on their digits. And no
 * `break-words`: it was here, and it let `BDT 4,796,100` break *between its
 * own digits* on a phone. A number is one word however long it is — the column
 * widens instead, which is what the single-column phone grid above is for.
 */
/**
 * One figure on the hero.
 *
 * Frosted rather than solid, because it floats over the hero's own gradient and
 * a soft emerald bloom — an opaque card would read as a hole punched in the
 * background. The hover lift and the icon's scale are the only motion that is
 * not the count itself, and both are `transition`s, so a reader who has turned
 * motion off gets a still card rather than a broken one.
 *
 * `tabular-nums` is load-bearing rather than typographic: the value counts up
 * from zero, and without fixed-width digits the card's whole width jitters
 * sixty times a second while it does.
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
