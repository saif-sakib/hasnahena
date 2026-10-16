'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  Wallet,
  HandCoins,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { localePath } from '@/lib/locale-path';

interface DashboardStats {
  currentBalance: number;
  totalDeposited: number;
  loanBalance: number;
  loanEligibility: number;
}

interface ActiveLoanData {
  id: string;
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

/** The one place this screen's data comes from, so the effect and the retry
 *  button cannot drift apart. */
const fetchMemberDashboard = () => apiGet<MemberDashboardResponse>('/v1/dashboard/member');

export default function MemberDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  // 'loading' renders a placeholder, never a fabricated zero (TEST-26).
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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

  // Loader declared inside the effect — the shape that passes set-state-in-effect (WO-27).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchMemberDashboard();
        if (cancelled) return;
        setData(response);
        setStatus('ready');
      } catch {
        // Never fall back to zeros. "Your balance is 0" is the most alarming
        // thing this screen can say, and it is indistinguishable from the truth.
        if (!cancelled) setStatus('error');
      }
    };
    void load();
    // A member who navigates away mid-fetch must not have state written back
    // into an unmounted tree.
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = async () => {
    setStatus('loading');
    try {
      setData(await fetchMemberDashboard());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  /** A figure, or an em dash while unknown ("not loaded" ≠ "nothing"). */
  const amount = (value: number) =>
    status === 'ready' ? formatCurrency(value, locale) : '—';

  const transactionLabels: Record<string, { bn: string; en: string; color: string }> = {
    DEPOSIT: { bn: 'জমা', en: 'Deposit', color: 'text-green-600' },
    WITHDRAWAL: { bn: 'উত্তোলন', en: 'Withdrawal', color: 'text-red-600' },
    LOAN_DISBURSEMENT: { bn: 'ঋণ বিতরণ', en: 'Loan Disbursement', color: 'text-blue-600' },
    LOAN_REPAYMENT: { bn: 'কিস্তি পরিশোধ', en: 'Loan Repayment', color: 'text-amber-600' },
  };
  const isCreditTransaction = (type: string) => type === 'DEPOSIT' || type === 'LOAN_DISBURSEMENT';

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            {t('welcome')}, {locale === 'bn' ? 'সদস্য' : 'Member'}
          </h1>
          <p className="text-sm text-neutral-500">
            {locale === 'bn' ? 'আপনার অ্যাকাউন্টের সারসংক্ষেপ' : 'Your account summary'}
          </p>
        </div>
      </div>

      {/* A failed load says so, rather than showing four zeros. Announced in a
          live region so it reaches a screen reader too (TEST-30). */}
      {status === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm font-medium text-red-700">
            {locale === 'bn'
              ? 'আপনার হিসাব লোড করা যায়নি। এটি আপনার স্থিতি শূন্য বোঝায় না।'
              : 'Your account summary could not be loaded. This does not mean your balance is zero.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            {locale === 'bn' ? 'আবার চেষ্টা করুন' : 'Try again'}
          </Button>
        </div>
      )}

      {/* Account Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center gap-2 text-[14px] font-medium tracking-wide text-neutral-500 mb-3">
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <Wallet className="h-4 w-4" />
            </div>
            {t('currentBalance')}
          </div>
          <p className="text-2xl xl:text-3xl font-bold text-neutral-900 tracking-tight wrap-break-word leading-tight">
            {amount(data.stats.currentBalance)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {locale === 'bn' ? 'সঞ্চয় স্থিতি' : 'Savings Balance'}
          </p>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center gap-2 text-[14px] font-medium tracking-wide text-neutral-500 mb-3">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            {t('totalDeposited')}
          </div>
          <p className="text-2xl xl:text-3xl font-bold text-neutral-900 tracking-tight wrap-break-word leading-tight">
            {amount(data.stats.totalDeposited)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {locale === 'bn' ? 'মোট জমা' : 'Total deposits'}
          </p>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center gap-2 text-[14px] font-medium tracking-wide text-neutral-500 mb-3">
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <HandCoins className="h-4 w-4" />
            </div>
            {t('loanBalance')}
          </div>
          <p className="text-2xl xl:text-3xl font-bold text-neutral-900 tracking-tight wrap-break-word leading-tight">
            {amount(data.stats.loanBalance)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {locale === 'bn' ? 'ঋণ স্থিতি' : 'Outstanding loan'}
          </p>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center gap-2 text-[14px] font-medium tracking-wide text-neutral-500 mb-3">
            <div className="p-2 bg-neutral-100 rounded-lg text-neutral-600">
              <HandCoins className="h-4 w-4" />
            </div>
            {t('loanEligibility')}
          </div>
          <p className="text-2xl xl:text-3xl font-bold text-neutral-900 tracking-tight wrap-break-word leading-tight">
            {amount(data.stats.loanEligibility)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {locale === 'bn' ? 'সর্বোচ্চ ঋণ' : 'Max loan limit'}
          </p>
        </div>
      </div>

      {/* Active Loan - Compact & Elegant */}
      {data.activeLoan && (
        <div className="bg-white border border-emerald-200/60 rounded-xl shadow-xs shadow-emerald-100/30 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 bg-emerald-50/50 border-b border-emerald-100/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                <HandCoins className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-emerald-900 text-sm">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</span>
                <span className="text-xs text-emerald-600/80 font-medium">#{data.activeLoan.id}</span>
              </div>
            </div>
            <Link href={localePath(locale, '/dashboard/member/loans')}>
              <Button size="sm" variant="ghost" className="h-8 text-xs font-medium text-emerald-700 hover:bg-emerald-100/50 hover:text-emerald-800 gap-1 rounded-full">
                {locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 p-6">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'অবশিষ্ট' : 'Remaining'}</p>
              <p className="text-lg font-semibold text-neutral-900">{formatCurrency(data.activeLoan.remainingAmount, locale)}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'পরবর্তী কিস্তি' : 'Next Installment'}</p>
              <p className="text-lg font-semibold text-neutral-900">{formatCurrency(data.activeLoan.nextInstallment, locale)}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'নির্ধারিত তারিখ' : 'Due Date'}</p>
              <p className="text-[14px] font-medium tracking-wide text-neutral-900 flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                {formatDate(data.activeLoan.nextDueDate, locale)}
              </p>
            </div>
            <div className="flex flex-col gap-2 justify-center">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-neutral-500">{locale === 'bn' ? 'অগ্রগতি' : 'Progress'}</span>
                <span className="text-neutral-700">{data.activeLoan.paidInstallments}/{data.activeLoan.totalInstallments}</span>
              </div>
              <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${(data.activeLoan.paidInstallments / data.activeLoan.totalInstallments) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Links - Clean Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href={localePath(locale, '/dashboard/member/deposits')} className="group flex items-center gap-4 p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="h-10 w-10 min-w-[40px] bg-emerald-50 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
            <Wallet className="h-4.5 w-4.5 text-emerald-600" />
          </div>
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-neutral-900 group-hover:text-emerald-600 transition-colors">{locale === 'bn' ? 'আমানত' : 'Deposits'}</p>
            <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'ইতিহাস দেখুন' : 'View history'}</p>
          </div>
        </Link>
        <Link href={localePath(locale, '/dashboard/member/loans')} className="group flex items-center gap-4 p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="h-10 w-10 min-w-[40px] bg-amber-50 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
            <HandCoins className="h-4.5 w-4.5 text-amber-600" />
          </div>
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-neutral-900 group-hover:text-amber-600 transition-colors">{locale === 'bn' ? 'ঋণ' : 'Loans'}</p>
            <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'স্থিতি দেখুন' : 'View status'}</p>
          </div>
        </Link>
        <Link href={localePath(locale, '/dashboard/member/transactions')} className="group flex items-center gap-4 p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="h-10 w-10 min-w-[40px] bg-blue-50 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
            <ArrowUpRight className="h-4.5 w-4.5 text-blue-600" />
          </div>
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-neutral-900 group-hover:text-blue-600 transition-colors">{locale === 'bn' ? 'লেনদেন' : 'Transactions'}</p>
            <p className="text-xs font-medium text-neutral-500">{locale === 'bn' ? 'সব দেখুন' : 'View all'}</p>
          </div>
        </Link>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white border border-neutral-200/60 rounded-xl shadow-xs shadow-neutral-100/50 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
          <h2 className="text-base font-medium text-neutral-900">{t('recentTransactions')}</h2>
          <Link href={localePath(locale, '/dashboard/member/transactions')}>
            <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-neutral-500 hover:text-neutral-900 rounded-full px-3 gap-1">
              {t('viewAll')}
            </Button>
          </Link>
        </div>
        <div className="divide-y divide-neutral-100">
          {data.recentTransactions.length === 0 ? (
            <div className="text-center py-12 text-neutral-400 text-sm">
              {locale === 'bn' ? 'কোন লেনদেন পাওয়া যায়নি' : 'No transactions found'}
            </div>
          ) : (
            data.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-6 py-4 hover:bg-neutral-50/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                      isCreditTransaction(tx.type)
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {isCreditTransaction(tx.type) ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <p className="text-[14px] font-medium tracking-wide text-neutral-900">
                      {locale === 'bn'
                        ? transactionLabels[tx.type]?.bn ?? tx.type.replace(/_/g, ' ')
                        : transactionLabels[tx.type]?.en ?? tx.type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs font-medium text-neutral-400 mt-0.5">{tx.receipt}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end text-right">
                  <p className={`text-sm font-semibold tracking-tight ${isCreditTransaction(tx.type) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isCreditTransaction(tx.type) ? '+' : '-'}
                    {formatCurrency(tx.amount, locale)}
                  </p>
                  <p className="text-xs font-medium text-neutral-400 mt-0.5">{formatDate(tx.date, locale)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
