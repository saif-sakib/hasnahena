'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Users, Wallet, HandCoins, TrendingUp, Building, AlertTriangle, PieChart, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // Mock data
  const stats = {
    totalMembers: 125,
    totalWorkers: 5,
    totalDeposits: 2500000,
    totalLoans: 1800000,
    activeLoanCount: 45,
    defaultedLoans: 2,
    charityFund: 125000,
    monthlyGrowth: 12.5,
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const recentActivity = [
    { id: 1, action: 'নতুন সদস্য নিবন্ধন', user: 'নূর হোসেন', time: '5 মিনিট আগে' },
    { id: 2, action: 'ঋণ অনুমোদন', user: 'ফাতেমা বেগম', time: '15 মিনিট আগে' },
    { id: 3, action: 'জমা গ্রহণ', user: 'আব্দুল করিম', time: '30 মিনিট আগে' },
    { id: 4, action: 'কর্মী যোগ', user: 'রফিকুল ইসলাম', time: '1 ঘণ্টা আগে' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'অ্যাডমিন ড্যাশবোর্ড' : 'Admin Dashboard'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'হাসনাহেনা প্রতিষ্ঠানের সম্পূর্ণ পরিচালনা'
              : 'Complete management of Hasnahena organization'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <BarChart3 className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'রিপোর্ট' : 'Reports'}
          </Button>
          <Button>
            <Users className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'কর্মী যোগ করুন' : 'Add Worker'}
          </Button>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalMembers}</div>
            <p className="text-xs text-green-600 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              +{stats.monthlyGrowth}% {locale === 'bn' ? 'এই মাসে' : 'this month'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'মোট আমানত' : 'Total Deposits'}
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(stats.totalDeposits)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সঞ্চয় পুল' : 'Savings pool'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'বিতরণকৃত ঋণ' : 'Loans Disbursed'}
            </CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(stats.totalLoans)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.activeLoanCount} {locale === 'bn' ? 'সক্রিয় ঋণ' : 'active loans'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'দান তহবিল' : 'Charity Fund'}
            </CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(stats.charityFund)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'অনুদান থেকে' : 'From donations'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'কর্মী সংখ্যা' : 'Workers'}
            </CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalWorkers}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সক্রিয় কর্মী' : 'Active workers'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'ঝুঁকিপূর্ণ ঋণ' : 'At Risk Loans'}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.defaultedLoans}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'বকেয়া/খেলাপি' : 'Overdue/defaulted'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'পুনরুদ্ধার হার' : 'Recovery Rate'}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">98.5%</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'ঋণ পরিশোধ হার' : 'Loan repayment rate'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>
              {locale === 'bn' ? 'সাম্প্রতিক কার্যক্রম' : 'Recent Activity'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'প্রতিষ্ঠানের সাম্প্রতিক কার্যক্রম'
                : 'Recent organization activity'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <p className="font-medium">{activity.action}</p>
                    <p className="text-sm text-muted-foreground">{activity.user}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats Chart Placeholder */}
        <Card>
          <CardHeader>
            <CardTitle>
              {locale === 'bn' ? 'মাসিক সারসংক্ষেপ' : 'Monthly Summary'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'জমা বনাম ঋণ বিতরণ'
                : 'Deposits vs Loan Disbursements'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center bg-muted/30 rounded-lg">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-2" />
                <p>{locale === 'bn' ? 'চার্ট শীঘ্রই আসছে' : 'Chart coming soon'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
