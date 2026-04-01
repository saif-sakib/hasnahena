'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Users, HandCoins, ArrowUpRight, Wallet, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';

export default function WorkerDashboard() {
  const t = useTranslations('dashboard');
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
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {locale === 'bn' ? 'কর্মী ড্যাশবোর্ড' : 'Worker Dashboard'}
        </h1>
        <p className="text-sm text-neutral-500">
          {locale === 'bn' ? 'আজকের সারসংক্ষেপ' : "Today's summary"}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-neutral-300/80 transition-colors shadow-sm shadow-neutral-100/50">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-sm font-medium">{locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}</span>
            <Users className="h-4 w-4" />
          </div>
          <span className="text-2xl font-semibold text-neutral-900 tracking-tight">{stats.totalMembers}</span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-neutral-300/80 transition-colors shadow-sm shadow-neutral-100/50">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-sm font-medium">{locale === 'bn' ? 'আজকের জমা' : "Today's Deposits"}</span>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-semibold text-emerald-600 tracking-tight">
            {formatCurrency(stats.todayDeposits, locale)}
          </span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-neutral-300/80 transition-colors shadow-sm shadow-neutral-100/50">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-sm font-medium">{locale === 'bn' ? 'আজকের উত্তোলন' : "Today's Withdrawals"}</span>
            <ArrowUpRight className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-2xl font-semibold text-blue-600 tracking-tight">
            {formatCurrency(stats.todayWithdrawals, locale)}
          </span>
        </div>

        <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-neutral-300/80 transition-colors shadow-sm shadow-neutral-100/50">
          <div className="flex items-center justify-between mb-3 text-neutral-500">
            <span className="text-sm font-medium">{locale === 'bn' ? 'আজকের ঋণ' : "Today's Loans"}</span>
            <HandCoins className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-2xl font-semibold text-amber-600 tracking-tight">
            {formatCurrency(stats.todayLoans, locale)}
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <h2 className="text-base font-semibold text-neutral-900 mt-8 mb-4">
        {locale === 'bn' ? 'দ্রুত নেভিগেশন' : 'Quick Actions'}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={`/${locale}/dashboard/worker/deposits`} className="group">
          <div className="flex flex-col gap-4 p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-emerald-300/60 hover:bg-emerald-50/30 transition-all shadow-sm shadow-neutral-100/50 hover:shadow-emerald-100/50">
            <div className="h-10 w-10 bg-emerald-100/80 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
              <Plus className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-neutral-900">{locale === 'bn' ? 'জমা/উত্তোলন' : 'Deposit / Withdrawal'}</p>
              <p className="text-xs text-neutral-500">{locale === 'bn' ? 'নতুন লেনদেন করুন' : 'Record new transaction'}</p>
            </div>
          </div>
        </Link>
        
        <Link href={`/${locale}/dashboard/worker/members`} className="group">
          <div className="flex flex-col gap-4 p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-blue-300/60 hover:bg-blue-50/30 transition-all shadow-sm shadow-neutral-100/50 hover:shadow-blue-100/50">
            <div className="h-10 w-10 bg-blue-100/80 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-neutral-900">{locale === 'bn' ? 'সদস্য তালিকা' : 'Members'}</p>
              <p className="text-xs text-neutral-500">{locale === 'bn' ? 'সদস্যদের বিবরণ দেখুন' : 'View member details'}</p>
            </div>
          </div>
        </Link>
        
        <Link href={`/${locale}/dashboard/worker/loans`} className="group">
          <div className="flex flex-col gap-4 p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-amber-300/60 hover:bg-amber-50/30 transition-all shadow-sm shadow-neutral-100/50 hover:shadow-amber-100/50">
            <div className="h-10 w-10 bg-amber-100/80 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
              <HandCoins className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-neutral-900">{locale === 'bn' ? 'ঋণ' : 'Loans'}</p>
              <p className="text-xs text-neutral-500">{locale === 'bn' ? 'ঋণ এবং কিস্তি পরিচালনা' : 'Manage loans & rules'}</p>
            </div>
          </div>
        </Link>
        
        <Link href={`/${locale}/dashboard/worker/transactions`} className="group">
          <div className="flex flex-col gap-4 p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-purple-300/60 hover:bg-purple-50/30 transition-all shadow-sm shadow-neutral-100/50 hover:shadow-purple-100/50">
            <div className="h-10 w-10 bg-purple-100/80 rounded-full flex items-center justify-center group-hover:scale-105 transition-transform">
              <Wallet className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-neutral-900">{locale === 'bn' ? 'লেনদেন' : 'Transactions'}</p>
              <p className="text-xs text-neutral-500">{locale === 'bn' ? 'সকল লেনদেন পর্যালোচনা' : 'Review all transactions'}</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
