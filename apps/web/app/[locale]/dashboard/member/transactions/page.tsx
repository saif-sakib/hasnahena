'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  Receipt,
  Search,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  X,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet } from '@/lib/api';

type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT';
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

export default function TransactionsPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<TransactionType | 'ALL'>('ALL');
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [correctAmount, setCorrectAmount] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const data = await apiGet<Transaction[]>('/v1/dashboard/member/transactions');
        setTransactions(data || []);
      } catch {
        setTransactions([]);
      }
    };
    loadTransactions();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
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
    const info: Record<TransactionType, { bn: string; en: string; icon: typeof ArrowUpRight; color: string; bgColor: string }> = {
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
    };
    return info[type];
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
    const matchesSearch =
      tx.receiptNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.description?.toLowerCase().includes(searchQuery.toLowerCase());
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
    // TODO: Call API to submit dispute
    console.log('Submitting dispute:', {
      transactionId: selectedTransaction?.id,
      reason: disputeReason,
      correctAmount,
    });
    setShowDisputeModal(false);
    setDisputeReason('');
    setCorrectAmount('');
    setSelectedTransaction(null);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">{t('transactionHistory')}</h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'আপনার সকল লেনদেনের ইতিহাস দেখুন'
            : 'View your complete transaction history'}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('totalDeposited')}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposits)}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                <ArrowUpRight className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'মোট উত্তোলন' : 'Total Withdrawals'}
                </p>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(totalWithdrawals)}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <ArrowDownRight className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'কিস্তি পরিশোধ' : 'Loan Repayments'}
                </p>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(totalLoanRepayments)}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Receipt className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'মোট লেনদেন' : 'Total Transactions'}
                </p>
                <p className="text-2xl font-bold">{transactions.length}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={locale === 'bn' ? 'রশিদ নম্বর বা বিবরণ খুঁজুন...' : 'Search by receipt number or description...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as TransactionType | 'ALL')}
                className="h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="ALL">{locale === 'bn' ? 'সব ধরন' : 'All Types'}</option>
                <option value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</option>
                <option value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</option>
                <option value="LOAN_DISBURSEMENT">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan Disbursement'}</option>
                <option value="LOAN_REPAYMENT">{locale === 'bn' ? 'কিস্তি পরিশোধ' : 'Loan Repayment'}</option>
              </select>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">{t('downloadStatement')}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{t('allTransactions')}</CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredTransactions.length}টি লেনদেন পাওয়া গেছে`
              : `Found ${filteredTransactions.length} transactions`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {paginatedTransactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {locale === 'bn' ? 'কোন লেনদেন পাওয়া যায়নি' : 'No transactions found'}
              </div>
            ) : (
              paginatedTransactions.map((tx) => {
                const typeInfo = getTransactionTypeInfo(tx.type);
                const statusInfo = getStatusLabel(tx.status);
                const IconComponent = typeInfo.icon;

                return (
                  <div
                    key={tx.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`h-10 w-10 rounded-full ${typeInfo.bgColor} ${typeInfo.color} flex items-center justify-center flex-shrink-0`}
                      >
                        <IconComponent className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-semibold ${typeInfo.color}`}>
                            {tx.type === 'DEPOSIT' || tx.type === 'LOAN_DISBURSEMENT' ? '+' : '-'}
                            {formatCurrency(tx.amount)}
                          </p>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                          >
                            {locale === 'bn' ? statusInfo.bn : statusInfo.en}
                          </span>
                        </div>
                        <p className="text-sm font-medium">
                          {locale === 'bn' ? typeInfo.bn : typeInfo.en}
                          {tx.description && ` • ${tx.description}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tx.receiptNumber} • {formatDate(tx.date)} {formatTime(tx.date)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 ml-14 sm:ml-0">
                      {tx.balanceAfter !== undefined && (
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">{t('balance')}</p>
                          <p className="font-medium">{formatCurrency(tx.balanceAfter)}</p>
                        </div>
                      )}
                      {tx.status === 'PROCESSED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-red-600 hover:text-red-700"
                          onClick={() => handleOpenDispute(tx)}
                        >
                          <AlertCircle className="h-3 w-3" />
                          {t('dispute')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                {locale === 'bn'
                  ? `${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, filteredTransactions.length)} এর ${filteredTransactions.length}`
                  : `${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, filteredTransactions.length)} of ${filteredTransactions.length}`}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dispute Modal */}
      {showDisputeModal && selectedTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md rounded-2xl shadow-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  {t('raiseDispute')}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowDisputeModal(false);
                    setSelectedTransaction(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                {locale === 'bn'
                  ? 'এই লেনদেনে সমস্যা থাকলে বিরোধ উত্থাপন করুন'
                  : 'Raise a dispute if there is an issue with this transaction'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 rounded-lg bg-slate-50">
                <p className="text-sm text-muted-foreground">{t('receiptNumber')}</p>
                <p className="font-medium">{selectedTransaction.receiptNumber}</p>
                <p className="text-sm text-muted-foreground mt-2">{t('amount')}</p>
                <p className="font-medium">{formatCurrency(selectedTransaction.amount)}</p>
              </div>

              <form onSubmit={handleSubmitDispute} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="correctAmount">{t('correctAmount')}</Label>
                  <Input
                    id="correctAmount"
                    type="number"
                    placeholder={locale === 'bn' ? 'সঠিক পরিমাণ লিখুন' : 'Enter correct amount'}
                    value={correctAmount}
                    onChange={(e) => setCorrectAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">{t('disputeReason')}</Label>
                  <textarea
                    id="reason"
                    className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm"
                    placeholder={locale === 'bn' ? 'বিরোধের কারণ বিস্তারিত লিখুন' : 'Describe the reason for dispute'}
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1 gap-2">
                    {t('submitDispute')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowDisputeModal(false);
                      setSelectedTransaction(null);
                    }}
                  >
                    {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
