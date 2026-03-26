import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Shield, Users, Eye, Lock, Wallet, HandHeart, FileText, HeadphonesIcon, BookOpen, Quote, Phone, Mail, MapPin, GraduationCap, Heart, Briefcase, Calendar, Image as ImageIcon, LayoutDashboard } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { AuthAwareCTA } from '@/components/ui/auth-aware-cta';
import { locales } from '@/i18n';

import { prisma } from '@/lib/prisma';
import { GalleryItem as DbGalleryItem } from '@prisma/client';

export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  unstable_setRequestLocale(locale);
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
  
  // Fetch gallery items from DB
  let dbGalleryItems: DbGalleryItem[] = [];
  let settings: Record<string, string> = {};

  try {
      const [galleryResult, settingsResult] = await Promise.all([
        prisma.galleryItem.findMany({
          take: 6,
          orderBy: { date: 'desc' },
        }),
        prisma.systemConfig.findMany()
      ]);
      
      dbGalleryItems = galleryResult;
      
      settings = settingsResult.reduce((acc, config) => {
        acc[config.key] = config.value;
        return acc;
      }, {} as Record<string, string>);
  } catch (e) {
      console.error("Failed to fetch data", e);
  }

  const galleryItems: GalleryItem[] = dbGalleryItems.map(item => ({
    id: item.id,
    image: item.imageUrl,
    caption: locale === 'bn' ? (item.captionBn || item.captionEn || '') : (item.captionEn || item.captionBn || ''),
    date: item.date.toISOString(),
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

  const steps = [
    { step: 1, icon: FileText, ...getStepContent(tHowItWorks, 'step1') },
    { step: 2, icon: Wallet, ...getStepContent(tHowItWorks, 'step2') },
    { step: 3, icon: HandHeart, ...getStepContent(tHowItWorks, 'step3') },
    { step: 4, icon: HeadphonesIcon, ...getStepContent(tHowItWorks, 'step4') },
  ];

  return (
    <>
      <Header settings={settings} />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950 dark:via-background dark:to-teal-950 min-h-[90vh] flex items-center">
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
          <div className="container-wide py-16 md:py-24 lg:py-32 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div className="space-y-8 animate-in slide-in-from-left-10 fade-in duration-700">
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 backdrop-blur-sm">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-600 mr-2 animate-pulse"></span>
                  {settings['hero.tagline'] || tHero('tagline') || (locale === 'bn' ? 'ইসলামী শরীয়াহ সম্মত' : 'Shariah Compliant Finance')}
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.1]">
                  {tHero('title')}
                </h1>
                <p className="text-lg md:text-xl text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
                  {tHero('subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 pt-4">
                  <AuthAwareCTA locale={locale} ctaText={tHero('cta')} learnMoreText={tHero('learnMore')} variant="hero" />
                </div>
                
                <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-sm text-slate-500 mb-4 font-medium uppercase tracking-wider">{locale === 'bn' ? 'আমাদের পার্টনার' : 'Trusted by community'}</p>
                  <div className="flex gap-8 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-500">
                    {(
                      [
                        settings['hero.partnerLogo1'],
                        settings['hero.partnerLogo2'],
                        settings['hero.partnerLogo3'],
                      ].filter(Boolean) as string[]
                    ).length > 0 ? (
                      ([
                        settings['hero.partnerLogo1'],
                        settings['hero.partnerLogo2'],
                        settings['hero.partnerLogo3'],
                      ]
                        .filter(Boolean) as string[]
                      ).map((logo, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={logo}
                          src={logo}
                          alt={`Partner ${index + 1}`}
                          className="h-8 w-24 rounded object-contain bg-white/30 p-1"
                        />
                      ))
                    ) : (
                      <>
                        <div className="h-8 w-24 bg-slate-300 dark:bg-slate-700 rounded animate-pulse" />
                        <div className="h-8 w-24 bg-slate-300 dark:bg-slate-700 rounded animate-pulse delay-75" />
                        <div className="h-8 w-24 bg-slate-300 dark:bg-slate-700 rounded animate-pulse delay-150" />
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Cards - Floating layout */}
              <div className="relative mx-auto w-full max-w-[500px] lg:max-w-none animate-in slide-in-from-right-10 fade-in duration-1000 delay-200">
                <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 rounded-full blur-3xl transform -translate-y-1/2 scale-75" />
                
                <div className="grid grid-cols-2 gap-4 sm:gap-6 relative z-10">
                  <div className="space-y-4 sm:space-y-6 mt-8 sm:mt-12">
                    <StatCard
                      value="১২৫+"
                      label={tStats('totalMembers')}
                      delay={0}
                      icon={<Users className="h-6 w-6 text-emerald-600" />}
                    />
                    <StatCard
                      value="৳১.৮ লক্ষ+"
                      label={tStats('loansDistributed')}
                      delay={200}
                      icon={<HandHeart className="h-6 w-6 text-blue-600" />}
                    />
                  </div>
                  <div className="space-y-4 sm:space-y-6">
                    <StatCard
                      value="৳২.৫ লক্ষ+"
                      label={tStats('totalDeposits')}
                      delay={100}
                      icon={<Wallet className="h-6 w-6 text-amber-600" />}
                    />
                    <StatCard
                      value="৳২৫,০০০+"
                      label={tStats('charitableFund')}
                      delay={300}
                      icon={<Heart className="h-6 w-6 text-rose-600" />}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-gradient-to-b from-emerald-100/30 to-transparent blur-3xl" />
          <div className="absolute bottom-0 left-0 w-1/3 h-1/3 bg-gradient-to-t from-teal-100/30 to-transparent blur-3xl" />
        </section>

        {/* Islamic Teachings Section - Quran & Hadith */}
        <section className="py-16 md:py-20 bg-gradient-to-b from-emerald-50/50 to-white dark:from-emerald-950/10 dark:to-background">
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
                  <Card key={num} className="relative overflow-hidden border-emerald-100 dark:border-emerald-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <CardContent className="pt-8 pb-8 px-6 relative">
                      <Quote className="absolute -bottom-4 -right-4 h-20 w-20 text-emerald-100 dark:text-emerald-900/50 rotate-180 -z-0 opacity-40 pointer-events-none" />
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
                  <Card key={num} className="relative overflow-hidden border-amber-100 dark:border-amber-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <CardContent className="pt-8 pb-8 px-6 relative">
                      <Quote className="absolute -bottom-4 -right-4 h-20 w-20 text-amber-100 dark:text-amber-900/50 rotate-180 -z-0 opacity-40 pointer-events-none" />
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
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 md:py-20">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {settings['features.title'] || tFeatures('title')}
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
        <section id="gallery" className="py-20 md:py-32 bg-slate-50 dark:bg-slate-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('/patterns/grid.svg')] opacity-[0.03]" />
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
              <Link href={`/${locale}/gallery`}>
                <Button variant="outline" className="hidden md:flex gap-2">
                    {locale === 'bn' ? 'সব দেখুন' : 'View All'} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <Gallery items={galleryItems} locale={locale} />
            
            <div className="mt-12 text-center md:hidden">
              <Link href={`/${locale}/gallery`}>
                <Button variant="outline" className="w-full gap-2">
                    {locale === 'bn' ? 'সব দেখুন' : 'View All'} <ArrowRight className="h-4 w-4" />
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
                        <div className="hidden lg:block absolute top-8 left-full w-full h-0.5 bg-gradient-to-r from-primary/50 to-primary/10" />
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
                {settings['contact.title'] || tContact('title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                { icon: MapPin, title: tContact('address'), value: settings['org.address'] || tContact('officeAddress') },
                { icon: Phone, title: tContact('phone'), value: settings['org.phone'] || '+880 1XXX-XXXXXX' },
                { icon: Mail, title: tContact('email'), value: settings['org.email'] || 'contact@hasnahena.org' },
              ].map((item, index) => (
                <Card key={index} className="text-center hover:shadow-lg transition-shadow">
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
          </div>
        </section>

        <section id="donate" className="py-16 md:py-20 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {settings['donation.title'] || tDonation('title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {settings['donation.subtitle'] || tDonation('subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                {
                  label: tDonation('bkash'),
                  value: settings['donation.bkash'] || '+880 1XXXXXXXXX',
                },
                {
                  label: tDonation('nagad'),
                  value: settings['donation.nagad'] || '+880 1XXXXXXXXX',
                },
                {
                  label: tDonation('rocket'),
                  value: settings['donation.rocket'] || '+880 1XXXXXXXXX',
                },
              ].map((item) => (
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
                    {settings['donation.referenceNote'] || tDonation('referenceNote')}
                  </p>
                </CardContent>
              </Card>
            </div>
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

function StatCard({
  value,
  label,
  delay,
  icon,
}: {
  value: string;
  label: string;
  delay: number;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-slate-100 dark:border-slate-800 hover:shadow-xl hover:-translate-y-2 transition-all duration-500 group animate-in zoom-in fade-in fill-mode-both" style={{ animationDelay: `${delay}ms` }}>
      <CardContent className="p-6 md:p-8 flex flex-col items-center text-center">
        {icon && (
          <div className="mb-4 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 group-hover:scale-110 transition-transform duration-300 ring-1 ring-slate-100 dark:ring-slate-700">
            {icon}
          </div>
        )}
        <div className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white mb-2 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
          {value}
        </div>
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
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
