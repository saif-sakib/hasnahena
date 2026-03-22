import { useTranslations } from 'next-intl';
import { unstable_setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Shield, Users, Eye, Lock, Wallet, HandHeart, FileText, HeadphonesIcon, BookOpen, Quote, Phone, Mail, MapPin } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function HomePage({ params: { locale } }: { params: { locale: string } }) {
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
        <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-background">
          <div className="container-wide section-padding">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6 animate-fade-up">
                <div className="flex items-center gap-4 mb-4">
                  <Image
                    src="/images/logo.png"
                    alt="Hasnahena Logo"
                    width={80}
                    height={80}
                    className="rounded-full shadow-lg"
                  />
                  <div>
                    <h2 className="text-2xl font-bold text-primary">
                      {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t('common.motto')}
                    </p>
                  </div>
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                  <span className="gradient-text">{t('hero.title')}</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-lg">
                  {t('hero.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link href={`/${locale}/register`}>
                    <Button size="xl" className="gap-2 w-full sm:w-auto">
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
                  className="animate-fade-up"
                  style={{ animationDelay: '100ms' }}
                />
                <StatCard
                  value="৳২.৫ লক্ষ+"
                  label={t('stats.totalDeposits')}
                  className="animate-fade-up"
                  style={{ animationDelay: '200ms' }}
                />
                <StatCard
                  value="৳১.৮ লক্ষ+"
                  label={t('stats.loansDistributed')}
                  className="animate-fade-up"
                  style={{ animationDelay: '300ms' }}
                />
                <StatCard
                  value="৳২৫,০০০+"
                  label={t('stats.charitableFund')}
                  className="animate-fade-up"
                  style={{ animationDelay: '400ms' }}
                />
              </div>
            </div>
          </div>

          {/* Background decoration */}
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-200/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-300/20 rounded-full blur-3xl" />
        </section>

        {/* Hadith Section */}
        <section className="section-padding bg-gradient-to-b from-amber-50 to-white dark:from-amber-950/20 dark:to-background">
          <div className="container-wide">
            <div className="text-center mb-12">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
                <BookOpen className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t('hadith.title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('hadith.subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {[1, 2, 3].map((num) => (
                <Card key={num} className="relative overflow-hidden border-amber-200 dark:border-amber-800">
                  <CardContent className="pt-8 pb-6">
                    <Quote className="absolute top-4 left-4 h-8 w-8 text-amber-200 dark:text-amber-800" />
                    <p className="text-base md:text-lg mb-4 relative z-10 font-bengali leading-relaxed">
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
        </section>

        {/* Features Section */}
        <section id="about" className="section-padding">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t('features.title')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('features.subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <Card key={index} className="card-hover">
                  <CardContent className="pt-6">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="section-padding bg-muted/50">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold">
                {t('howItWorks.title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, index) => (
                <div key={index} className="relative">
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mb-4">
                        {step.step}
                      </div>
                      {index < steps.length - 1 && (
                        <div className="hidden lg:block absolute top-8 left-full w-full h-0.5 bg-primary/30" />
                      )}
                    </div>
                    <h3 className="font-semibold mb-2">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" className="section-padding">
          <div className="container-wide">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t('contact.title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <Card className="text-center">
                <CardContent className="pt-6">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <MapPin className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{t('contact.address')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('contact.officeAddress')}
                  </p>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardContent className="pt-6">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Phone className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{t('contact.phone')}</h3>
                  <p className="text-sm text-muted-foreground">
                    +880 1XXX-XXXXXX
                  </p>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardContent className="pt-6">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{t('contact.email')}</h3>
                  <p className="text-sm text-muted-foreground">
                    contact@hasnahena.org
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="section-padding gradient-primary text-white">
          <div className="container-wide text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {locale === 'bn'
                ? 'আজই সুদমুক্ত অর্থায়নে যোগ দিন'
                : 'Join Interest-Free Finance Today'}
            </h2>
            <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
              {locale === 'bn'
                ? 'হাসনাহেনা সমবায়ের সদস্য হয়ে সুদমুক্ত ঋণের সুবিধা নিন'
                : 'Become a member of Hasnahena cooperative and enjoy interest-free loans'}
            </p>
            <Link href={`/${locale}/register`}>
              <Button
                size="xl"
                variant="secondary"
                className="gap-2 text-primary"
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
  className,
  style,
}: {
  value: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card className={`card-hover ${className}`} style={style}>
      <CardContent className="p-6 text-center">
        <div className="text-3xl md:text-4xl font-bold text-primary mb-1">
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
