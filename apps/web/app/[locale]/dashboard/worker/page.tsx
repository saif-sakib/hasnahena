'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Users, HandCoins, ArrowUpRight, Wallet, Receipt, ArrowRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';

export default function WorkerDashboard() {
  const locale = useLocale();

  const [stats, setStats] = useState({
    totalMembers: 0,
    todayDeposits: 0,
    todayWithdrawals: 0,
    todayLoans: 0,
  });

  useEffect(() => {
    const loadWorkerDashboard = async () => {
      try {
        const data = await apiGet<{
          stats: {
            totalMembers: number;
            todayDeposits: number;
            todayWithdrawals: number;
            todayLoans: number;
          };
        }>('/v1/dashboard/worker');
        setStats({
          totalMembers: data.stats.totalMembers || 0,
          todayDeposits: data.stats.todayDeposits || 0,
          todayWithdrawals: data.stats.todayWithdrawals || 0,
          todayLoans: data.stats.todayLoans || 0,
        });
      } catch {
        // Keep default values
      }
    };
    loadWorkerDashboard();
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
          {locale === 'bn' ? 'কর্মী ড্যাশবোর্ড' : 'Worker Dashboard'}
        </h1>
        <p className="text-sm text-neutral-500">
          {locale === 'bn' ? 'আজকের সারসংক্ষেপ' : "Today's summary"}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-[14px] font-medium tracking-wide">{locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}</span>
            <Users className="h-4 w-4" />
          </div>
          <span className="text-3xl font-bold text-neutral-900 tracking-tight">{stats.totalMembers}</span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-[14px] font-medium tracking-wide">{locale === 'bn' ? 'আজকের জমা' : "Today's Deposits"}</span>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </div>
          <span className="text-3xl font-bold text-emerald-600 tracking-tight">
            {formatCurrency(stats.todayDeposits, locale)}
          </span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-[14px] font-medium tracking-wide">{locale === 'bn' ? 'আজকের উত্তোলন' : "Today's Withdrawals"}</span>
            <ArrowUpRight className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-3xl font-bold text-blue-600 tracking-tight">
            {formatCurrency(stats.todayWithdrawals, locale)}
          </span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/50 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-[14px] font-medium tracking-wide">{locale === 'bn' ? 'আজকের ঋণ' : "Today's Loans"}</span>
            <HandCoins className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-3xl font-bold text-amber-600 tracking-tight">
            {formatCurrency(stats.todayLoans, locale)}
          </span>
        </div>
      </div>

      {/* Action Center */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {locale === 'bn' ? 'আজকের কাজ' : 'Action Center'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href={`/${locale}/dashboard/worker/approvals`} className="group rounded-2xl border p-4 transition-all hover:shadow-md text-amber-700 bg-amber-50 border-amber-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{locale === 'bn' ? 'অনুমোদন কিউ' : 'Approval Queue'}</p>
                <p className="mt-1 text-xs text-neutral-600">{locale === 'bn' ? 'ডিপোজিট ও ঋণ পরিশোধ অনুরোধ' : 'Deposit and repayment requests'}</p>
              </div>
              <ClipboardList className="h-5 w-5 opacity-80" />
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
              {locale === 'bn' ? 'খুলুন' : 'Open'}
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>

          <Link href={`/${locale}/dashboard/worker/members`} className="group rounded-2xl border p-4 transition-all hover:shadow-md text-blue-700 bg-blue-50 border-blue-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{locale === 'bn' ? 'সদস্য ব্যবস্থাপনা' : 'Member Management'}</p>
                <p className="mt-1 text-xs text-neutral-600">{locale === 'bn' ? 'প্রোফাইল ও তথ্য হালনাগাদ' : 'Profiles and account details'}</p>
              </div>
              <Users className="h-5 w-5 opacity-80" />
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
              {locale === 'bn' ? 'খুলুন' : 'Open'}
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>

          <Link href={`/${locale}/dashboard/worker/deposits`} className="group rounded-2xl border p-4 transition-all hover:shadow-md text-emerald-700 bg-emerald-50 border-emerald-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{locale === 'bn' ? 'জমা ও উত্তোলন' : 'Deposits & Withdrawals'}</p>
                <p className="mt-1 text-xs text-neutral-600">{locale === 'bn' ? 'দৈনিক ক্যাশ লেনদেন' : 'Daily cash transactions'}</p>
              </div>
              <Wallet className="h-5 w-5 opacity-80" />
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
              {locale === 'bn' ? 'খুলুন' : 'Open'}
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>

          <Link href={`/${locale}/dashboard/worker/loans`} className="group rounded-2xl border p-4 transition-all hover:shadow-md text-indigo-700 bg-indigo-50 border-indigo-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{locale === 'bn' ? 'ঋণ পর্যবেক্ষণ' : 'Loan Monitoring'}</p>
                <p className="mt-1 text-xs text-neutral-600">{locale === 'bn' ? 'কিস্তি ও বাকি দেখুন' : 'Track repayments and balances'}</p>
              </div>
              <HandCoins className="h-5 w-5 opacity-80" />
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
              {locale === 'bn' ? 'খুলুন' : 'Open'}
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>

          <Link href={`/${locale}/dashboard/worker/transactions`} className="group rounded-2xl border p-4 transition-all hover:shadow-md text-purple-700 bg-purple-50 border-purple-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{locale === 'bn' ? 'লেনদেন ইতিহাস' : 'Transaction History'}</p>
                <p className="mt-1 text-xs text-neutral-600">{locale === 'bn' ? 'প্রক্রিয়াকৃত লেনদেন ট্র্যাকিং' : 'Processed transaction tracking'}</p>
              </div>
              <Receipt className="h-5 w-5 opacity-80" />
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
              {locale === 'bn' ? 'খুলুন' : 'Open'}
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
