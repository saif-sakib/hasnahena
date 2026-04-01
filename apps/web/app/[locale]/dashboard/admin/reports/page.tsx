'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';

type ReportType = 'financial' | 'members' | 'loans' | 'donations';
type Period = 'month' | 'quarter' | 'year' | 'all';

export default function AdminReportsPage() {
  const locale = useLocale();
  const [activeReport, setActiveReport] = useState<ReportType>('financial');
  const [period, setPeriod] = useState<Period>('month');

  // Mock data
  const financialSummary = [
    { title: locale === 'bn' ? 'মোট আমানত' : 'Total Deposits', value: '৳ 25,00,000', change: 12.5 },
    { title: locale === 'bn' ? 'মোট ঋণ বিতরণ' : 'Total Loans', value: '৳ 18,00,000', change: 8.3 },
    { title: locale === 'bn' ? 'পুনরুদ্ধার' : 'Recovery', value: '৳ 5,50,000', change: 15.2 },
    { title: locale === 'bn' ? 'দান তহবিল' : 'Donations', value: '৳ 12,75,000', change: 5.8 },
  ];

  const memberStats = { total: 125, newThisMonth: 8, active: 118, pending: 3 };
  const loanStats = { active: 45, completed: 5, applications: 12, defaulted: 2, recovery: 98.5 };
  const donationStats = { received: 500000, disbursed: 350000, zakat: 150000, sadaqah: 75000 };

  const monthlyData = [
    { month: locale === 'bn' ? 'জানু' : 'Jan', deposits: 150000, loans: 120000, recovery: 45000 },
    { month: locale === 'bn' ? 'ফেব্রু' : 'Feb', deposits: 180000, loans: 150000, recovery: 52000 },
    { month: locale === 'bn' ? 'মার্চ' : 'Mar', deposits: 200000, loans: 180000, recovery: 58000 },
    { month: locale === 'bn' ? 'এপ্রি' : 'Apr', deposits: 175000, loans: 140000, recovery: 48000 },
    { month: locale === 'bn' ? 'মে' : 'May', deposits: 220000, loans: 200000, recovery: 65000 },
    { month: locale === 'bn' ? 'জুন' : 'Jun', deposits: 250000, loans: 180000, recovery: 55000 },
  ];

  const tabs: { key: ReportType; label: string }[] = [
    { key: 'financial', label: locale === 'bn' ? 'আর্থিক' : 'Financial' },
    { key: 'members', label: locale === 'bn' ? 'সদস্য' : 'Members' },
    { key: 'loans', label: locale === 'bn' ? 'ঋণ' : 'Loans' },
    { key: 'donations', label: locale === 'bn' ? 'দান' : 'Donations' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'রিপোর্ট ও বিশ্লেষণ' : 'Reports & Analytics'}</h1>
          <p className="text-sm text-gray-500">{locale === 'bn' ? 'আর্থিক বিশ্লেষণ' : 'Financial analysis'}</p>
        </div>
        <div className="flex gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-8 px-3 text-sm border border-gray-200 focus:outline-none focus:border-blue-500">
            <option value="month">{locale === 'bn' ? 'এই মাস' : 'This Month'}</option>
            <option value="quarter">{locale === 'bn' ? 'এই কোয়ার্টার' : 'This Quarter'}</option>
            <option value="year">{locale === 'bn' ? 'এই বছর' : 'This Year'}</option>
            <option value="all">{locale === 'bn' ? 'সর্বকালীন' : 'All Time'}</option>
          </select>
          <Button variant="outline" size="sm" className="h-8"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveReport(tab.key)} className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeReport === tab.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Financial Report */}
      {activeReport === 'financial' && (
        <div className="space-y-4">
          {/* Stats Row */}
          <div className="flex flex-wrap gap-6 text-sm">
            {financialSummary.map((item, i) => (
              <div key={i}>
                <span className="text-gray-500">{item.title}:</span>{' '}
                <span className="font-semibold">{item.value}</span>{' '}
                <span className={`text-xs ${item.change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {item.change > 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                  {item.change > 0 ? '+' : ''}{item.change}%
                </span>
              </div>
            ))}
          </div>

          {/* Monthly Trend Table */}
          <div className="border border-gray-200 bg-white">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">{locale === 'bn' ? 'মাসিক প্রবণতা' : 'Monthly Trend'}</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'মাস' : 'Month'}</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'জমা' : 'Deposits'}</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'ঋণ' : 'Loans'}</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পুনরুদ্ধার' : 'Recovery'}</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{row.month}</td>
                    <td className="px-4 py-2 text-right text-green-600">{formatCurrency(row.deposits, locale)}</td>
                    <td className="px-4 py-2 text-right text-blue-600">{formatCurrency(row.loans, locale)}</td>
                    <td className="px-4 py-2 text-right text-amber-600">{formatCurrency(row.recovery, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Members Report */}
      {activeReport === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-gray-500">{locale === 'bn' ? 'মোট সদস্য:' : 'Total:'}</span> <span className="font-semibold">{memberStats.total}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'নতুন:' : 'New:'}</span> <span className="font-semibold text-green-600">+{memberStats.newThisMonth}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span> <span className="font-semibold">{memberStats.active}</span> <span className="text-xs text-gray-500">({((memberStats.active / memberStats.total) * 100).toFixed(0)}%)</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'অপেক্ষমাণ:' : 'Pending:'}</span> <span className="font-semibold text-amber-600">{memberStats.pending}</span></div>
          </div>
          <div className="border border-gray-200 bg-white p-6 text-center text-gray-400">
            <p className="text-sm">{locale === 'bn' ? 'সদস্য বৃদ্ধির চার্ট শীঘ্রই আসছে' : 'Member growth chart coming soon'}</p>
          </div>
        </div>
      )}

      {/* Loans Report */}
      {activeReport === 'loans' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span> <span className="font-semibold">{loanStats.active}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'সম্পন্ন:' : 'Completed:'}</span> <span className="font-semibold text-green-600">{loanStats.completed}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'আবেদন:' : 'Applications:'}</span> <span className="font-semibold text-blue-600">{loanStats.applications}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'খেলাপি:' : 'Defaulted:'}</span> <span className="font-semibold text-red-600">{loanStats.defaulted}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'পুনরুদ্ধার হার:' : 'Recovery:'}</span> <span className="font-semibold text-green-600">{loanStats.recovery}%</span></div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-gray-200 bg-white">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm">{locale === 'bn' ? 'উদ্দেশ্য অনুযায়ী' : 'By Purpose'}</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: locale === 'bn' ? 'ব্যবসা' : 'Business', pct: 45 },
                    { label: locale === 'bn' ? 'শিক্ষা' : 'Education', pct: 20 },
                    { label: locale === 'bn' ? 'চিকিৎসা' : 'Medical', pct: 15 },
                    { label: locale === 'bn' ? 'গৃহ নির্মাণ' : 'Housing', pct: 12 },
                    { label: locale === 'bn' ? 'অন্যান্য' : 'Others', pct: 8 },
                  ].map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right font-medium">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border border-gray-200 bg-white">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm">{locale === 'bn' ? 'পরিমাণ অনুযায়ী' : 'By Amount'}</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: '৳8,000 - ৳25,000', pct: 30 },
                    { label: '৳25,000 - ৳50,000', pct: 35 },
                    { label: '৳50,000 - ৳1,00,000', pct: 25 },
                    { label: '৳1,00,000+', pct: 10 },
                  ].map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right font-medium">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Donations Report */}
      {activeReport === 'donations' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-gray-500">{locale === 'bn' ? 'মোট প্রাপ্ত:' : 'Received:'}</span> <span className="font-semibold text-green-600">{formatCurrency(donationStats.received, locale)}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'বিতরণ:' : 'Disbursed:'}</span> <span className="font-semibold text-purple-600">{formatCurrency(donationStats.disbursed, locale)}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'যাকাত:' : 'Zakat:'}</span> <span className="font-semibold">{formatCurrency(donationStats.zakat, locale)}</span></div>
            <div><span className="text-gray-500">{locale === 'bn' ? 'সাদাকাহ:' : 'Sadaqah:'}</span> <span className="font-semibold">{formatCurrency(donationStats.sadaqah, locale)}</span></div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-gray-200 bg-white">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm">{locale === 'bn' ? 'তহবিল বণ্টন' : 'Fund Distribution'}</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: locale === 'bn' ? 'পরিচালনা' : 'Operating', pct: 40, color: 'bg-blue-500' },
                    { label: locale === 'bn' ? 'ঋণ' : 'Lending', pct: 30, color: 'bg-green-500' },
                    { label: locale === 'bn' ? 'যাকাত' : 'Zakat', pct: 20, color: 'bg-purple-500' },
                    { label: locale === 'bn' ? 'সাদাকাহ' : 'Sadaqah', pct: 10, color: 'bg-amber-500' },
                  ].map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-2 flex items-center gap-2"><span className={`w-2 h-2 rounded ${r.color}`} />{r.label}</td>
                      <td className="px-4 py-2 text-right font-medium">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border border-gray-200 bg-white">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm">{locale === 'bn' ? 'বিতরণ উদ্দেশ্য' : 'Disbursement'}</div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: locale === 'bn' ? 'ঋণ নিষ্পত্তি' : 'Loan Settlement', pct: 35 },
                    { label: locale === 'bn' ? 'অফিস পরিচালনা' : 'Operations', pct: 25 },
                    { label: locale === 'bn' ? 'জরুরি সহায়তা' : 'Emergency', pct: 20 },
                    { label: locale === 'bn' ? 'অন্যান্য' : 'Others', pct: 20 },
                  ].map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right font-medium">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
