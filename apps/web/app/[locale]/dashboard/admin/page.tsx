'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Wallet,
  HandCoins,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  Receipt,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface DashboardStats {
  totalMembers: number;
  totalWorkers: number;
  totalDeposits: number;
  totalLoans: number;
  activeLoanCount: number;
  defaultedLoans: number;
  charityFund: number;
  monthlyGrowth: number;
}

interface ActivityItem {
  id: number;
  action: string;
  user: string;
  actorName?: string;
  entityType?: string;
  time: string;
}

interface ApprovalsSummary {
  registrationRequests?: Array<{ id: string }>;
  loanRequests?: Array<{ id: string }>;
  withdrawalRequests?: Array<{ id: string }>;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  alert?: boolean;
}

const initialStats: DashboardStats = {
  totalMembers: 0,
  totalWorkers: 0,
  totalDeposits: 0,
  totalLoans: 0,
  activeLoanCount: 0,
  defaultedLoans: 0,
  charityFund: 0,
  monthlyGrowth: 0,
};

export default function AdminDashboard() {
  const locale = useLocale();

  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [pending, setPending] = useState({
    registrations: 0,
    loans: 0,
    withdrawals: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAdminDashboard = async () => {
      try {
        const [dashboard, approvals] = await Promise.all([
          apiGet<{ stats: DashboardStats; recentActivity: ActivityItem[] }>('/v1/dashboard/admin'),
          apiGet<ApprovalsSummary>('/v1/dashboard/admin/approvals'),
        ]);

        setStats(dashboard.stats || initialStats);
        setRecentActivity(dashboard.recentActivity || []);
        setPending({
          registrations: approvals?.registrationRequests?.length ?? 0,
          loans: approvals?.loanRequests?.length ?? 0,
          withdrawals: approvals?.withdrawalRequests?.length ?? 0,
        });
      } catch {
        setStats(initialStats);
        setRecentActivity([]);
        setPending({ registrations: 0, loans: 0, withdrawals: 0 });
      } finally {
        setIsLoading(false);
      }
    };

    void loadAdminDashboard();
  }, []);

  const totalPending = useMemo(
    () => pending.registrations + pending.loans + pending.withdrawals,
    [pending.registrations, pending.loans, pending.withdrawals]
  );

  const actionCards = [
    {
      href: `/${locale}/dashboard/admin/approvals`,
      title: locale === 'bn' ? 'অনুমোদন কিউ' : 'Approval Queue',
      subtitle:
        totalPending > 0
          ? locale === 'bn'
            ? `${totalPending} টি কাজ অপেক্ষমাণ`
            : `${totalPending} pending actions`
          : locale === 'bn'
            ? 'অপেক্ষমাণ কাজ নেই'
            : 'No pending approvals',
      icon: ClipboardList,
      tone:
        totalPending > 0
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      href: `/${locale}/dashboard/admin/members`,
      title: locale === 'bn' ? 'সদস্য ব্যবস্থাপনা' : 'Member Management',
      subtitle: locale === 'bn' ? 'প্রোফাইল, স্ট্যাটাস, খোঁজ' : 'Profiles, status, lookup',
      icon: Users,
      tone: 'text-blue-700 bg-blue-50 border-blue-200',
    },
    {
      href: `/${locale}/dashboard/admin/deposits`,
      title: locale === 'bn' ? 'লেনদেন যাচাই' : 'Transaction Review',
      subtitle: locale === 'bn' ? 'জমা, উত্তোলন, ট্র্যাকিং' : 'Deposits, withdrawals, tracking',
      icon: Receipt,
      tone: 'text-purple-700 bg-purple-50 border-purple-200',
    },
    {
      href: `/${locale}/dashboard/admin/loans`,
      title: locale === 'bn' ? 'ঋণ নিয়ন্ত্রণ' : 'Loan Control',
      subtitle: locale === 'bn' ? 'সক্রিয় ঋণ ও ঝুঁকি পর্যবেক্ষণ' : 'Monitor active loans and risk',
      icon: HandCoins,
      tone: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    },
  ];

  const StatCard = ({ title, value, subValue, icon: Icon, trend = 'neutral', alert = false }: StatCardProps) => (
    <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-medium text-neutral-500 tracking-wide">{title}</span>
        <div className={`p-2.5 rounded-xl ${alert ? 'bg-red-500/10 text-red-600' : 'bg-neutral-100 text-neutral-700'}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </div>
      </div>
      <h3 className="text-2xl font-bold text-neutral-900 tracking-tight">{value}</h3>
      {subValue ? (
        <span
          className={`mt-2 inline-flex w-fit items-center rounded-md px-2.5 py-1 text-[12px] font-semibold ${
            trend === 'up'
              ? 'bg-emerald-500/10 text-emerald-700'
              : trend === 'down'
                ? 'bg-red-500/10 text-red-700'
                : 'bg-neutral-100 text-neutral-700'
          }`}
        >
          {subValue}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-7 pb-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {locale === 'bn' ? 'অ্যাডমিন কমান্ড সেন্টার' : 'Admin Command Center'}
        </h1>
        <p className="text-sm text-neutral-500">
          {locale === 'bn'
            ? 'মূল কাজগুলো দ্রুত সম্পন্ন করার জন্য সাজানো ড্যাশবোর্ড'
            : 'A streamlined dashboard to complete core tasks quickly'}
        </p>
      </div>

      <div className={`rounded-2xl border px-5 py-4 ${totalPending > 0 ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
        <div className="flex items-start gap-3">
          {totalPending > 0 ? (
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
          ) : (
            <ClipboardList className="mt-0.5 h-5 w-5 text-emerald-700" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-neutral-900">
              {totalPending > 0
                ? locale === 'bn'
                  ? 'অপেক্ষমাণ অনুমোদনের কাজ রয়েছে'
                  : 'You have pending approval tasks'
                : locale === 'bn'
                  ? 'অনুমোদন কিউ আপডেট আছে'
                  : 'Approval queue is up to date'}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {locale === 'bn'
                ? `রেজিস্ট্রেশন ${pending.registrations}, ঋণ ${pending.loans}, উত্তোলন ${pending.withdrawals}`
                : `Registrations ${pending.registrations}, loans ${pending.loans}, withdrawals ${pending.withdrawals}`}
            </p>
          </div>
          <Link
            href={`/${locale}/dashboard/admin/approvals`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {locale === 'bn' ? 'এখন দেখুন' : 'Open Queue'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {locale === 'bn' ? 'আজকের কাজ' : 'Action Center'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {actionCards.map((item) => (
            <Link key={item.href} href={item.href} className={`group rounded-2xl border p-4 transition-all hover:shadow-md ${item.tone}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-neutral-600">{item.subtitle}</p>
                </div>
                <item.icon className="h-5 w-5 opacity-80" />
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 group-hover:text-neutral-900">
                {locale === 'bn' ? 'খুলুন' : 'Open'}
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {locale === 'bn' ? 'মূল সূচক' : 'Operational Snapshot'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title={locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}
            value={isLoading ? '...' : stats.totalMembers}
            subValue={`+${stats.monthlyGrowth.toFixed(1)}% ${locale === 'bn' ? 'এই মাসে' : 'this month'}`}
            icon={Users}
            trend="up"
          />
          <StatCard
            title={locale === 'bn' ? 'মোট আমানত' : 'Total Deposits'}
            value={isLoading ? '...' : formatCurrency(stats.totalDeposits, locale)}
            icon={Wallet}
          />
          <StatCard
            title={locale === 'bn' ? 'ঋণ বিতরণ' : 'Loans Disbursed'}
            value={isLoading ? '...' : formatCurrency(stats.totalLoans, locale)}
            subValue={`${stats.activeLoanCount} ${locale === 'bn' ? 'সক্রিয় ঋণ' : 'active loans'}`}
            icon={HandCoins}
          />
          <StatCard
            title={locale === 'bn' ? 'ঝুঁকিপূর্ণ ঋণ' : 'At Risk Loans'}
            value={isLoading ? '...' : stats.defaultedLoans}
            icon={AlertTriangle}
            alert={stats.defaultedLoans > 0}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{locale === 'bn' ? 'কর্মী' : 'Workers'}</p>
            <p className="mt-1 text-xl font-semibold text-neutral-900">{isLoading ? '...' : stats.totalWorkers}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{locale === 'bn' ? 'দান তহবিল' : 'Charity Fund'}</p>
            <p className="mt-1 text-xl font-semibold text-neutral-900">{isLoading ? '...' : formatCurrency(stats.charityFund, locale)}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{locale === 'bn' ? 'মাসিক বৃদ্ধি' : 'Monthly Growth'}</p>
            <p className="mt-1 flex items-center gap-1 text-xl font-semibold text-emerald-700">
              <TrendingUp className="h-4 w-4" />
              {isLoading ? '...' : `${stats.monthlyGrowth.toFixed(1)}%`}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-neutral-200/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100/80">
          <h2 className="text-[15px] font-semibold text-neutral-900 tracking-wide">
            {locale === 'bn' ? 'সাম্প্রতিক কার্যক্রম' : 'Recent Activity'}
          </h2>
        </div>
        <div className="divide-y divide-neutral-100/60">
          {isLoading ? (
            <div className="px-6 py-9 text-center text-sm font-medium text-neutral-400">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : recentActivity.length > 0 ? (
            recentActivity.slice(0, 8).map((activity) => (
              <div key={activity.id} className="px-6 py-4 flex items-center justify-between hover:bg-neutral-50/50 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-neutral-900">{activity.action}</span>
                  <span className="text-xs text-neutral-500">{activity.user}</span>
                </div>
                <span className="text-[11px] font-semibold text-neutral-500 bg-neutral-100 px-2.5 py-1 rounded-md">
                  {new Date(activity.time).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))
          ) : (
            <div className="px-6 py-10 text-center text-sm font-medium text-neutral-400">
              {locale === 'bn' ? 'কোনো সাম্প্রতিক কার্যক্রম নেই' : 'No recent activity'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
