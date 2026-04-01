'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Users, Wallet, HandCoins, TrendingUp, AlertTriangle, PieChart, Activity } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export default function AdminDashboard() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const [stats, setStats] = useState({
    totalMembers: 0,
    totalWorkers: 0,
    totalDeposits: 0,
    totalLoans: 0,
    activeLoanCount: 0,
    defaultedLoans: 0,
    charityFund: 0,
    monthlyGrowth: 0,
  });

  const [recentActivity, setRecentActivity] = useState<
    Array<{ id: number; action: string; user: string; actorName?: string; entityType?: string; time: string }>
  >([]);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAdminDashboard = async () => {
      try {
        const data = await apiGet<{
          stats: typeof stats;
          recentActivity: typeof recentActivity;
        }>('/v1/dashboard/admin');
        setStats(data.stats);
        setRecentActivity(data.recentActivity || []);
      } catch {
        setRecentActivity([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadAdminDashboard();
  }, []);

  const StatCard = ({ title, value, subValue, icon: Icon, trend, alert = false }: any) => (
    <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-xl hover:border-neutral-300/80 transition-colors shadow-sm shadow-neutral-100/50">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-neutral-500">{title}</span>
        <div className={`p-2 rounded-lg ${alert ? 'bg-red-50 text-red-600' : 'bg-neutral-50 text-neutral-600'}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div>
        <h3 className="text-2xl font-semibold text-neutral-900 tracking-tight">{value}</h3>
        {subValue && (
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${trend === 'up' ? 'bg-emerald-50 text-emerald-600' : trend === 'down' ? 'bg-red-50 text-red-600' : 'bg-neutral-100 text-neutral-600'}`}>
              {subValue}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-8 animate-in fade-in duration-500">
      {/* Page Title */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {locale === 'bn' ? 'ওভারভিউ' : 'Overview'}
        </h1>
        <p className="text-sm text-neutral-500">
          {locale === 'bn' ? 'আপনার প্রতিষ্ঠানের সামগ্রিক অবস্থা' : 'Your organization at a glance'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title={locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}
          value={isLoading ? '...' : stats.totalMembers}
          subValue={`+${stats.monthlyGrowth}% ${locale === 'bn' ? 'এই মাসে' : 'this month'}`}
          icon={Users}
          trend="up"
        />
        <StatCard
          title={locale === 'bn' ? 'মোট আমানত' : 'Total Deposits'}
          value={isLoading ? '...' : formatCurrency(stats.totalDeposits, locale)}
          icon={Wallet}
        />
        <StatCard
          title={locale === 'bn' ? 'বিতরণকৃত ঋণ' : 'Loans Disbursed'}
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
        <StatCard
          title={locale === 'bn' ? 'দান তহবিল' : 'Charity Fund'}
          value={isLoading ? '...' : formatCurrency(stats.charityFund, locale)}
          icon={PieChart}
        />
        <StatCard
          title={locale === 'bn' ? 'কর্মী সংখ্যা' : 'Active Workers'}
          value={isLoading ? '...' : stats.totalWorkers}
          icon={Activity}
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-neutral-200/60 rounded-xl shadow-sm shadow-neutral-100/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100">
          <h2 className="text-base font-medium text-neutral-900">
            {locale === 'bn' ? 'সাম্প্রতিক কার্যক্রম' : 'Recent Activity'}
          </h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-sm text-neutral-400">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : recentActivity.length > 0 ? (
            recentActivity.slice(0, 8).map((activity) => (
              <div key={activity.id} className="px-6 py-4 flex items-center justify-between hover:bg-neutral-50/50 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-neutral-900">{activity.action}</span>
                  <span className="text-xs text-neutral-500">{activity.user}</span>
                </div>
                <span className="text-xs font-medium text-neutral-400 bg-neutral-100 px-2.5 py-1 rounded-full">
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
            <div className="px-6 py-12 text-center text-sm text-neutral-400">
              {locale === 'bn' ? 'কোনো কার্যক্রম নেই' : 'No recent activity'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
