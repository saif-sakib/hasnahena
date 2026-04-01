'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  ArrowUpRight,
  Download,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { generateStatementHTML, openPrintWindow, generateReceiptHTML } from '@/lib/documents/receipt-generator';

type DepositStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';

interface Deposit {
  id: string;
  amount: number;
  date: string;
  receiptNumber: string;
  status: DepositStatus;
  processedBy?: string;
  balanceAfter?: number;
}

interface MemberProfile {
  name?: string;
  userId?: string;
  phone?: string;
  accountSummary?: {
    currentBalance?: number;
  };
}

export default function DepositsPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = localStorage.getItem('hn_access_token');
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const [depositsData, profileData] = await Promise.all([
        apiGet<{
          deposits: Deposit[];
          currentBalance: number;
        }>('/v1/dashboard/member/deposits'),
        apiGet<MemberProfile>('/v1/dashboard/member/profile'),
      ]);
      setDeposits(depositsData?.deposits ?? []);
      setMemberProfile(profileData);
      setCurrentBalance(profileData?.accountSummary?.currentBalance ?? depositsData?.currentBalance ?? 0);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const totalDeposited = deposits.reduce((sum, d) => sum + d.amount, 0);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDownloadStatement = () => {
    if (!memberProfile || deposits.length === 0) return;
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const statementHtml = generateStatementHTML({
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      periodStart: oneYearAgo.toISOString(),
      periodEnd: now.toISOString(),
      openingBalance: 0,
      closingBalance: currentBalance * 100,
      totalDeposits: totalDeposited * 100,
      totalWithdrawals: 0,
      transactions: deposits.map(d => ({
        date: d.date,
        type: 'DEPOSIT',
        amount: d.amount * 100,
        balance: (d.balanceAfter || 0) * 100,
        description: locale === 'bn' ? 'আমানত' : 'Deposit',
        receiptNumber: d.receiptNumber,
      })),
    }, locale);
    openPrintWindow(statementHtml, locale === 'bn' ? 'আমানত বিবরণী' : 'Deposit Statement');
  };

  const handlePrintReceipt = (deposit: Deposit) => {
    if (!memberProfile) return;
    const receiptHtml = generateReceiptHTML({
      receiptNumber: deposit.receiptNumber,
      type: 'DEPOSIT',
      amount: deposit.amount * 100,
      date: deposit.date,
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      balanceAfter: (deposit.balanceAfter || 0) * 100,
      processedBy: deposit.processedBy,
    }, locale);
    openPrintWindow(receiptHtml, locale === 'bn' ? 'রসিদ' : 'Receipt');
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('myDeposits')}</h1>
          <p className="text-sm text-gray-500">
            {locale === 'bn' ? 'আপনার আমানতের ইতিহাস' : 'Your deposit history'}
          </p>
        </div>
        {deposits.length > 0 && (
          <Button size="sm" variant="outline" onClick={handleDownloadStatement} className="h-8 gap-1">
            <Download className="h-4 w-4" />
            {locale === 'bn' ? 'বিবরণী' : 'Statement'}
          </Button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="border border-gray-200 bg-white">
        <div className="grid grid-cols-2 divide-x divide-gray-100">
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Wallet className="h-4 w-4" />
              {t('totalDeposited')}
            </div>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalDeposited, locale)}</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
              {t('currentBalance')}
            </div>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(currentBalance, locale)}</p>
          </div>
        </div>
      </div>

      {/* Deposits Table */}
      <div className="border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold">{t('depositHistory')}</h2>
        </div>
        {isLoading ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
          </div>
        ) : deposits.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {locale === 'bn' ? 'কোন আমানত পাওয়া যায়নি' : 'No deposits found'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/50">
              <tr>
                <th className="text-left py-2 px-4 font-medium text-gray-600">
                  {locale === 'bn' ? 'তারিখ' : 'Date'}
                </th>
                <th className="text-left py-2 px-4 font-medium text-gray-600">
                  {locale === 'bn' ? 'রসিদ' : 'Receipt'}
                </th>
                <th className="text-right py-2 px-4 font-medium text-gray-600">
                  {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
                </th>
                <th className="text-right py-2 px-4 font-medium text-gray-600">
                  {locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}
                </th>
                <th className="py-2 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-600">{formatDate(deposit.date)}</td>
                  <td className="py-3 px-4 text-gray-600">{deposit.receiptNumber}</td>
                  <td className="py-3 px-4 text-right font-medium text-green-600">
                    +{formatCurrency(deposit.amount, locale)}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">
                    {deposit.balanceAfter !== undefined ? formatCurrency(deposit.balanceAfter, locale) : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handlePrintReceipt(deposit)}
                      className="text-gray-400 hover:text-gray-600"
                      title={locale === 'bn' ? 'রসিদ প্রিন্ট' : 'Print receipt'}
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
