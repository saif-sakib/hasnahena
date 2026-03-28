'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  Wallet,
  HandCoins,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronRight,
  Calendar,
  Receipt,
  MessageCircle,
  Info,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

interface DashboardStats {
  currentBalance: number;
  totalDeposited: number;
  loanBalance: number;
  loanEligibility: number;
}

interface ActiveLoanData {
  loanNumber: string;
  remainingAmount: number;
  nextInstallment: number;
  nextDueDate: string;
  paidInstallments: number;
  totalInstallments: number;
}

interface RecentTransaction {
  id: string;
  type: string;
  amount: number;
  date: string;
  receipt: string;
}

interface MemberDashboardResponse {
  stats: DashboardStats;
  activeLoan: ActiveLoanData | null;
  recentTransactions: RecentTransaction[];
}

export default function MemberDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [data, setData] = useState<MemberDashboardResponse>({
    stats: {
      currentBalance: 0,
      totalDeposited: 0,
      loanBalance: 0,
      loanEligibility: 0,
    },
    activeLoan: null,
    recentTransactions: [],
  });

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await apiGet<MemberDashboardResponse>('/v1/dashboard/member');
        setData(response);
      } catch {
        setData((prev) => ({ ...prev }));
      }
    };

    loadDashboard();
  }, []);

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

      {/* Info Notice */}
      <Card className="rounded-2xl border-blue-200 bg-blue-50/50 shadow-sm">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-blue-800">
                {locale === 'bn'
                  ? 'আমানত, উত্তোলন বা ঋণের জন্য অফিসে যোগাযোগ করুন অথবা সাপোর্টে মেসেজ করুন।'
                  : 'For deposits, withdrawals, or loans, please visit the office or contact support.'}
              </p>
              <Link href={`/${locale}/dashboard/member/support`}>
                <Button variant="link" className="h-auto p-0 mt-1 text-blue-700 hover:text-blue-900 gap-1">
                  <MessageCircle className="h-4 w-4" />
                  {locale === 'bn' ? 'সাপোর্টে যোগাযোগ করুন' : 'Contact Support'}
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('currentBalance')}</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
               {formatCurrency(data.stats.currentBalance, locale)}
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
             <div className="text-2xl font-bold">{formatCurrency(data.stats.totalDeposited, locale)}</div>
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
               {formatCurrency(data.stats.loanBalance, locale)}
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
               {formatCurrency(data.stats.loanEligibility, locale)}
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সর্বোচ্চ ঋণ পরিমাণ' : 'Max loan amount'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active Loan Card */}
      {data.activeLoan && (
        <Card className="rounded-2xl border-emerald-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <p className="text-sm opacity-90">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</p>
                <p className="font-semibold">{data.activeLoan.loanNumber}</p>
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
                <p className="text-xl font-bold text-amber-600">{formatCurrency(data.activeLoan.remainingAmount, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'পরবর্তী কিস্তি' : 'Next Installment'}</p>
                <p className="text-xl font-bold">{formatCurrency(data.activeLoan.nextInstallment, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নির্ধারিত তারিখ' : 'Due Date'}</p>
                <p className="text-xl font-bold flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                   {formatDate(data.activeLoan.nextDueDate, locale)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অগ্রগতি' : 'Progress'}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                       style={{ width: `${(data.activeLoan.paidInstallments / data.activeLoan.totalInstallments) * 100}%` }}
                    />
                  </div>
                   <span className="text-sm font-medium">{data.activeLoan.paidInstallments}/{data.activeLoan.totalInstallments}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick View Links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href={`/${locale}/dashboard/member/deposits`}>
          <Card className="rounded-2xl border-slate-200 shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                <Wallet className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="font-semibold">{locale === 'bn' ? 'আমানতের ইতিহাস' : 'Deposit History'}</p>
                <p className="text-xs text-muted-foreground">{locale === 'bn' ? 'আপনার সকল আমানত দেখুন' : 'View all your deposits'}</p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1">
                <Eye className="h-4 w-4" />
                {locale === 'bn' ? 'দেখুন' : 'View'}
              </Button>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/${locale}/dashboard/member/loans`}>
          <Card className="rounded-2xl border-slate-200 shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                <HandCoins className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="font-semibold">{locale === 'bn' ? 'ঋণের স্থিতি' : 'Loan Status'}</p>
                <p className="text-xs text-muted-foreground">{locale === 'bn' ? 'আপনার ঋণের তথ্য দেখুন' : 'View your loan information'}</p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1">
                <Eye className="h-4 w-4" />
                {locale === 'bn' ? 'দেখুন' : 'View'}
              </Button>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/${locale}/dashboard/member/transactions`}>
          <Card className="rounded-2xl border-slate-200 shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Receipt className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold">{locale === 'bn' ? 'লেনদেনের ইতিহাস' : 'Transaction History'}</p>
                <p className="text-xs text-muted-foreground">{locale === 'bn' ? 'সকল লেনদেন দেখুন' : 'View all transactions'}</p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1">
                <Eye className="h-4 w-4" />
                {locale === 'bn' ? 'দেখুন' : 'View'}
              </Button>
            </CardContent>
          </Card>
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
            {data.recentTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {locale === 'bn' ? 'কোন লেনদেন পাওয়া যায়নি' : 'No transactions found'}
              </div>
            ) : (
              data.recentTransactions.map((tx) => (
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
                      {formatCurrency(tx.amount, locale)}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(tx.date, locale)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
