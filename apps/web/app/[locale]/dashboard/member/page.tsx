'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Wallet, HandCoins, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MemberDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // Mock data - will be replaced with API calls
  const stats = {
    currentBalance: 15000,
    totalDeposited: 25000,
    loanBalance: 10000,
    loanEligibility: 75000,
  };

  const recentTransactions = [
    { id: 1, type: 'DEPOSIT', amount: 2000, date: '2024-03-20', receipt: 'RCP-001' },
    { id: 2, type: 'LOAN_REPAYMENT', amount: 1000, date: '2024-03-15', receipt: 'RCP-002' },
    { id: 3, type: 'DEPOSIT', amount: 3000, date: '2024-03-10', receipt: 'RCP-003' },
    { id: 4, type: 'WITHDRAWAL', amount: 1500, date: '2024-03-05', receipt: 'RCP-004' },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const transactionLabels: Record<string, { bn: string; en: string; color: string }> = {
    DEPOSIT: { bn: 'জমা', en: 'Deposit', color: 'text-green-600' },
    WITHDRAWAL: { bn: 'উত্তোলন', en: 'Withdrawal', color: 'text-red-600' },
    LOAN_DISBURSEMENT: { bn: 'ঋণ বিতরণ', en: 'Loan', color: 'text-blue-600' },
    LOAN_REPAYMENT: { bn: 'কিস্তি পরিশোধ', en: 'Repayment', color: 'text-amber-600' },
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {t('welcome')}, <span className="text-primary">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
        </h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'আপনার অ্যাকাউন্টের সারসংক্ষেপ দেখুন'
            : 'View your account summary'}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('currentBalance')}</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {formatCurrency(stats.currentBalance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সঞ্চয় স্থিতি' : 'Savings Balance'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('totalDeposited')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalDeposited)}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-green-500" />
              {locale === 'bn' ? 'মোট জমা' : 'Total deposits'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('loanBalance')}</CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(stats.loanBalance)}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowDownRight className="h-3 w-3 text-amber-500" />
              {locale === 'bn' ? 'ঋণ স্থিতি' : 'Outstanding loan'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('loanEligibility')}</CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(stats.loanEligibility)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সর্বোচ্চ ঋণ পরিমাণ' : 'Max loan amount'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Button className="h-auto py-4 flex flex-col gap-2">
          <Wallet className="h-6 w-6" />
          <span>{locale === 'bn' ? 'আমানত করুন' : 'Make Deposit'}</span>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2">
          <HandCoins className="h-6 w-6" />
          <span>{locale === 'bn' ? 'ঋণ আবেদন' : 'Apply for Loan'}</span>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2">
          <ArrowUpRight className="h-6 w-6" />
          <span>{locale === 'bn' ? 'উত্তোলন অনুরোধ' : 'Request Withdrawal'}</span>
        </Button>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('recentTransactions')}</CardTitle>
            <CardDescription>
              {locale === 'bn' ? 'আপনার সাম্প্রতিক লেনদেন' : 'Your recent transactions'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm">
            {t('viewAll')}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      tx.type.includes('DEPOSIT') || tx.type === 'LOAN_REPAYMENT'
                        ? 'bg-green-100 text-green-600'
                        : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {tx.type.includes('DEPOSIT') || tx.type === 'LOAN_REPAYMENT' ? (
                      <ArrowUpRight className="h-5 w-5" />
                    ) : (
                      <ArrowDownRight className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">
                      {locale === 'bn'
                        ? transactionLabels[tx.type]?.bn
                        : transactionLabels[tx.type]?.en}
                    </p>
                    <p className="text-xs text-muted-foreground">{tx.receipt}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${transactionLabels[tx.type]?.color}`}>
                    {tx.type.includes('DEPOSIT') || tx.type === 'LOAN_REPAYMENT' ? '+' : '-'}
                    {formatCurrency(tx.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">{tx.date}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
