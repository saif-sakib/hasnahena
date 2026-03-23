'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import {
  Wallet,
  HandCoins,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Clock,
  AlertCircle,
  ChevronRight,
  Check,
  X,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MemberDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // Mock data - will be replaced with API calls
  const stats = {
    currentBalance: 15000,
    totalDeposited: 25000,
    loanBalance: 35000,
    loanEligibility: 75000,
  };

  const pendingConfirmations = [
    { id: 'p1', type: 'DEPOSIT', amount: 3000, date: '2024-03-15', receipt: 'RCP-2024-002' },
  ];

  const guarantorRequests = [
    { id: 'gr1', borrowerName: 'আবদুল রহমান', loanAmount: 40000, requestDate: '2024-03-18' },
  ];

  const activeLoan = {
    loanNumber: 'LN-2024-001',
    remainingAmount: 35000,
    nextInstallment: 5000,
    nextDueDate: '2024-04-15',
    paidInstallments: 3,
    totalInstallments: 10,
  };

  const recentTransactions = [
    { id: 1, type: 'DEPOSIT', amount: 5000, date: '2024-03-20', receipt: 'RCP-2024-001' },
    { id: 2, type: 'LOAN_REPAYMENT', amount: 5000, date: '2024-03-15', receipt: 'RCP-2024-002' },
    { id: 3, type: 'DEPOSIT', amount: 3000, date: '2024-03-10', receipt: 'RCP-2024-003' },
    { id: 4, type: 'WITHDRAWAL', amount: 2000, date: '2024-03-05', receipt: 'RCP-2024-004' },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      month: 'short',
      day: 'numeric',
    });
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

      {/* Alerts Section */}
      {(pendingConfirmations.length > 0 || guarantorRequests.length > 0) && (
        <div className="space-y-3">
          {/* Pending Confirmations Alert */}
          {pendingConfirmations.length > 0 && (
            <Card className="rounded-2xl border-amber-200 bg-amber-50/50 shadow-sm">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-5 w-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-amber-800">
                        {locale === 'bn' ? 'নিশ্চিতকরণ অপেক্ষমান' : 'Pending Confirmations'}
                      </h3>
                      <Link href={`/${locale}/dashboard/member/deposits`}>
                        <Button size="sm" variant="outline" className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-100">
                          {locale === 'bn' ? 'দেখুন' : 'View'}
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                    <p className="text-sm text-amber-700">
                      {locale === 'bn'
                        ? `${pendingConfirmations.length}টি লেনদেন আপনার নিশ্চিতকরণ অপেক্ষা করছে`
                        : `${pendingConfirmations.length} transaction(s) awaiting your confirmation`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Guarantor Requests Alert */}
          {guarantorRequests.length > 0 && (
            <Card className="rounded-2xl border-blue-200 bg-blue-50/50 shadow-sm">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-blue-800">
                        {locale === 'bn' ? 'জামিনদার অনুরোধ' : 'Guarantor Requests'}
                      </h3>
                      <Link href={`/${locale}/dashboard/member/loans`}>
                        <Button size="sm" variant="outline" className="gap-1 border-blue-300 text-blue-700 hover:bg-blue-100">
                          {locale === 'bn' ? 'দেখুন' : 'View'}
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                    <p className="text-sm text-blue-700">
                      {locale === 'bn'
                        ? `${guarantorRequests.length} সদস্য আপনাকে জামিনদার হিসেবে অনুরোধ করেছেন`
                        : `${guarantorRequests.length} member(s) requested you as guarantor`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

        <Card className="rounded-2xl border-slate-200 shadow-sm">
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

      {/* Active Loan Card */}
      {activeLoan && (
        <Card className="rounded-2xl border-emerald-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <p className="text-sm opacity-90">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</p>
                <p className="font-semibold">{activeLoan.loanNumber}</p>
              </div>
              <Link href={`/${locale}/dashboard/member/loans`}>
                <Button size="sm" variant="secondary" className="gap-1">
                  {locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অবশিষ্ট' : 'Remaining'}</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(activeLoan.remainingAmount)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'পরবর্তী কিস্তি' : 'Next Installment'}</p>
                <p className="text-xl font-bold">{formatCurrency(activeLoan.nextInstallment)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নির্ধারিত তারিখ' : 'Due Date'}</p>
                <p className="text-xl font-bold flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {formatDate(activeLoan.nextDueDate)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অগ্রগতি' : 'Progress'}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${(activeLoan.paidInstallments / activeLoan.totalInstallments) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{activeLoan.paidInstallments}/{activeLoan.totalInstallments}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href={`/${locale}/dashboard/member/deposits`}>
          <Button className="w-full h-auto py-4 flex flex-col gap-2">
            <Wallet className="h-6 w-6" />
            <span>{locale === 'bn' ? 'আমানত করুন' : 'Make Deposit'}</span>
          </Button>
        </Link>
        <Link href={`/${locale}/dashboard/member/loans`}>
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <HandCoins className="h-6 w-6" />
            <span>{locale === 'bn' ? 'ঋণ আবেদন' : 'Apply for Loan'}</span>
          </Button>
        </Link>
        <Link href={`/${locale}/dashboard/member/profile`}>
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <ArrowUpRight className="h-6 w-6" />
            <span>{locale === 'bn' ? 'উত্তোলন অনুরোধ' : 'Request Withdrawal'}</span>
          </Button>
        </Link>
      </div>

      {/* Recent Transactions */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('recentTransactions')}</CardTitle>
            <CardDescription>
              {locale === 'bn' ? 'আপনার সাম্প্রতিক লেনদেন' : 'Your recent transactions'}
            </CardDescription>
          </div>
          <Link href={`/${locale}/dashboard/member/transactions`}>
            <Button variant="outline" size="sm" className="gap-1">
              {t('viewAll')}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
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
                  <p className="text-xs text-muted-foreground">{formatDate(tx.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
