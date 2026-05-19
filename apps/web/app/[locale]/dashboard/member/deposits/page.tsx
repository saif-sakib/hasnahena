'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  ArrowUpRight,
  Download,
  Printer,
  PlusCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { generateStatementHTML, openPrintWindow, generateReceiptHTML } from '@/lib/documents/receipt-generator';

type DepositStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';

interface Deposit {
  id: string;
  amount: number;
  date: string;
  receiptNumber: string;
  status: DepositStatus;
  processedBy?: string;
  balanceAfter?: number;
  notes?: string;
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
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isRequestSubmitting, setIsRequestSubmitting] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const [requestNotes, setRequestNotes] = useState('');

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

  const totalDeposited = useMemo(
    () => deposits
      .filter((d) => d.status === 'PROCESSED' || d.status === 'CONFIRMED')
      .reduce((sum, d) => sum + d.amount, 0),
    [deposits],
  );

  const pendingRequests = useMemo(
    () => deposits.filter((d) => d.status === 'PENDING').length,
    [deposits],
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: DepositStatus) => {
    const styles: Record<DepositStatus, string> = {
      PENDING: 'bg-amber-100 text-amber-700',
      PROCESSED: 'bg-blue-100 text-blue-700',
      CONFIRMED: 'bg-green-100 text-green-700',
      DISPUTED: 'bg-orange-100 text-orange-700',
      REJECTED: 'bg-red-100 text-red-700',
    };
    const labels: Record<DepositStatus, { bn: string; en: string }> = {
      PENDING: { bn: 'অপেক্ষমাণ', en: 'Pending' },
      PROCESSED: { bn: 'প্রক্রিয়াধীন', en: 'Processed' },
      CONFIRMED: { bn: 'নিশ্চিত', en: 'Confirmed' },
      DISPUTED: { bn: 'বিতর্কিত', en: 'Disputed' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected' },
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
        {locale === 'bn' ? labels[status].bn : labels[status].en}
      </span>
    );
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
      closingBalance: currentBalance,
      totalDeposits: totalDeposited,
      totalWithdrawals: 0,
      transactions: deposits.map(d => ({
        date: d.date,
        type: 'DEPOSIT',
        amount: d.amount,
        balance: (d.balanceAfter || 0),
        description: d.notes || (locale === 'bn' ? 'আমানত' : 'Deposit'),
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
      amount: deposit.amount,
      date: deposit.date,
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      balanceAfter: (deposit.balanceAfter || 0),
      processedBy: deposit.processedBy,
      notes: deposit.notes,
    }, locale);
    openPrintWindow(receiptHtml, locale === 'bn' ? 'রসিদ' : 'Receipt');
  };

  const handleSubmitDepositRequest = async () => {
    setActionError(null);
    setActionSuccess(null);

    const amountValue = Number.parseFloat(requestAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ লিখুন' : 'Enter a valid amount');
      return;
    }
    if (!requestReference.trim()) {
      setActionError(locale === 'bn' ? 'bKash রেফারেন্স দিন' : 'Enter your bKash reference');
      return;
    }

    try {
      setIsRequestSubmitting(true);
      await apiPost('/v1/dashboard/member/requests/deposit', {
        amount: Math.round(amountValue * 100),
        bkashReference: requestReference.trim(),
        notes: requestNotes.trim(),
      });
      setRequestAmount('');
      setRequestReference('');
      setRequestNotes('');
      setActionSuccess(
        locale === 'bn'
          ? 'ডিপোজিট অনুরোধ জমা হয়েছে। অনুমোদনের পর ব্যালেন্সে যুক্ত হবে।'
          : 'Deposit request submitted. It will be added after approval.',
      );
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? (locale === 'bn' ? 'অনুরোধ জমা দেওয়া যায়নি' : 'Failed to submit request'));
    } finally {
      setIsRequestSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionSuccess}
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

      {/* Deposit Request */}
      <div className="border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold">
            {locale === 'bn' ? 'নতুন ডিপোজিট অনুরোধ' : 'New Deposit Request'}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {locale === 'bn'
              ? 'bKash-এ টাকা পাঠানোর পর এখানে পরিমাণ ও রেফারেন্স দিন।'
              : 'After sending money via bKash, submit amount and reference here.'}
          </p>
        </div>
        <div className="p-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              placeholder="0.00"
              value={requestAmount}
              onChange={(e) => setRequestAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{locale === 'bn' ? 'bKash রেফারেন্স' : 'bKash Reference'}</Label>
            <Input
              placeholder={locale === 'bn' ? 'লেনদেন রেফারেন্স নম্বর' : 'Transaction reference number'}
              value={requestReference}
              onChange={(e) => setRequestReference(e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
            <Textarea
              placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional details...'}
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
            />
          </div>
          <div className="md:col-span-3 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {pendingRequests > 0
                ? locale === 'bn'
                  ? `${pendingRequests} টি অনুরোধ অপেক্ষমাণ`
                  : `${pendingRequests} request(s) pending`
                : locale === 'bn'
                  ? 'কোনো অপেক্ষমাণ ডিপোজিট অনুরোধ নেই'
                  : 'No pending deposit requests'}
            </p>
            <Button onClick={handleSubmitDepositRequest} disabled={isRequestSubmitting} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              {isRequestSubmitting
                ? (locale === 'bn' ? 'জমা হচ্ছে...' : 'Submitting...')
                : (locale === 'bn' ? 'অনুরোধ পাঠান' : 'Submit Request')}
            </Button>
          </div>
        </div>
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
                  {locale === 'bn' ? 'রেফারেন্স/রসিদ' : 'Reference/Receipt'}
                </th>
                <th className="text-left py-2 px-4 font-medium text-gray-600">
                  {locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}
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
              {deposits.map((deposit) => {
                const canPrint = deposit.status === 'PROCESSED' || deposit.status === 'CONFIRMED';
                return (
                  <tr key={deposit.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600">{formatDate(deposit.date)}</td>
                    <td className="py-3 px-4 text-gray-600">{deposit.receiptNumber || '-'}</td>
                    <td className="py-3 px-4">{getStatusBadge(deposit.status)}</td>
                    <td className="py-3 px-4 text-right font-medium text-green-600">
                      +{formatCurrency(deposit.amount, locale)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {deposit.balanceAfter !== undefined ? formatCurrency(deposit.balanceAfter, locale) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canPrint ? (
                        <button
                          onClick={() => handlePrintReceipt(deposit)}
                          className="text-gray-400 hover:text-gray-600"
                          title={locale === 'bn' ? 'রসিদ প্রিন্ট' : 'Print receipt'}
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
