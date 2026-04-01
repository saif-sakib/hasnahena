'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Search,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { getValidatedClientToken } from '@/lib/client-auth';
import { generateStatementHTML, generateReceiptHTML, openPrintWindow } from '@/lib/documents/receipt-generator';

type KnownTransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_REPAYMENT'
  | 'DONATION'
  | 'FEE';
type TransactionType = KnownTransactionType | string;
type TransactionStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';

interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  receiptNumber: string;
  description?: string;
  status: TransactionStatus;
  balanceAfter?: number;
  processedBy?: string;
}

interface MemberProfile {
  name?: string;
  userId?: string;
  phone?: string;
  accountSummary?: {
    currentBalance?: number;
  };
}

export default function TransactionsPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<TransactionType | 'ALL'>('ALL');
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [correctAmount, setCorrectAmount] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = getValidatedClientToken();
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const [txData, profileData] = await Promise.all([
        apiGet<Transaction[]>('/v1/dashboard/member/transactions'),
        apiGet<MemberProfile>('/v1/dashboard/member/profile'),
      ]);
      setTransactions(txData ?? []);
      setMemberProfile(profileData);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Download full statement
  const handleDownloadStatement = () => {
    if (!memberProfile || transactions.length === 0) return;
    
    const confirmedTxs = transactions.filter(tx => tx.status === 'CONFIRMED');
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    
    const totalDeposits = confirmedTxs
      .filter(tx => tx.type === 'DEPOSIT' || tx.type === 'LOAN_DISBURSEMENT')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const totalWithdrawals = confirmedTxs
      .filter(tx => tx.type === 'WITHDRAWAL' || tx.type === 'LOAN_REPAYMENT')
      .reduce((sum, tx) => sum + tx.amount, 0);
    
    const statementHtml = generateStatementHTML({
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      periodStart: oneYearAgo.toISOString(),
      periodEnd: now.toISOString(),
      openingBalance: 0,
      closingBalance: (memberProfile.accountSummary?.currentBalance || 0) * 100,
      totalDeposits: totalDeposits * 100,
      totalWithdrawals: totalWithdrawals * 100,
      transactions: confirmedTxs.map(tx => ({
        date: tx.date,
        type: tx.type,
        amount: tx.amount * 100,
        balance: (tx.balanceAfter || 0) * 100,
        description: tx.description,
        receiptNumber: tx.receiptNumber,
      })),
    }, locale);
    
    openPrintWindow(statementHtml, locale === 'bn' ? 'লেনদেন বিবরণী' : 'Transaction Statement');
  };

  // Print individual receipt
  const handlePrintReceipt = (tx: Transaction) => {
    if (!memberProfile) return;
    
    const receiptHtml = generateReceiptHTML({
      receiptNumber: tx.receiptNumber,
      type: tx.type,
      amount: tx.amount * 100,
      date: tx.date,
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      balanceAfter: (tx.balanceAfter || 0) * 100,
      processedBy: tx.processedBy,
      notes: tx.description,
    }, locale);
    
    openPrintWindow(receiptHtml, locale === 'bn' ? 'রসিদ' : 'Receipt');
  };

  const formatDateLocal = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTransactionTypeInfo = (type: TransactionType) => {
    const info: Record<KnownTransactionType, { bn: string; en: string; icon: typeof ArrowUpRight; color: string; bgColor: string }> = {
      DEPOSIT: {
        bn: 'জমা',
        en: 'Deposit',
        icon: ArrowUpRight,
        color: 'text-green-600',
        bgColor: 'bg-green-100',
      },
      WITHDRAWAL: {
        bn: 'উত্তোলন',
        en: 'Withdrawal',
        icon: ArrowDownRight,
        color: 'text-red-600',
        bgColor: 'bg-red-100',
      },
      LOAN_DISBURSEMENT: {
        bn: 'ঋণ বিতরণ',
        en: 'Loan Disbursement',
        icon: ArrowUpRight,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
      },
      LOAN_REPAYMENT: {
        bn: 'কিস্তি পরিশোধ',
        en: 'Loan Repayment',
        icon: ArrowDownRight,
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
      },
      DONATION: {
        bn: 'দান',
        en: 'Donation',
        icon: ArrowUpRight,
        color: 'text-teal-600',
        bgColor: 'bg-teal-100',
      },
      FEE: {
        bn: 'ফি',
        en: 'Fee',
        icon: ArrowDownRight,
        color: 'text-slate-600',
        bgColor: 'bg-slate-100',
      },
    };
    return info[type as KnownTransactionType] ?? {
      bn: 'অন্যান্য',
      en: type.replace(/_/g, ' '),
      icon: ArrowUpRight,
      color: 'text-slate-600',
      bgColor: 'bg-slate-100',
    };
  };

  const getStatusLabel = (status: TransactionStatus) => {
    const labels: Record<TransactionStatus, { bn: string; en: string; color: string }> = {
      PENDING: { bn: 'অপেক্ষমান', en: 'Pending', color: 'bg-amber-100 text-amber-700' },
      PROCESSED: { bn: 'প্রক্রিয়াকৃত', en: 'Processed', color: 'bg-blue-100 text-blue-700' },
      CONFIRMED: { bn: 'নিশ্চিত', en: 'Confirmed', color: 'bg-green-100 text-green-700' },
      DISPUTED: { bn: 'বিবাদিত', en: 'Disputed', color: 'bg-red-100 text-red-700' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected', color: 'bg-gray-100 text-gray-700' },
    };
    return labels[status];
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    const receipt = tx.receiptNumber ?? '';
    const description = tx.description ?? '';
    const matchesSearch =
      receipt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'ALL' || tx.type === filterType;
    return matchesSearch && matchesType;
  });

  // Pagination
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Summary calculations
  const totalDeposits = transactions
    .filter((tx) => tx.type === 'DEPOSIT' && tx.status === 'CONFIRMED')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalWithdrawals = transactions
    .filter((tx) => tx.type === 'WITHDRAWAL' && tx.status === 'CONFIRMED')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalLoanRepayments = transactions
    .filter((tx) => tx.type === 'LOAN_REPAYMENT' && tx.status === 'CONFIRMED')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const handleOpenDispute = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setShowDisputeModal(true);
  };

  const handleSubmitDispute = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      setActionError(null);
      const token = getValidatedClientToken();
      if (!token) {
        router.push(`/${locale}/login`);
        return;
      }
      if (!selectedTransaction) return;

      const parsedCorrect = Number(correctAmount);
      const res = await fetch(`/api/v1/member/transactions/${selectedTransaction.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reason: disputeReason,
          correctAmount: Number.isFinite(parsedCorrect) ? parsedCorrect : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error ?? 'Failed to raise dispute');
        return;
      }

      setShowDisputeModal(false);
      setDisputeReason('');
      setCorrectAmount('');
      setSelectedTransaction(null);
      await refresh();
    })();
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{t('transactionHistory')}</h1>
        <Button 
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={handleDownloadStatement}
          disabled={transactions.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
          {locale === 'bn' ? 'ডাউনলোড' : 'Download'}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="border border-gray-200 bg-white">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'মোট জমা' : 'Total Deposits'}</p>
            <p className="text-sm font-semibold text-green-600">{formatCurrency(totalDeposits, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'মোট উত্তোলন' : 'Withdrawals'}</p>
            <p className="text-sm font-semibold text-red-600">{formatCurrency(totalWithdrawals, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'কিস্তি পরিশোধ' : 'Repayments'}</p>
            <p className="text-sm font-semibold text-amber-600">{formatCurrency(totalLoanRepayments, locale)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">{locale === 'bn' ? 'মোট লেনদেন' : 'Total Txns'}</p>
            <p className="text-sm font-semibold text-gray-900">{transactions.length}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            type="text"
            placeholder={locale === 'bn' ? 'রশিদ নম্বর খুঁজুন...' : 'Search receipt...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as TransactionType | 'ALL')}
          className="h-8 px-3 border border-gray-200 bg-white text-sm"
        >
          <option value="ALL">{locale === 'bn' ? 'সব ধরন' : 'All Types'}</option>
          <option value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</option>
          <option value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</option>
          <option value="LOAN_DISBURSEMENT">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan'}</option>
          <option value="LOAN_REPAYMENT">{locale === 'bn' ? 'কিস্তি' : 'Repayment'}</option>
        </select>
      </div>

      {/* Transactions Table */}
      <div className="border border-gray-200 bg-white">
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {locale === 'bn' ? 'লেনদেনসমূহ' : 'Transactions'}
          </span>
          <span className="text-xs text-gray-500">
            {filteredTransactions.length} {locale === 'bn' ? 'টি' : 'found'}
          </span>
        </div>
        
        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
          </div>
        ) : paginatedTransactions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            {locale === 'bn' ? 'কোন লেনদেন পাওয়া যায়নি' : 'No transactions found'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs">
                <th className="px-4 py-2 text-left font-medium text-gray-600">
                  {locale === 'bn' ? 'তারিখ' : 'Date'}
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">
                  {locale === 'bn' ? 'ধরন' : 'Type'}
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">
                  {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
                </th>
                <th className="px-4 py-2 text-center font-medium text-gray-600 hidden sm:table-cell">
                  {locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 hidden md:table-cell">
                  {locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}
                </th>
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedTransactions.map((tx) => {
                const typeInfo = getTransactionTypeInfo(tx.type);
                const statusInfo = getStatusLabel(tx.status);
                const isCredit = tx.type === 'DEPOSIT' || tx.type === 'LOAN_DISBURSEMENT';

                return (
                  <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{formatDateLocal(tx.date)}</p>
                      <p className="text-xs text-gray-400">{formatTime(tx.date)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{locale === 'bn' ? typeInfo.bn : typeInfo.en}</p>
                      <p className="text-xs text-gray-400">{tx.receiptNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
                        {isCredit ? '+' : '-'}{formatCurrency(tx.amount, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                        {locale === 'bn' ? statusInfo.bn : statusInfo.en}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {tx.balanceAfter !== undefined ? formatCurrency(tx.balanceAfter, locale) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tx.status === 'CONFIRMED' && (
                        <button
                          onClick={() => handlePrintReceipt(tx)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredTransactions.length)} / {filteredTransactions.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 border border-gray-200 bg-white disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 border border-gray-200 bg-white disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dispute Modal */}
      {showDisputeModal && selectedTransaction && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                {t('raiseDispute')}
              </h3>
              <button onClick={() => { setShowDisputeModal(false); setSelectedTransaction(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <div className="mb-4 p-3 bg-gray-50 text-sm">
                <p className="text-gray-500">{t('receiptNumber')}: <span className="font-medium text-gray-900">{selectedTransaction.receiptNumber}</span></p>
                <p className="text-gray-500">{t('amount')}: <span className="font-medium text-gray-900">{formatCurrency(selectedTransaction.amount, locale)}</span></p>
              </div>
              {actionError && (
                <div className="mb-4 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {actionError}
                </div>
              )}
              <form onSubmit={handleSubmitDispute} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('correctAmount')}</label>
                  <Input
                    type="number"
                    placeholder={locale === 'bn' ? 'সঠিক পরিমাণ' : 'Correct amount'}
                    value={correctAmount}
                    onChange={(e) => setCorrectAmount(e.target.value)}
                    className="h-8 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('disputeReason')}</label>
                  <textarea
                    className="w-full min-h-[80px] px-3 py-2 border border-gray-200 text-sm"
                    placeholder={locale === 'bn' ? 'কারণ লিখুন' : 'Describe the issue'}
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1 h-8 text-xs">{t('submitDispute')}</Button>
                  <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { setShowDisputeModal(false); setSelectedTransaction(null); }}>
                    {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
