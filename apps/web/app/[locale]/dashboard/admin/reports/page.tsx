'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiAll } from '@/lib/use-api';
import { formatCurrency } from '@/lib/utils';

type ReportType = 'financial' | 'members' | 'loans' | 'donations';
type Period = 'month' | 'quarter' | 'year' | 'all';

type DepositType = 'DEPOSIT' | 'WITHDRAWAL';
type DepositStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
type LoanStatus = 'PENDING_GUARANTOR' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'DEFAULTED' | 'REJECTED';

type DashboardStats = {
  totalMembers: number;
  totalWorkers: number;
  totalDeposits: number;
  totalLoans: number;
  activeLoanCount: number;
  defaultedLoans: number;
  charityFund: number;
  monthlyGrowth: number;
};

type Member = {
  id: string;
  name: string;
  status: string;
  joinDate: string;
};

type Loan = {
  id: string;
  status: LoanStatus;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  disbursedDate?: string | null;
  approvedDate?: string | null;
  member: { name: string };
};

type Donation = {
  id: string;
  amount: number;
  donorName?: string;
  donorNameBn?: string;
  date: string;
  receipt?: string;
};

type Deposit = {
  id: string;
  type: DepositType;
  amount: number;
  status: DepositStatus;
  processedDate: string;
};

type YearlyReport = {
  year: number;
  summary: {
    totalDeposits: number;
    totalWithdrawals: number;
    loansDisbursed: number;
    loansRecovered: number;
    netSavings: number;
  };
  monthlyBreakdown: Array<{
    year: number;
    month: number;
    totalDeposits: number;
    totalWithdrawals: number;
    loansDisbursed: number;
    loansRecovered: number;
    netSavings: number;
  }>;
};

type LoanPerformanceReport = {
  totalLoans: number;
  avgLoanAmount: number;
  defaultedCount: number;
  completedCount: number;
  activeCount: number;
  defaultRate: number;
  recoveryRate: number;
  totalDisbursed: number;
  totalRecovered: number;
};

const CURRENT_YEAR = new Date().getFullYear();

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinPeriod(date: Date | null, period: Period): boolean {
  if (!date) return false;
  if (period === 'all') return true;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (period === 'month') {
    return date.getFullYear() === year && date.getMonth() === month;
  }

  if (period === 'quarter') {
    const quarterStart = month - 2;
    const quarterStartDate = new Date(year, quarterStart, 1);
    const quarterEndDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return date >= quarterStartDate && date <= quarterEndDate;
  }

  return date.getFullYear() === year;
}

function monthLabel(monthNumber: number, locale: string): string {
  return new Date(CURRENT_YEAR, Math.max(0, monthNumber - 1), 1).toLocaleDateString(
    locale === 'bn' ? 'bn-BD' : 'en-BD',
    { month: 'short' }
  );
}

export default function AdminReportsPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [activeReport, setActiveReport] = useState<ReportType>('financial');
  const [period, setPeriod] = useState<Period>('month');
  // WO-27 — seven endpoints as one resource, loaded by SWR rather than by an
  // effect that writes seven pieces of state. All-or-nothing is deliberate:
  // this screen cross-foots members against loans against deposits, and a
  // half-loaded report is a wrong report rather than an incomplete one.
  const {
    data: reportsData,
    error,
    isLoading,
    refresh: loadReportsData,
  } = useApiAll<
    [
      { stats: DashboardStats },
      Member[],
      Loan[],
      Donation[],
      { deposits: Deposit[] } | Deposit[],
      YearlyReport,
      LoanPerformanceReport,
    ]
  >([
    '/v1/dashboard/admin',
    '/v1/dashboard/admin/members',
    '/v1/dashboard/admin/loans',
    '/v1/dashboard/admin/donations',
    '/v1/dashboard/admin/deposits',
    `/v1/dashboard/admin/reports/yearly?year=${CURRENT_YEAR}`,
    '/v1/dashboard/admin/reports/loans',
  ]);

  const dashboardStats = useMemo<DashboardStats | null>(() => reportsData?.[0]?.stats ?? null, [reportsData]);
  const members = useMemo<Member[]>(() => reportsData?.[1] ?? [], [reportsData]);
  const loans = useMemo<Loan[]>(() => reportsData?.[2] ?? [], [reportsData]);
  const donations = useMemo<Donation[]>(() => reportsData?.[3] ?? [], [reportsData]);
  const deposits = useMemo<Deposit[]>(() => {
    const raw = reportsData?.[4];
    return Array.isArray(raw) ? raw : (raw?.deposits ?? []);
  }, [reportsData]);
  const yearlyReport = useMemo<YearlyReport | null>(() => reportsData?.[5] ?? null, [reportsData]);
  const loanPerformanceReport = useMemo<LoanPerformanceReport | null>(
    () => reportsData?.[6] ?? null,
    [reportsData],
  );

  const filteredMembers = useMemo(
    () => members.filter((m) => isWithinPeriod(parseDate(m.joinDate), period)),
    [members, period]
  );

  const filteredDeposits = useMemo(
    () => deposits.filter((d) => isWithinPeriod(parseDate(d.processedDate), period)),
    [deposits, period]
  );

  const filteredLoans = useMemo(
    () =>
      loans.filter((l) => {
        const loanDate = parseDate(l.disbursedDate || l.approvedDate || null);
        return isWithinPeriod(loanDate, period);
      }),
    [loans, period]
  );

  const filteredDonations = useMemo(
    () => donations.filter((d) => isWithinPeriod(parseDate(d.date), period)),
    [donations, period]
  );

  const financialSummary = useMemo(() => {
    const totalDeposits = filteredDeposits
      .filter((d) => d.type === 'DEPOSIT' && d.status === 'CONFIRMED')
      .reduce((sum, d) => sum + d.amount, 0);
    const totalWithdrawals = filteredDeposits
      .filter((d) => d.type === 'WITHDRAWAL' && d.status === 'CONFIRMED')
      .reduce((sum, d) => sum + d.amount, 0);
    const loansDisbursed = filteredLoans.reduce((sum, l) => sum + (l.amount || 0), 0);
    const loansRecovered = filteredLoans.reduce((sum, l) => sum + (l.paidAmount || 0), 0);

    return {
      totalDeposits,
      totalWithdrawals,
      loansDisbursed,
      loansRecovered,
      netSavings: totalDeposits - totalWithdrawals,
    };
  }, [filteredDeposits, filteredLoans]);

  const membersSummary = useMemo(() => {
    const total = members.length;
    const newThisPeriod = filteredMembers.length;
    const active = members.filter((m) => (m.status || '').toUpperCase() === 'ACTIVE').length;
    const pending = members.filter((m) => (m.status || '').toUpperCase() === 'PENDING').length;
    return { total, newThisPeriod, active, pending };
  }, [members, filteredMembers]);

  const loansSummary = useMemo(() => {
    const source = period === 'all' && loanPerformanceReport ? null : filteredLoans;

    if (!source && loanPerformanceReport) {
      return {
        total: loanPerformanceReport.totalLoans,
        active: loanPerformanceReport.activeCount,
        completed: loanPerformanceReport.completedCount,
        defaulted: loanPerformanceReport.defaultedCount,
        defaultRate: loanPerformanceReport.defaultRate,
        recoveryRate: loanPerformanceReport.recoveryRate,
        avgLoanAmount: (loanPerformanceReport.avgLoanAmount || 0),
      };
    }

    const list = source || [];
    const total = list.length;
    const active = list.filter((l) => l.status === 'ACTIVE').length;
    const completed = list.filter((l) => l.status === 'COMPLETED' || l.status === 'SETTLED').length;
    const defaulted = list.filter((l) => l.status === 'DEFAULTED').length;
    const disbursed = list.reduce((sum, l) => sum + (l.amount || 0), 0);
    const recovered = list.reduce((sum, l) => sum + (l.paidAmount || 0), 0);

    return {
      total,
      active,
      completed,
      defaulted,
      defaultRate: total > 0 ? Number(((defaulted / total) * 100).toFixed(1)) : 0,
      recoveryRate: disbursed > 0 ? Number(((recovered / disbursed) * 100).toFixed(1)) : 0,
      avgLoanAmount: total > 0 ? disbursed / total : 0,
    };
  }, [filteredLoans, loanPerformanceReport, period]);

  const donationsSummary = useMemo(() => {
    const received = filteredDonations.reduce((sum, d) => sum + (d.amount || 0), 0);
    const currentFund = dashboardStats?.charityFund || 0;

    const donorMap = new Map<string, number>();
    filteredDonations.forEach((d) => {
      const name = (locale === 'bn' ? d.donorNameBn : d.donorName) || d.donorName || d.donorNameBn || 'Unknown';
      donorMap.set(name, (donorMap.get(name) || 0) + (d.amount || 0));
    });

    const topDonors = [...donorMap.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return {
      received,
      currentFund,
      entries: filteredDonations.length,
      topDonors,
    };
  }, [dashboardStats?.charityFund, filteredDonations, locale]);

  const trendRows = useMemo(() => {
    const rows = (yearlyReport?.monthlyBreakdown || []).map((row) => ({
      month: row.month,
      deposits: (row.totalDeposits || 0),
      withdrawals: (row.totalWithdrawals || 0),
      loansDisbursed: (row.loansDisbursed || 0),
      loansRecovered: (row.loansRecovered || 0),
    }));

    if (period === 'month') {
      const currentMonth = new Date().getMonth() + 1;
      return rows.filter((r) => r.month === currentMonth);
    }

    if (period === 'quarter') {
      const currentMonth = new Date().getMonth() + 1;
      return rows.filter((r) => r.month >= Math.max(1, currentMonth - 2) && r.month <= currentMonth);
    }

    if (period === 'year') {
      const currentMonth = new Date().getMonth() + 1;
      return rows.filter((r) => r.month <= currentMonth);
    }

    return rows;
  }, [period, yearlyReport?.monthlyBreakdown]);

  const tabs: { key: ReportType; label: string }[] = [
    { key: 'financial', label: locale === 'bn' ? 'আর্থিক' : 'Financial' },
    { key: 'members', label: locale === 'bn' ? 'সদস্য' : 'Members' },
    { key: 'loans', label: locale === 'bn' ? 'ঋণ' : 'Loans' },
    { key: 'donations', label: locale === 'bn' ? 'দান' : 'Donations' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'রিপোর্ট ও বিশ্লেষণ' : 'Reports & Analytics'}</h1>
          <p className="text-sm text-gray-500">
            {locale === 'bn' ? 'ডাটাবেস ভিত্তিক রিয়েল টাইম সারাংশ' : 'Database-backed live operational summary'}
          </p>
        </div>
        <div className="flex gap-2">
          <select aria-label={tA11y('filterByPeriod')} value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-8 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500">
            <option value="month">{locale === 'bn' ? 'এই মাস' : 'This Month'}</option>
            <option value="quarter">{locale === 'bn' ? 'শেষ ৩ মাস' : 'Last 3 Months'}</option>
            <option value="year">{locale === 'bn' ? 'এই বছর' : 'This Year'}</option>
            <option value="all">{locale === 'bn' ? 'সর্বকালীন' : 'All Time'}</option>
          </select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => void loadReportsData()} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="sr-only">{tA11y('refresh')}</span>
          </Button>
        </div>
      </div>

      {error && <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{error}</div>}

      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveReport(tab.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeReport === tab.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {activeReport === 'financial' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'মোট জমা' : 'Total Deposits'}</span><span className="font-semibold text-green-600">{formatCurrency(financialSummary.totalDeposits, locale)}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'মোট উত্তোলন' : 'Total Withdrawals'}</span><span className="font-semibold text-purple-600">{formatCurrency(financialSummary.totalWithdrawals, locale)}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loans Disbursed'}</span><span className="font-semibold text-blue-600">{formatCurrency(financialSummary.loansDisbursed, locale)}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'নেট সেভিংস' : 'Net Savings'}</span><span className={`font-semibold ${financialSummary.netSavings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(financialSummary.netSavings, locale)}</span></div>
              </div>

              <div className="border border-gray-200 bg-white">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">{locale === 'bn' ? 'মাসিক প্রবণতা' : 'Monthly Trend'}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'মাস' : 'Month'}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'জমা' : 'Deposits'}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loans'}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'ঋণ পুনরুদ্ধার' : 'Recovery'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{locale === 'bn' ? 'কোনো ডাটা নেই' : 'No data available'}</td></tr>
                    ) : (
                      trendRows.map((row) => (
                        <tr key={row.month} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{monthLabel(row.month, locale)}</td>
                          <td className="px-4 py-2 text-right text-green-600">{formatCurrency(row.deposits, locale)}</td>
                          <td className="px-4 py-2 text-right text-purple-600">{formatCurrency(row.withdrawals, locale)}</td>
                          <td className="px-4 py-2 text-right text-blue-600">{formatCurrency(row.loansDisbursed, locale)}</td>
                          <td className="px-4 py-2 text-right text-amber-600">{formatCurrency(row.loansRecovered, locale)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeReport === 'members' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}</span><span className="font-semibold">{membersSummary.total}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'এই সময়ে নতুন' : 'New This Period'}</span><span className="font-semibold text-green-600">+{membersSummary.newThisPeriod}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</span><span className="font-semibold text-emerald-600">{membersSummary.active}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</span><span className="font-semibold text-amber-600">{membersSummary.pending}</span></div>
              </div>

              <div className="border border-gray-200 bg-white p-4 text-sm text-gray-600">
                {locale === 'bn'
                  ? `এই সময়ে সদস্য বৃদ্ধির হার: ${membersSummary.total > 0 ? ((membersSummary.newThisPeriod / membersSummary.total) * 100).toFixed(1) : '0.0'}%`
                  : `Member growth in selected period: ${membersSummary.total > 0 ? ((membersSummary.newThisPeriod / membersSummary.total) * 100).toFixed(1) : '0.0'}%`}
              </div>
            </div>
          )}

          {activeReport === 'loans' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'মোট ঋণ' : 'Total Loans'}</span><span className="font-semibold">{loansSummary.total}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</span><span className="font-semibold text-green-600">{loansSummary.active}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</span><span className="font-semibold text-blue-600">{loansSummary.completed}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</span><span className="font-semibold text-red-600">{loansSummary.defaulted}</span></div>
              </div>

              <div className="grid md:grid-cols-3 gap-3 text-sm">
                <div className="border border-gray-200 bg-white p-3">
                  <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'খেলাপি হার' : 'Default Rate'}</span>
                  <span className="font-semibold text-red-600 inline-flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5" />{loansSummary.defaultRate}%
                  </span>
                </div>
                <div className="border border-gray-200 bg-white p-3">
                  <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'পুনরুদ্ধার হার' : 'Recovery Rate'}</span>
                  <span className="font-semibold text-green-600 inline-flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" />{loansSummary.recoveryRate}%
                  </span>
                </div>
                <div className="border border-gray-200 bg-white p-3">
                  <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'গড় ঋণ পরিমাণ' : 'Average Loan Amount'}</span>
                  <span className="font-semibold text-blue-600">{formatCurrency(loansSummary.avgLoanAmount, locale)}</span>
                </div>
              </div>
            </div>
          )}

          {activeReport === 'donations' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'মোট প্রাপ্ত' : 'Received'}</span><span className="font-semibold text-green-600">{formatCurrency(donationsSummary.received, locale)}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'বর্তমান তহবিল' : 'Current Fund'}</span><span className="font-semibold text-purple-600">{formatCurrency(donationsSummary.currentFund, locale)}</span></div>
                <div className="border border-gray-200 bg-white p-3"><span className="text-gray-500 block">{locale === 'bn' ? 'এন্ট্রি' : 'Entries'}</span><span className="font-semibold">{donationsSummary.entries}</span></div>
              </div>

              <div className="border border-gray-200 bg-white">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-sm text-gray-700">{locale === 'bn' ? 'শীর্ষ দাতারা' : 'Top Donors'}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'দাতা' : 'Donor'}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donationsSummary.topDonors.length === 0 ? (
                      <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-500">{locale === 'bn' ? 'কোনো দাতা তথ্য নেই' : 'No donor data available'}</td></tr>
                    ) : (
                      donationsSummary.topDonors.map((donor) => (
                        <tr key={donor.name} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2">{donor.name}</td>
                          <td className="px-4 py-2 text-right text-green-600 font-medium">{formatCurrency(donor.amount, locale)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
