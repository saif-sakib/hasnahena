'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Users, Wallet, HandCoins, Clock, ArrowUpRight, ArrowDownRight, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function WorkerDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // Mock data
  const stats = {
    totalMembers: 125,
    pendingRequests: 8,
    todayDeposits: 45000,
    todayLoans: 25000,
  };

  const pendingRequests = [
    { id: 1, type: 'DEPOSIT', member: 'আব্দুল করিম', amount: 5000, time: '10 মিনিট আগে' },
    { id: 2, type: 'LOAN', member: 'ফাতেমা বেগম', amount: 15000, time: '25 মিনিট আগে' },
    { id: 3, type: 'WITHDRAWAL', member: 'মোহাম্মদ আলী', amount: 3000, time: '1 ঘণ্টা আগে' },
    { id: 4, type: 'REGISTRATION', member: 'নূর হোসেন', amount: 100, time: '2 ঘণ্টা আগে' },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const requestLabels: Record<string, { bn: string; en: string; color: string }> = {
    DEPOSIT: { bn: 'জমা', en: 'Deposit', color: 'bg-green-100 text-green-600' },
    WITHDRAWAL: { bn: 'উত্তোলন', en: 'Withdrawal', color: 'bg-red-100 text-red-600' },
    LOAN: { bn: 'ঋণ আবেদন', en: 'Loan Request', color: 'bg-blue-100 text-blue-600' },
    REGISTRATION: { bn: 'নিবন্ধন', en: 'Registration', color: 'bg-purple-100 text-purple-600' },
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {locale === 'bn' ? 'কর্মী ড্যাশবোর্ড' : 'Worker Dashboard'}
        </h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'সদস্যদের অনুরোধ ও লেনদেন পরিচালনা করুন'
            : 'Manage member requests and transactions'}
        </p>
      </div>

      {/* Stats Cards */}
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
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সক্রিয় সদস্য' : 'Active members'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'অপেক্ষমান অনুরোধ' : 'Pending Requests'}
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pendingRequests}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'প্রক্রিয়াকরণ প্রয়োজন' : 'Needs processing'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'আজকের জমা' : "Today's Deposits"}
            </CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(stats.todayDeposits)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'আজ সংগৃহীত' : 'Collected today'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'bn' ? 'আজকের ঋণ' : "Today's Loans"}
            </CardTitle>
            <HandCoins className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(stats.todayLoans)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'আজ বিতরণ' : 'Disbursed today'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Button className="h-auto py-4 flex flex-col gap-2">
          <Wallet className="h-6 w-6" />
          <span>{locale === 'bn' ? 'জমা গ্রহণ' : 'Accept Deposit'}</span>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2">
          <ArrowDownRight className="h-6 w-6" />
          <span>{locale === 'bn' ? 'উত্তোলন প্রক্রিয়া' : 'Process Withdrawal'}</span>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2">
          <HandCoins className="h-6 w-6" />
          <span>{locale === 'bn' ? 'ঋণ বিতরণ' : 'Disburse Loan'}</span>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2">
          <Users className="h-6 w-6" />
          <span>{locale === 'bn' ? 'নতুন সদস্য' : 'New Member'}</span>
        </Button>
      </div>

      {/* Pending Requests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              {locale === 'bn' ? 'অপেক্ষমান অনুরোধ' : 'Pending Requests'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'প্রক্রিয়াকরণের অপেক্ষায় থাকা অনুরোধ'
                : 'Requests waiting for processing'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm">
            {t('viewAll')}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between py-3 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      requestLabels[req.type]?.color
                    }`}
                  >
                    {locale === 'bn'
                      ? requestLabels[req.type]?.bn
                      : requestLabels[req.type]?.en}
                  </span>
                  <div>
                    <p className="font-medium">{req.member}</p>
                    <p className="text-xs text-muted-foreground">{req.time}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{formatCurrency(req.amount)}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
