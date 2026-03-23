import { useTranslations } from 'next-intl';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Shield, Users, Eye, Lock, Wallet, HandHeart, FileText, HeadphonesIcon, BookOpen, Quote, Phone, Mail, MapPin, GraduationCap, Heart, Briefcase, Calendar, Image as ImageIcon } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Gallery, GalleryItem } from '@/components/ui/gallery';
import { locales } from '@/i18n';

export default function HomePage({ params: { locale } }: { params: { locale: string } }) {
  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  unstable_setRequestLocale(locale);
  const t = useTranslations();

  const features = [
    {
      icon: Shield,
      title: t('features.noInterest.title'),
      description: t('features.noInterest.description'),
    },
    {
      icon: Users,
      title: t('features.community.title'),
      description: t('features.community.description'),
    },
    {
      icon: Eye,
      title: t('features.transparent.title'),
      description: t('features.transparent.description'),
    },
    {
      icon: Lock,
      title: t('features.secure.title'),
      description: t('features.secure.description'),
    },
  ];

  const activities = [
    {
      icon: Wallet,
      title: t('activities.finance.title'),
      description: t('activities.finance.description'),
    },
    {
      icon: GraduationCap,
      title: t('activities.education.title'),
      description: t('activities.education.description'),
    },
    {
      icon: Heart,
      title: t('activities.health.title'),
      description: t('activities.health.description'),
    },
    {
      icon: HandHeart,
      title: t('activities.charity.title'),
      description: t('activities.charity.description'),
    },
    {
      icon: Briefcase,
      title: t('activities.training.title'),
      description: t('activities.training.description'),
    },
    {
      icon: Calendar,
      title: t('activities.social.title'),
      description: t('activities.social.description'),
    },
  ];

  // Sample gallery items - replace with actual data from your backend
  const galleryItems: GalleryItem[] = [
    {
      id: '1',
      image: '/images/gallery/activity-1.jpg',
      caption: locale === 'bn' ? 'সুদমুক্ত ঋণ বিতরণ অনুষ্ঠান ২০২৪' : 'Interest-Free Loan Distribution Event 2024',
      date: '2024-01-15',
      likes: 45,
    },
    {
      id: '2',
      image: '/images/gallery/activity-2.jpg',
      caption: locale === 'bn' ? 'শিক্ষা বৃত্তি প্রদান' : 'Education Scholarship Distribution',
      date: '2024-02-20',
      likes: 32,
    },
    {
      id: '3',
      image: '/images/gallery/activity-3.jpg',
      caption: locale === 'bn' ? 'বিনামূল্যে স্বাস্থ্য ক্যাম্প' : 'Free Health Camp',
      date: '2024-03-10',
      likes: 56,
    },
  ];

  const steps = [
    { step: 1, icon: FileText, ...getStepContent(t, 'step1') },
    { step: 2, icon: Wallet, ...getStepContent(t, 'step2') },
    { step: 3, icon: HandHeart, ...getStepContent(t, 'step3') },
    { step: 4, icon: HeadphonesIcon, ...getStepContent(t, 'step4') },
  ];

  return (
    <>
      <Header />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950 dark:via-background dark:to-teal-950">
          <div className="container-wide py-16 md:py-20 lg:py-24">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div className="space-y-6">
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {t('hero.title')}
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-xl">
                  {t('hero.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row gap-4 pt-2">
                  <Link href={`/${locale}/register`}>
                    <Button size="xl" className="gap-2 w-full sm:w-auto shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
                      {t('hero.cta')}
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </Link>
                  <Link href="#how-it-works">
                    <Button variant="outline" size="xl" className="w-full sm:w-auto">
                      {t('hero.learnMore')}
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-4">
                <StatCard
                  value="১২৫+"
                  label={t('stats.totalMembers')}
                  delay={0}
                />
                <StatCard
                  value="৳২.৫ লক্ষ+"
                  label={t('stats.totalDeposits')}
                  delay={100}
                />
                <StatCard
                  value="৳১.৮ লক্ষ+"
                  label={t('stats.loansDistributed')}
                  delay={200}
                />
                <StatCard
                  value="৳২৫,০০০+"
                  label={t('stats.charitableFund')}
                  delay={300}
                />
              </div>
            </div>
          </div>

          {/* Background decoration */}
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl pointer-events-none" />
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
                  {t('quran.title')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {t('quran.subtitle')}
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="relative overflow-hidden border-emerald-100 dark:border-emerald-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <CardContent className="pt-8 pb-6 px-6">
                      <Quote className="absolute top-4 right-4 h-8 w-8 text-emerald-200 dark:text-emerald-800/50" />
                      <p className="text-base leading-relaxed mb-4 font-bengali">
                        {t(`quran.ayah${num}.text`)}
                      </p>
                      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                        — {t(`quran.ayah${num}.source`)}
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
                  {t('hadith.title')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {t('hadith.subtitle')}
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {[1, 2, 3].map((num) => (
                  <Card key={num} className="relative overflow-hidden border-amber-100 dark:border-amber-900/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <CardContent className="pt-8 pb-6 px-6">
                      <Quote className="absolute top-4 right-4 h-8 w-8 text-amber-200 dark:text-amber-800/50" />
                      <p className="text-base leading-relaxed mb-4 font-bengali">
                        {t(`hadith.hadith${num}.text`)}
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                        — {t(`hadith.hadith${num}.source`)}
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
                {t('activities.title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('activities.subtitle')}
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
                {t('features.title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('features.subtitle')}
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
        <section id="gallery" className="py-16 md:py-20 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-background">
          <div className="container-wide">
            <div className="text-center mb-12">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-4">
                <ImageIcon className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
                {t('gallery.title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('gallery.subtitle')}
              </p>
            </div>

            <Gallery items={galleryItems} locale={locale} />
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-16 md:py-20 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">
                {t('howItWorks.title')}
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
                {t('contact.title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                { icon: MapPin, title: t('contact.address'), value: t('contact.officeAddress') },
                { icon: Phone, title: t('contact.phone'), value: '+880 1XXX-XXXXXX' },
                { icon: Mail, title: t('contact.email'), value: 'contact@hasnahena.org' },
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

        {/* CTA Section */}
        <section className="py-16 md:py-20 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-white">
          <div className="container-wide text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
              {locale === 'bn'
                ? 'আজই সুদমুক্ত অর্থায়নে যোগ দিন'
                : 'Join Interest-Free Finance Today'}
            </h2>
            <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
              {locale === 'bn'
                ? 'হাসনাহেনার সদস্য হয়ে সুদমুক্ত ঋণের সুবিধা নিন'
                : 'Become a member of Hasnahena and enjoy interest-free loans'}
            </p>
            <Link href={`/${locale}/register`}>
              <Button
                size="xl"
                variant="secondary"
                className="gap-2 text-primary shadow-lg hover:shadow-xl transition-all"
              >
                {t('hero.cta')}
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function StatCard({
  value,
  label,
  delay,
}: {
  value: string;
  label: string;
  delay: number;
}) {
  return (
    <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm border-slate-100 dark:border-slate-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <CardContent className="p-6 text-center">
        <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-primary mb-1">
          {value}
        </div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function getStepContent(t: any, step: string) {
  return {
    title: t(`howItWorks.${step}.title`),
    description: t(`howItWorks.${step}.description`),
  };
}
