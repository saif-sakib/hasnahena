'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Users, HandCoins, Clock, ArrowUpRight, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';

export default function WorkerDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const [stats, setStats] = useState({
    totalMembers: 0,
    pendingRequests: 0,
    todayDeposits: 0,
    todayLoans: 0,
  });
  const [pendingRequests, setPendingRequests] = useState<Array<{ id: string; type: string; member: string; amount: number; time: string }>>([]);

  useEffect(() => {
    const loadWorkerDashboard = async () => {
      try {
        const data = await apiGet<{
          stats: {
            totalMembers: number;
            pendingRequests: number;
            todayDeposits: number;
            todayLoans: number;
          };
          pendingRequests: Array<{ id: string; type: string; member: string; amount: number; time: string }>;
        }>('/v1/dashboard/worker');
        setStats(data.stats);
        setPendingRequests(data.pendingRequests || []);
      } catch {
        setPendingRequests([]);
      }
    };
    loadWorkerDashboard();
  }, []);

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
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

        <Card className="rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm">
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

        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

        <Card className="rounded-2xl border-slate-200 shadow-sm">
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <a href={`/${locale}/dashboard/worker/requests`}>
            <Clock className="h-6 w-6" />
            <span>{locale === 'bn' ? 'সদস্যের অনুরোধ দেখুন' : 'View Member Requests'}</span>
          </a>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
          <a href={`/${locale}/dashboard/worker/members`}>
            <Users className="h-6 w-6" />
            <span>{locale === 'bn' ? 'সদস্য তালিকা' : 'Member List'}</span>
          </a>
        </Button>
      </div>

      {/* Pending Requests */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
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
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
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
                      <p className="text-xs text-muted-foreground">{new Date(req.time).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}</p>
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
