'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  HandCoins,
  AlertCircle,
  Calendar,
  X,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';
import { formatCurrency, getLoanRepaymentPresets } from '@/lib/utils';

type LoanStatus = 'PENDING_GUARANTOR' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'REJECTED';

interface Loan {
  id: string;
  loanNumber: string;
  principalAmount: number;
  remainingAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentAmount: number;
  disbursementDate?: string;
  nextDueDate?: string;
  purpose: string;
  status: LoanStatus;
  guarantor?: string;
}

interface MemberTransaction {
  id: string;
  type: string;
  status: string;
}

export default function LoansPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [currentDeposit, setCurrentDeposit] = useState(0);
  const [loanPolicy, setLoanPolicy] = useState({
    minDepositRequired: 8000,
    maxLoanMultiplier: 5,
  });
  const minDepositRequired = loanPolicy.minDepositRequired;
  const maxLoanMultiplier = loanPolicy.maxLoanMultiplier;
  const maxLoanAmount = currentDeposit * maxLoanMultiplier;
  const isEligible = currentDeposit >= minDepositRequired;
  const [activeLoan, setActiveLoan] = useState<Loan | null>(null);
  const [loanHistory, setLoanHistory] = useState<Loan[]>([]);
  const [selectedHistoryLoan, setSelectedHistoryLoan] = useState<Loan | null>(null);
  const [pendingRepaymentRequests, setPendingRepaymentRequests] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isRepaymentSubmitting, setIsRepaymentSubmitting] = useState(false);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentReference, setRepaymentReference] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');

  const refresh = async () => {
    const token = localStorage.getItem('hn_access_token');
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const [loanData, transactionData, settingsData] = await Promise.all([
        apiGet<{
          currentDeposit?: number;
          activeLoan?: Loan | null;
          loanHistory?: Loan[];
        }>('/v1/dashboard/member/loans'),
        apiGet<MemberTransaction[]>('/v1/dashboard/member/transactions'),
        fetch('/api/v1/settings', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null) as Promise<Record<string, unknown> | null>,
      ]);

      setCurrentDeposit(loanData?.currentDeposit ?? 0);
      setActiveLoan(loanData?.activeLoan ?? null);
      setLoanHistory(loanData?.loanHistory ?? []);
      setPendingRepaymentRequests(
        (transactionData ?? []).filter((item) =>
          item.type === 'LOAN_REPAYMENT' && item.status === 'PENDING',
        ).length,
      );
      setLoanPolicy((prev) => {
        const parsedMinDeposit = Number(settingsData?.['loan.minDepositForLoan']);
        const parsedMultiplier = Number(settingsData?.['loan.maxLoanMultiplier']);
        return {
          minDepositRequired:
            Number.isFinite(parsedMinDeposit) && parsedMinDeposit >= 0
              ? parsedMinDeposit
              : prev.minDepositRequired,
          maxLoanMultiplier:
            Number.isFinite(parsedMultiplier) && parsedMultiplier > 0
              ? parsedMultiplier
              : prev.maxLoanMultiplier,
        };
      });
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load loans');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusLabel = (status: LoanStatus) => {
    const labels: Record<LoanStatus, { bn: string; en: string; color: string }> = {
      PENDING_GUARANTOR: { bn: 'জামিনদার অপেক্ষমান', en: 'Awaiting Guarantor', color: 'bg-amber-100 text-amber-700' },
      PENDING_APPROVAL: { bn: 'অনুমোদন অপেক্ষমান', en: 'Pending Approval', color: 'bg-blue-100 text-blue-700' },
      APPROVED: { bn: 'অনুমোদিত', en: 'Approved', color: 'bg-green-100 text-green-700' },
      ACTIVE: { bn: 'সক্রিয়', en: 'Active', color: 'bg-emerald-100 text-emerald-700' },
      COMPLETED: { bn: 'সম্পন্ন', en: 'Completed', color: 'bg-gray-100 text-gray-700' },
      DEFAULTED: { bn: 'খেলাপি', en: 'Defaulted', color: 'bg-red-100 text-red-700' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected', color: 'bg-red-100 text-red-700' },
    };
    return labels[status];
  };

  const openLoanDetails = (loan: Loan) => {
    setSelectedHistoryLoan(loan);
    setRepaymentAmount('');
    setRepaymentReference('');
    setRepaymentNotes('');
  };

  const handleRepaymentRequest = async (loan: Loan) => {
    if (loan.status !== 'ACTIVE') {
      setActionError(locale === 'bn' ? 'সক্রিয় ঋণ পাওয়া যায়নি' : 'No active loan found');
      return;
    }

    const amountValue = Number.parseFloat(repaymentAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ লিখুন' : 'Enter a valid amount');
      return;
    }
    if (amountValue > loan.remainingAmount) {
      setActionError(
        locale === 'bn'
          ? `সর্বোচ্চ ${formatCurrency(loan.remainingAmount, locale)} পর্যন্ত অনুরোধ করা যাবে`
          : `You can request up to ${formatCurrency(loan.remainingAmount, locale)}`,
      );
      return;
    }
    if (!repaymentReference.trim()) {
      setActionError(locale === 'bn' ? 'bKash রেফারেন্স দিন' : 'Enter your bKash reference');
      return;
    }

    try {
      setIsRepaymentSubmitting(true);
      setActionError(null);
      setActionSuccess(null);
      await apiPost('/v1/dashboard/member/requests/loan-repayment', {
        loanId: loan.id,
        amount: Math.round(amountValue * 100),
        bkashReference: repaymentReference.trim(),
        notes: repaymentNotes.trim(),
      });
      setRepaymentAmount('');
      setRepaymentReference('');
      setRepaymentNotes('');
      setSelectedHistoryLoan(null);
      setActionSuccess(
        locale === 'bn'
          ? 'ঋণ পরিশোধ অনুরোধ জমা হয়েছে। অনুমোদনের পর ঋণের বাকি কমবে।'
          : 'Loan repayment request submitted. Remaining balance will update after approval.',
      );
      await refresh();
    } catch (e: any) {
      setActionError(e?.message ?? (locale === 'bn' ? 'অনুরোধ জমা দেওয়া যায়নি' : 'Failed to submit request'));
    } finally {
      setIsRepaymentSubmitting(false);
    }
  };

  const applyRepaymentPreset = (loan: Loan, preset: 'weekly' | 'monthly' | 'full') => {
    const presets = getLoanRepaymentPresets(loan.installmentAmount, loan.remainingAmount);
    setRepaymentAmount(presets[preset].toString());
  };

  const repaymentAmountValue = Number.parseFloat(repaymentAmount);
  const hasRepaymentAmount = Number.isFinite(repaymentAmountValue) && repaymentAmountValue > 0;
  const projectedRemaining = selectedHistoryLoan && hasRepaymentAmount
    ? Math.max(selectedHistoryLoan.remainingAmount - repaymentAmountValue, 0)
    : null;

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

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {t('myLoans')}
        </h1>
      </div>

      {/* Eligibility Info */}
      <div className="border border-gray-200 bg-white">
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {locale === 'bn' ? 'ঋণের যোগ্যতা' : 'Loan Eligibility'}
          </span>
          <span className={`text-xs px-2 py-0.5 ${isEligible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {isEligible
              ? locale === 'bn' ? 'যোগ্য' : 'Eligible'
              : locale === 'bn' ? 'অযোগ্য' : 'Not Eligible'}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'আপনার আমানত' : 'Your Deposit'}</p>
            <p className="text-sm font-semibold text-gray-900">{formatCurrency(currentDeposit, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'ন্যূনতম প্রয়োজন' : 'Min Required'}</p>
            <p className="text-sm font-semibold text-gray-900">{formatCurrency(minDepositRequired, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'সর্বোচ্চ ঋণ' : 'Max Loan'}</p>
            <p className="text-sm font-semibold text-green-600">{formatCurrency(maxLoanAmount, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'গুণক' : 'Multiplier'}</p>
            <p className="text-sm font-semibold text-gray-900">{maxLoanMultiplier}x</p>
          </div>
        </div>
        {!isEligible && (
          <div className="px-4 py-2 border-t border-gray-100 bg-amber-50 flex items-center gap-2 text-xs text-amber-800">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {locale === 'bn'
              ? `ঋণের জন্য আবেদন করতে আপনার আমানত কমপক্ষে ${formatCurrency(minDepositRequired, locale)} হতে হবে।`
              : `You need at least ${formatCurrency(minDepositRequired, locale)} in deposits to apply for a loan.`}
          </div>
        )}
      </div>

      {/* Active Loan */}
      {activeLoan && (
        <div className="border border-gray-200 bg-white">
          <div className="px-4 py-2 border-b border-gray-200 bg-emerald-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-800">
                {locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}: {activeLoan.loanNumber}
              </span>
            </div>
            <span className={`text-xs px-2 py-0.5 ${getStatusLabel(activeLoan.status).color}`}>
              {locale === 'bn' ? getStatusLabel(activeLoan.status).bn : getStatusLabel(activeLoan.status).en}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'মূল ঋণ' : 'Principal'}</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(activeLoan.principalAmount, locale)}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'বাকি' : 'Remaining'}</p>
              <p className="text-sm font-semibold text-amber-600">{formatCurrency(activeLoan.remainingAmount, locale)}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'কিস্তি' : 'Installments'}</p>
              <p className="text-sm font-semibold text-gray-900">
                {activeLoan.paidInstallments}/{activeLoan.totalInstallments}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'প্রতি কিস্তি' : 'Per Installment'}</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(activeLoan.installmentAmount, locale)}</p>
            </div>
          </div>

          <div className="px-4 py-4 border-b border-gray-100 bg-gray-50/30 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-600">
              {pendingRepaymentRequests > 0
                ? locale === 'bn'
                  ? `${pendingRepaymentRequests} টি ঋণ পরিশোধ অনুরোধ অপেক্ষমাণ`
                  : `${pendingRepaymentRequests} repayment request(s) pending`
                : locale === 'bn'
                  ? 'ঋণের বিস্তারিত খুলে ঋণ পরিশোধ অনুরোধ পাঠান'
                  : 'Open the loan details to submit a repayment request'}
            </p>
            <Button className="h-8 text-xs" onClick={() => openLoanDetails(activeLoan)}>
              {locale === 'bn' ? 'ঋণের বিস্তারিত দেখুন' : 'View Loan Details'}
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">{locale === 'bn' ? 'পরিশোধ অগ্রগতি' : 'Repayment Progress'}</span>
              <span className="font-medium">{Math.round((activeLoan.paidInstallments / activeLoan.totalInstallments) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full bg-gray-200">
              <div
                className="h-1.5 bg-emerald-500 transition-all"
                style={{ width: `${(activeLoan.paidInstallments / activeLoan.totalInstallments) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <div className="px-4 py-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">{locale === 'bn' ? 'পরবর্তী কিস্তি' : 'Next Due'}</p>
                <p className="text-sm font-medium">{activeLoan.nextDueDate ? formatDate(activeLoan.nextDueDate) : '-'}</p>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</p>
              <p className="text-sm font-medium truncate">{activeLoan.purpose}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">{locale === 'bn' ? 'জামিনদার' : 'Guarantor'}</p>
              <p className="text-sm font-medium">{activeLoan.guarantor || '-'}</p>
            </div>
          </div>
        </div>
      )}

      {/* No Active Loan */}
      {!activeLoan && !isLoading && (
        <div className="border border-gray-200 bg-white px-4 py-8 text-center">
          <HandCoins className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">
            {locale === 'bn' ? 'কোন সক্রিয় ঋণ নেই' : 'No active loan'}
          </p>
        </div>
      )}

      {/* Loan History */}
      {loanHistory.length > 0 && (
        <div className="border border-gray-200 bg-white">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <span className="text-sm font-medium text-gray-700">
              {locale === 'bn' ? 'ঋণের ইতিহাস' : 'Loan History'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === 'bn' ? 'ঋণ নম্বর' : 'Loan #'}
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                    {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
                  </th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600 hidden sm:table-cell">
                    {locale === 'bn' ? 'কিস্তি' : 'Installments'}
                  </th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600">
                    {locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loanHistory.map((loan) => {
                  const statusInfo = getStatusLabel(loan.status);
                  return (
                    <tr
                      key={loan.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => openLoanDetails(loan)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{loan.loanNumber}</p>
                        <p className="text-xs text-gray-500">
                          {loan.disbursementDate && formatDate(loan.disbursementDate)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(loan.principalAmount, locale)}
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        {loan.paidInstallments}/{loan.totalInstallments}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                          {locale === 'bn' ? statusInfo.bn : statusInfo.en}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loan Detail Modal */}
      {selectedHistoryLoan && (
        <div className="fixed inset-0 z-50 bg-black/50 p-2 sm:p-4">
          <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
            <div className="flex max-h-full w-full flex-col overflow-hidden rounded-sm border border-gray-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {locale === 'bn' ? 'ঋণের বিস্তারিত' : 'Loan Details'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {locale === 'bn' ? 'ঋণ নম্বর' : 'Loan Number'}: {selectedHistoryLoan.loanNumber}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-medium ${getStatusLabel(selectedHistoryLoan.status).color}`}>
                    {locale === 'bn' ? getStatusLabel(selectedHistoryLoan.status).bn : getStatusLabel(selectedHistoryLoan.status).en}
                  </span>
                  <button onClick={() => setSelectedHistoryLoan(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-500">{locale === 'bn' ? 'মূল পরিমাণ' : 'Principal'}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {formatCurrency(selectedHistoryLoan.principalAmount, locale)}
                        </p>
                      </div>
                      <div className="rounded-sm border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-700">{locale === 'bn' ? 'বাকি পরিমাণ' : 'Remaining'}</p>
                        <p className="mt-1 text-sm font-semibold text-amber-800">
                          {formatCurrency(selectedHistoryLoan.remainingAmount, locale)}
                        </p>
                      </div>
                      <div className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-500">{locale === 'bn' ? 'কিস্তির অগ্রগতি' : 'Installment Progress'}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {selectedHistoryLoan.paidInstallments}/{selectedHistoryLoan.totalInstallments}
                        </p>
                      </div>
                      <div className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-500">{locale === 'bn' ? 'প্রতি কিস্তি' : 'Per Installment'}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {formatCurrency(selectedHistoryLoan.installmentAmount, locale)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-sm border border-gray-200 p-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">{locale === 'bn' ? 'জামিনদার' : 'Guarantor'}</span>
                        <span className="text-right font-medium text-gray-900">{selectedHistoryLoan.guarantor || '-'}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</span>
                        <span className="text-right font-medium text-gray-900">{selectedHistoryLoan.purpose || '-'}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">{locale === 'bn' ? 'বিতরণের তারিখ' : 'Disbursed'}</span>
                        <span className="text-right font-medium text-gray-900">
                          {selectedHistoryLoan.disbursementDate ? formatDate(selectedHistoryLoan.disbursementDate) : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-sm border border-gray-200 bg-gray-50/60 p-3">
                    <p className="text-sm font-semibold text-gray-800">
                      {locale === 'bn' ? 'ঋণ পরিশোধ অনুরোধ' : 'Loan Repayment Request'}
                    </p>
                    {selectedHistoryLoan.status === 'ACTIVE' && selectedHistoryLoan.remainingAmount > 0 ? (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-sm border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                          {locale === 'bn'
                            ? `আপনি সর্বোচ্চ ${formatCurrency(selectedHistoryLoan.remainingAmount, locale)} পর্যন্ত পরিশোধের অনুরোধ করতে পারবেন।`
                            : `You can request up to ${formatCurrency(selectedHistoryLoan.remainingAmount, locale)}.`}
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-sm border border-gray-200 bg-white p-2">
                            <p className="text-[11px] text-gray-500">{locale === 'bn' ? 'বর্তমান বাকি' : 'Current Remaining'}</p>
                            <p className="mt-1 text-sm font-semibold text-amber-700">
                              {formatCurrency(selectedHistoryLoan.remainingAmount, locale)}
                            </p>
                          </div>
                          <div className="rounded-sm border border-gray-200 bg-white p-2">
                            <p className="text-[11px] text-gray-500">{locale === 'bn' ? 'পরবর্তী কিস্তির তারিখ' : 'Next Due Date'}</p>
                            <p className="mt-1 text-sm font-semibold text-gray-800">
                              {selectedHistoryLoan.nextDueDate ? formatDate(selectedHistoryLoan.nextDueDate) : '-'}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            className="rounded-sm border px-2 py-1.5 text-xs font-medium hover:bg-white"
                            onClick={() => applyRepaymentPreset(selectedHistoryLoan, 'weekly')}
                          >
                            {locale === 'bn' ? 'সাপ্তাহিক' : 'Weekly'}
                          </button>
                          <button
                            type="button"
                            className="rounded-sm border px-2 py-1.5 text-xs font-medium hover:bg-white"
                            onClick={() => applyRepaymentPreset(selectedHistoryLoan, 'monthly')}
                          >
                            {locale === 'bn' ? 'মাসিক' : 'Monthly'}
                          </button>
                          <button
                            type="button"
                            className="rounded-sm border px-2 py-1.5 text-xs font-medium hover:bg-white"
                            onClick={() => applyRepaymentPreset(selectedHistoryLoan, 'full')}
                          >
                            {locale === 'bn' ? 'সম্পূর্ণ' : 'Full'}
                          </button>
                        </div>

                        <div className="space-y-2">
                          <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min="1"
                              max={selectedHistoryLoan.remainingAmount}
                              step="0.01"
                              placeholder="0.00"
                              value={repaymentAmount}
                              onChange={(e) => setRepaymentAmount(e.target.value)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => applyRepaymentPreset(selectedHistoryLoan, 'full')}
                            >
                              {locale === 'bn' ? 'সর্বোচ্চ' : 'Max'}
                            </Button>
                          </div>
                        </div>

                        {projectedRemaining !== null && (
                          <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            {locale === 'bn'
                              ? `অনুরোধ অনুমোদিত হলে সম্ভাব্য বাকি: ${formatCurrency(projectedRemaining, locale)}`
                              : `Estimated remaining after approval: ${formatCurrency(projectedRemaining, locale)}`}
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label>{locale === 'bn' ? 'bKash রেফারেন্স' : 'bKash Reference'}</Label>
                          <Input
                            placeholder={locale === 'bn' ? 'লেনদেন রেফারেন্স নম্বর' : 'Transaction reference number'}
                            value={repaymentReference}
                            onChange={(e) => setRepaymentReference(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
                          <Textarea
                            placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional details...'}
                            value={repaymentNotes}
                            onChange={(e) => setRepaymentNotes(e.target.value)}
                          />
                        </div>

                        <div className="text-xs text-gray-500">
                          {pendingRepaymentRequests > 0
                            ? locale === 'bn'
                              ? `${pendingRepaymentRequests} টি ঋণ পরিশোধ অনুরোধ বর্তমানে অপেক্ষমাণ।`
                              : `${pendingRepaymentRequests} repayment request(s) are currently pending.`
                            : locale === 'bn'
                              ? 'এই ঋণের জন্য বর্তমানে কোনো অপেক্ষমাণ পরিশোধ অনুরোধ নেই।'
                              : 'No pending repayment requests for this loan right now.'}
                        </div>

                        <Button
                          onClick={() => void handleRepaymentRequest(selectedHistoryLoan)}
                          disabled={isRepaymentSubmitting}
                          className="w-full gap-2"
                        >
                          <Send className="h-4 w-4" />
                          {isRepaymentSubmitting
                            ? (locale === 'bn' ? 'জমা হচ্ছে...' : 'Submitting...')
                            : (locale === 'bn' ? 'অনুরোধ পাঠান' : 'Submit Request')}
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-sm border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                        {locale === 'bn'
                          ? 'এই ঋণের বর্তমান অবস্থায় পরিশোধ অনুরোধ করা যাবে না।'
                          : 'Repayment request is unavailable for this loan status.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-4 py-3">
                <Button onClick={() => setSelectedHistoryLoan(null)} className="h-8 text-xs">
                  {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
        </div>
      )}
    </div>
  );
}
