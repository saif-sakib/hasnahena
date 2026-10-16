'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Receipt,
  Search,
  Calendar,
  Wallet,
  HandCoins,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Phone,
  Download,
} from 'lucide-react';
import {
  buildReceipt,
  downloadDocumentPDF,
  fetchOrgSettings,
} from '@/lib/documents';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { useApi } from '@/lib/use-api';
import { useDashboardRole } from '@/components/dashboard/role';

type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | 'DONATION' | 'FEE' | string;
type TransactionStatus = 'CONFIRMED' | 'PENDING' | 'DISPUTED' | 'PROCESSED' | 'REJECTED' | string;

interface Transaction {
  id: string;
  accountNo: string;
  memberName: string;
  /** The English name, for documents (English only, ADR-012). */
  memberNameEn: string;
  memberPhone: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  date: string;
  balanceAfter: number;
  reference?: string;
  notes?: string;
  processedBy?: string;
}

/**
 * Every posting, filterable, for both staff dashboards: admin reads the ledger
 * (`types=all`), a worker their own postings; both payloads normalised.
 */
export default function TransactionsScreen() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const role = useDashboardRole();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const { data, isLoading } = useApi<any>(
    role === 'admin'
      ? '/v1/dashboard/admin/deposits?types=all'
      : '/v1/dashboard/worker/transactions',
  );

  const transactions = useMemo<Transaction[]>(() => {
    const rows: any[] = Array.isArray(data) ? data : (data?.deposits ?? []);
    return rows.map((item) => {
      const member = item?.member ?? {};
      return {
        id: String(item.id ?? ''),
        accountNo: String(member.accountNo ?? item.accountNo ?? ''),
        memberName: String(member.name ?? item.memberName ?? ''),
        memberNameEn: String(item?.memberName ?? member.name ?? ''),
        // Nested (admin) first, then flat (worker).
        memberPhone: String(member.phone ?? item.memberPhone ?? ''),
        processedBy: item.processedBy ? String(item.processedBy) : undefined,
        type: String(item.type ?? '').toUpperCase() as TransactionType,
        amount: Number(item.amount ?? 0),
        status: String(item.status ?? 'CONFIRMED').toUpperCase() as TransactionStatus,
        date: String(item.processedDate ?? item.date ?? new Date().toISOString()),
        balanceAfter: Number(item.balanceAfter ?? 0),
        // The member's own bKash TrxID — `id` is the receipt number (ADR-044).
        reference: item.externalReference ? String(item.externalReference) : undefined,
        notes: item.notes
          ? String(item.notes)
          : item.description
            ? String(item.description)
            : undefined,
      };
    });
  }, [data]);

  const handleDownloadReceipt = async (tx: Transaction) => {
    try {
      const orgSettings = await fetchOrgSettings();
      const receiptDoc = buildReceipt({
        receiptNumber: tx.id,
        type: tx.type,
        amount: tx.amount,
        date: tx.date,
        memberName: tx.memberNameEn,
        accountNo: tx.accountNo,
        memberPhone: tx.memberPhone,
        balanceAfter: tx.balanceAfter,
        processedBy: tx.processedBy,
        notes: tx.notes,
      }, orgSettings);
      await downloadDocumentPDF(receiptDoc);
    } catch (error) {
      console.error('Failed to download receipt:', error);
    }
  };


  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const getTypeBadge = (type: TransactionType) => {
    const config = {
      DEPOSIT: {
        label: locale === 'bn' ? 'জমা' : 'Deposit',
        color: 'bg-green-100 text-green-700',
        icon: ArrowDownLeft,
      },
      WITHDRAWAL: {
        label: locale === 'bn' ? 'উত্তোলন' : 'Withdrawal',
        color: 'bg-purple-100 text-purple-700',
        icon: ArrowUpRight,
      },
      LOAN_DISBURSEMENT: {
        label: locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan Disbursement',
        color: 'bg-blue-100 text-blue-700',
        icon: HandCoins,
      },
      LOAN_REPAYMENT: {
        label: locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Repayment',
        color: 'bg-amber-100 text-amber-700',
        icon: Receipt,
      },
    };

    const fallback = {
      label: type.replace(/_/g, ' '),
      color: 'bg-slate-100 text-slate-700',
      icon: Receipt,
    };
    const { label, color, icon: Icon } = config[type as keyof typeof config] ?? fallback;
    return (
      <Badge className={`${color} hover:${color}`}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  };

  const getStatusBadge = (status: TransactionStatus) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'নিশ্চিত' : 'Confirmed'}
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
          </Badge>
        );
      case 'DISPUTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}
          </Badge>
        );
      case 'PROCESSED':
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রক্রিয়াকৃত' : 'Processed'}
          </Badge>
        );
      case 'REJECTED':
        return (
          <Badge className="bg-gray-200 text-gray-700 hover:bg-gray-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
            {status}
          </Badge>
        );
    }
  };

  const isIncoming = (type: TransactionType) => {
    return type === 'DEPOSIT' || type === 'LOAN_REPAYMENT' || type === 'DONATION';
  };

  // Filter by date
  const filterByDate = (date: string) => {
    const txDate = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    switch (dateFilter) {
      case 'today':
        return txDate.toDateString() === today.toDateString();
      case 'yesterday':
        return txDate.toDateString() === yesterday.toDateString();
      case 'week':
        return txDate >= weekAgo;
      case 'month':
        return txDate >= monthAgo;
      default:
        return true;
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch =
      tx.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.memberPhone.includes(searchQuery) ||
      tx.reference?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || tx.type === typeFilter;
    const matchesDate = filterByDate(tx.date);
    return matchesSearch && matchesType && matchesDate;
  });

  // Summary stats
  const todayDeposits = transactions
    .filter((t) => t.type === 'DEPOSIT' && t.status === 'CONFIRMED' && filterByDate(t.date))
    .reduce((sum, t) => sum + t.amount, 0);
  const todayPayments = transactions
    .filter((t) => t.type === 'LOAN_REPAYMENT' && t.status === 'CONFIRMED' && filterByDate(t.date))
    .reduce((sum, t) => sum + t.amount, 0);
  const totalTransactions = filteredTransactions.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'লেনদেন ইতিহাস' : 'Transaction History'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'আপনার প্রসেসকৃত সকল লেনদেন'
              : 'All transactions processed by you'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-slate-200 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'জমা সংগ্রহ' : 'Deposits Collected'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(todayDeposits, locale)}</p>
              </div>
              <Wallet className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ঋণ কিস্তি সংগ্রহ' : 'Loan Payments'}</p>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(todayPayments, locale)}</p>
              </div>
              <Receipt className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট লেনদেন' : 'Total Transactions'}</p>
                <p className="text-2xl font-bold">{totalTransactions}</p>
              </div>
              <Receipt className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="rounded-2xl border-slate-200 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'সদস্য বা রেফারেন্স দিয়ে খুঁজুন...' : 'Search by member or reference...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-40" aria-label={tA11y('filterByType')}>
                <SelectValue placeholder={locale === 'bn' ? 'ধরন' : 'Type'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</SelectItem>
                <SelectItem value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</SelectItem>
                <SelectItem value="LOAN_DISBURSEMENT">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan Disbursement'}</SelectItem>
                <SelectItem value="LOAN_REPAYMENT">{locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Repayment'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full md:w-40" aria-label={tA11y('filterByPeriod')}>
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'তারিখ' : 'Date'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All Time'}</SelectItem>
                <SelectItem value="today">{locale === 'bn' ? 'আজ' : 'Today'}</SelectItem>
                <SelectItem value="yesterday">{locale === 'bn' ? 'গতকাল' : 'Yesterday'}</SelectItem>
                <SelectItem value="week">{locale === 'bn' ? 'এই সপ্তাহ' : 'This Week'}</SelectItem>
                <SelectItem value="month">{locale === 'bn' ? 'এই মাস' : 'This Month'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card className="rounded-2xl border-slate-200 shadow-xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {locale === 'bn' ? 'লেনদেন তালিকা' : 'Transactions List'}
          </CardTitle>
          {/* The scope, stated — see the note on the deposits screen. */}
          <CardDescription>
            {locale === 'bn'
              ? `${filteredTransactions.length} টি লেনদেন — ${
                  role === 'admin' ? 'পুরো ফাউন্ডেশন' : 'আপনার প্রক্রিয়াকৃত'
                }`
              : `${filteredTransactions.length} transactions — ${
                  role === 'admin' ? 'whole foundation' : 'processed by you'
                }`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : (
          <div className="space-y-4">
            {filteredTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl ${
                  transaction.status === 'DISPUTED'
                    ? 'bg-red-50'
                    : transaction.status === 'PENDING'
                      ? 'bg-amber-50'
                      : 'bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`h-12 w-12 rounded-full flex items-center justify-center ${
                      isIncoming(transaction.type)
                        ? 'bg-green-100 text-green-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {isIncoming(transaction.type) ? (
                      <ArrowDownLeft className="h-6 w-6" />
                    ) : (
                      <ArrowUpRight className="h-6 w-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{transaction.memberName}</span>
                      {getTypeBadge(transaction.type)}
                      {getStatusBadge(transaction.status)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p className="flex items-center gap-2">
                        <Phone className="h-3 w-3" /> {transaction.memberPhone}
                        <span className="mx-1">•</span>
                        <Calendar className="h-3 w-3" /> {formatDateTime(transaction.date)}
                      </p>
                      {transaction.reference && (
                        <p className="text-xs mt-1">Ref: {transaction.reference}</p>
                      )}
                      {transaction.notes && (
                        <p className="text-xs mt-1 italic">{transaction.notes}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p
                      className={`text-xl font-bold ${
                        isIncoming(transaction.type) ? 'text-green-600' : 'text-purple-600'
                      }`}
                    >
                      {isIncoming(transaction.type) ? '+' : '-'}
                      {formatCurrency(transaction.amount, locale)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'} {formatCurrency(transaction.balanceAfter, locale)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDownloadReceipt(transaction)}
                      title={locale === 'bn' ? 'রশিদ ডাউনলোড' : 'Download Receipt'}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedTransaction(transaction);
                        setShowDetailModal(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {filteredTransactions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}</p>
              </div>
            )}
          </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'লেনদেন বিস্তারিত' : 'Transaction Details'}</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
                <span className="font-medium">{selectedTransaction.memberName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                <span className="font-medium">{selectedTransaction.memberPhone}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'ধরন' : 'Type'}</span>
                {getTypeBadge(selectedTransaction.type)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span>
                <span
                  className={`font-bold ${
                    isIncoming(selectedTransaction.type) ? 'text-green-600' : 'text-purple-600'
                  }`}
                >
                  {isIncoming(selectedTransaction.type) ? '+' : '-'}
                  {formatCurrency(selectedTransaction.amount, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                {getStatusBadge(selectedTransaction.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'তারিখ ও সময়' : 'Date & Time'}</span>
                <span className="font-medium">{formatDateTime(selectedTransaction.date)}</span>
              </div>
              {selectedTransaction.reference && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'রেফারেন্স' : 'Reference'}</span>
                  <span className="font-medium">{selectedTransaction.reference}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'পরবর্তী ব্যালেন্স' : 'Balance After'}</span>
                <span className="font-medium">{formatCurrency(selectedTransaction.balanceAfter, locale)}</span>
              </div>
              {selectedTransaction.notes && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm">
                    <span className="text-muted-foreground">{locale === 'bn' ? 'নোট:' : 'Notes:'}</span>{' '}
                    {selectedTransaction.notes}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
