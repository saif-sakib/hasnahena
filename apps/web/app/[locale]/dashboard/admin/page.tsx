'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Users, Wallet, HandCoins, TrendingUp, AlertTriangle, PieChart } from 'lucide-react';
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

  useEffect(() => {
    const loadAdminDashboard = async () => {
      try {
        const data = await apiGet<{
          stats: typeof stats;
          recentActivity: Array<{
            id: number;
            action: string;
            user: string;
            actorName?: string;
            entityType?: string;
            time: string;
          }>;
        }>('/v1/dashboard/admin');
        setStats(data.stats);
        setRecentActivity(data.recentActivity || []);
      } catch {
        setRecentActivity([]);
      }
    };
    loadAdminDashboard();
  }, []);

  return (
    <div className="space-y-4">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {locale === 'bn' ? 'অ্যাডমিন ড্যাশবোর্ড' : 'Admin Dashboard'}
        </h1>
      </div>

      {/* Stats Grid - Simple table-like layout */}
      <div className="border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                {locale === 'bn' ? 'বিবরণ' : 'Metric'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                {locale === 'bn' ? 'মান' : 'Value'}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-400" />
                {locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}
              </td>
              <td className="px-4 py-3 text-right font-medium">
                {stats.totalMembers}
                <span className="ml-2 text-xs text-green-600">+{stats.monthlyGrowth}%</span>
              </td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-400" />
                {locale === 'bn' ? 'কর্মী সংখ্যা' : 'Workers'}
              </td>
              <td className="px-4 py-3 text-right font-medium">{stats.totalWorkers}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <Wallet className="h-4 w-4 text-green-500" />
                {locale === 'bn' ? 'মোট আমানত' : 'Total Deposits'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-green-600">
                {formatCurrency(stats.totalDeposits, locale)}
              </td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-blue-500" />
                {locale === 'bn' ? 'বিতরণকৃত ঋণ' : 'Loans Disbursed'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-blue-600">
                {formatCurrency(stats.totalLoans, locale)}
                <span className="ml-2 text-xs text-gray-500">({stats.activeLoanCount} {locale === 'bn' ? 'সক্রিয়' : 'active'})</span>
              </td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                {locale === 'bn' ? 'ঝুঁকিপূর্ণ ঋণ' : 'At Risk Loans'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-red-600">{stats.defaultedLoans}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-4 py-3 flex items-center gap-2">
                <PieChart className="h-4 w-4 text-amber-500" />
                {locale === 'bn' ? 'দান তহবিল' : 'Charity Fund'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-amber-600">
                {formatCurrency(stats.charityFund, locale)}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                {locale === 'bn' ? 'পুনরুদ্ধার হার' : 'Recovery Rate'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-green-600">98.5%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Recent Activity - Simple list */}
      <div className="border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-medium text-gray-700">
            {locale === 'bn' ? 'সাম্প্রতিক কার্যক্রম' : 'Recent Activity'}
          </h2>
        </div>
        <div className="divide-y divide-gray-100">
          {recentActivity.length > 0 ? (
            recentActivity.slice(0, 8).map((activity) => (
              <div key={activity.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-900">{activity.action}</span>
                  <span className="text-sm text-gray-500 ml-2">— {activity.user}</span>
                </div>
                <span className="text-xs text-gray-400">
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
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {locale === 'bn' ? 'কোনো কার্যক্রম নেই' : 'No recent activity'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
