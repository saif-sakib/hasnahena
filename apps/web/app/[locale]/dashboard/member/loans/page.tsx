'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  HandCoins,
  AlertCircle,
  Calendar,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

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

export default function LoansPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [currentDeposit, setCurrentDeposit] = useState(0);
  const minDepositRequired = 8000;
  const maxLoanMultiplier = 5;
  const maxLoanAmount = currentDeposit * maxLoanMultiplier;
  const isEligible = currentDeposit >= minDepositRequired;
  const [activeLoan, setActiveLoan] = useState<Loan | null>(null);
  const [loanHistory, setLoanHistory] = useState<Loan[]>([]);
  const [selectedHistoryLoan, setSelectedHistoryLoan] = useState<Loan | null>(null);
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
      const data = await apiGet<{
        currentDeposit?: number;
        activeLoan?: Loan | null;
        loanHistory?: Loan[];
      }>('/v1/dashboard/member/loans');
      setCurrentDeposit(data?.currentDeposit ?? 0);
      setActiveLoan(data?.activeLoan ?? null);
      setLoanHistory(data?.loanHistory ?? []);
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

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
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
          <table className="w-full text-sm">
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
                    onClick={() => setSelectedHistoryLoan(loan)}
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
      )}

      {/* Loan Detail Modal */}
      {selectedHistoryLoan && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">
                {locale === 'bn' ? 'ঋণের বিস্তারিত' : 'Loan Details'}
              </h3>
              <button onClick={() => setSelectedHistoryLoan(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'ঋণ নম্বর' : 'Loan Number'}</span>
                <span className="font-medium">{selectedHistoryLoan.loanNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                <span className={`px-2 py-0.5 text-xs font-medium ${getStatusLabel(selectedHistoryLoan.status).color}`}>
                  {locale === 'bn' ? getStatusLabel(selectedHistoryLoan.status).bn : getStatusLabel(selectedHistoryLoan.status).en}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'মূল পরিমাণ' : 'Principal'}</span>
                <span className="font-medium">{formatCurrency(selectedHistoryLoan.principalAmount, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'বাকি পরিমাণ' : 'Remaining'}</span>
                <span className="font-medium">{formatCurrency(selectedHistoryLoan.remainingAmount, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'কিস্তি' : 'Installments'}</span>
                <span className="font-medium">{selectedHistoryLoan.paidInstallments}/{selectedHistoryLoan.totalInstallments}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'প্রতি কিস্তি' : 'Per Installment'}</span>
                <span className="font-medium">{formatCurrency(selectedHistoryLoan.installmentAmount, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'জামিনদার' : 'Guarantor'}</span>
                <span className="font-medium">{selectedHistoryLoan.guarantor || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</span>
                <span className="font-medium">{selectedHistoryLoan.purpose || '-'}</span>
              </div>
              {selectedHistoryLoan.disbursementDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{locale === 'bn' ? 'বিতরণের তারিখ' : 'Disbursed'}</span>
                  <span className="font-medium">{formatDate(selectedHistoryLoan.disbursementDate)}</span>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
              <Button onClick={() => setSelectedHistoryLoan(null)} className="w-full h-8 text-xs">
                {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
              </Button>
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
