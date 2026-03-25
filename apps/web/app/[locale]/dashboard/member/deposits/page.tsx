'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  Plus,
  Check,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

type DepositStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';

interface Deposit {
  id: string;
  amount: number;
  date: string;
  receiptNumber: string;
  status: DepositStatus;
  processedBy?: string;
  balanceAfter?: number;
}

export default function DepositsPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'confirmed'>('all');
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = localStorage.getItem('hn_access_token');
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const [depositsData, profileData] = await Promise.all([
        apiGet<{
          deposits: Deposit[];
          currentBalance: number;
        }>('/v1/dashboard/member/deposits'),
        apiGet<{
          accountSummary?: {
            currentBalance?: number;
          };
        }>('/v1/dashboard/member/profile'),
      ]);
      setDeposits(depositsData?.deposits ?? []);
      setCurrentBalance(profileData?.accountSummary?.currentBalance ?? depositsData?.currentBalance ?? 0);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const totalDeposited = deposits
    .filter((d) => d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + d.amount, 0);

  const pendingAmount = deposits
    .filter((d) => d.status === 'PENDING')
    .reduce((sum, d) => sum + d.amount, 0);


  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusIcon = (status: DepositStatus) => {
    switch (status) {
      case 'PENDING':
        return <Clock className="h-4 w-4 text-amber-500" />;
      case 'CONFIRMED':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'DISPUTED':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusLabel = (status: DepositStatus) => {
    const labels: Record<DepositStatus, { bn: string; en: string; color: string }> = {
      PENDING: { bn: 'অপেক্ষমান', en: 'Pending', color: 'bg-amber-100 text-amber-700' },
      CONFIRMED: { bn: 'নিশ্চিত', en: 'Confirmed', color: 'bg-green-100 text-green-700' },
      DISPUTED: { bn: 'বিবাদিত', en: 'Disputed', color: 'bg-red-100 text-red-700' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected', color: 'bg-gray-100 text-gray-700' },
    };
    return labels[status];
  };

  const filteredDeposits = deposits.filter((d) => {
    if (activeTab === 'pending') return d.status === 'PENDING';
    if (activeTab === 'confirmed') return d.status === 'CONFIRMED';
    return true;
  });

  const handleDepositSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      setActionError(null);
      const token = localStorage.getItem('hn_access_token');
      if (!token) {
        router.push(`/${locale}/login`);
        return;
      }

      const amount = Number(depositAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setActionError('Invalid deposit amount');
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch('/api/v1/transactions/deposit-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ amount }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionError(json?.error ?? 'Failed to submit deposit request');
          return;
        }

        setShowDepositForm(false);
        setDepositAmount('');
        await refresh();
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {t('myDeposits')}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'আপনার আমানত পরিচালনা করুন এবং নতুন আমানত অনুরোধ করুন'
              : 'Manage your deposits and request new deposits'}
          </p>
        </div>
        <Button onClick={() => setShowDepositForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t('requestDeposit')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('totalDeposited')}</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposited, locale)}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'নিশ্চিত আমানত' : 'Confirmed deposits'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('pendingDeposits')}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(pendingAmount, locale)}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'প্রক্রিয়াধীন' : 'Processing'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('currentBalance')}</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(currentBalance, locale)}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সঞ্চয় স্থিতি' : 'Savings balance'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Deposit Form Modal */}
      {showDepositForm && (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" />
              {t('requestDeposit')}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'নতুন আমানতের জন্য অনুরোধ করুন। কর্মী/প্রশাসন টাকা গ্রহণের পর সরাসরি নিশ্চিত হবে।'
                : 'Request a new deposit. It will be finalized by worker/admin after receiving cash.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleDepositSubmit} className="space-y-4">
              {actionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="amount">{t('depositAmount')}</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder={t('enterAmount')}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  min="100"
                  required
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">{t('minDeposit')}</p>
              </div>
              <div className="flex gap-2">
                 <Button type="submit" className="gap-2" disabled={isSubmitting}>
                   <Check className="h-4 w-4" />
                   {t('submitRequest')}
                 </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDepositForm(false)}
                >
                  {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {locale === 'bn' ? 'সব' : 'All'} ({deposits.length})
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('pendingDeposits')} ({deposits.filter((d) => d.status === 'PENDING').length})
        </button>
        <button
          onClick={() => setActiveTab('confirmed')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'confirmed'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('confirmedDeposits')} ({deposits.filter((d) => d.status === 'CONFIRMED').length})
        </button>
      </div>

      {/* Deposits List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{t('depositHistory')}</CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? 'আপনার সকল আমানত লেনদেন'
              : 'All your deposit transactions'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredDeposits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {locale === 'bn' ? 'কোন আমানত পাওয়া যায়নি' : 'No deposits found'}
              </div>
            ) : (
              filteredDeposits.map((deposit) => {
                const statusInfo = getStatusLabel(deposit.status);
                return (
                  <div
                    key={deposit.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                        <ArrowUpRight className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-lg">
                            {formatCurrency(deposit.amount, locale)}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                          >
                            {getStatusIcon(deposit.status)}
                            {locale === 'bn' ? statusInfo.bn : statusInfo.en}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {deposit.receiptNumber} • {formatDate(deposit.date)}
                        </p>
                        {deposit.balanceAfter && (
                          <p className="text-xs text-muted-foreground">
                            {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'} {formatCurrency(deposit.balanceAfter, locale)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* No member-side confirmation for deposits */}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Download Statement */}
      <div className="flex justify-end">
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          {t('downloadStatement')}
        </Button>
      </div>
    </div>
  );
}
