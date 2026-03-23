'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Receipt,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  Wallet,
  HandCoins,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Phone,
} from 'lucide-react';
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

type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_PAYMENT';
type TransactionStatus = 'CONFIRMED' | 'PENDING' | 'DISPUTED';

interface Transaction {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  date: string;
  balanceAfter: number;
  reference?: string;
  notes?: string;
}

export default function WorkerTransactionsPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Mock data
  const transactions: Transaction[] = [
    {
      id: 'TXN001',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      memberPhone: '01712345678',
      type: 'DEPOSIT',
      amount: 5000,
      status: 'CONFIRMED',
      date: '2025-01-14T10:30:00',
      balanceAfter: 85000,
      reference: 'DEP-20250114-001',
    },
    {
      id: 'TXN002',
      memberId: 'm2',
      memberName: 'ফাতেমা বেগম',
      memberPhone: '01812345678',
      type: 'LOAN_PAYMENT',
      amount: 5000,
      status: 'CONFIRMED',
      date: '2025-01-14T09:45:00',
      balanceAfter: 120000,
      reference: 'LPN-20250114-001',
      notes: 'কিস্তি ১০/২০',
    },
    {
      id: 'TXN003',
      memberId: 'm3',
      memberName: 'রহিম উদ্দিন',
      memberPhone: '01912345678',
      type: 'WITHDRAWAL',
      amount: 15000,
      status: 'CONFIRMED',
      date: '2025-01-13T14:20:00',
      balanceAfter: 30000,
      reference: 'WTH-20250113-001',
    },
    {
      id: 'TXN004',
      memberId: 'm4',
      memberName: 'সাদিয়া আক্তার',
      memberPhone: '01612345678',
      type: 'DEPOSIT',
      amount: 10000,
      status: 'PENDING',
      date: '2025-01-14T11:00:00',
      balanceAfter: 105000,
      reference: 'DEP-20250114-002',
    },
    {
      id: 'TXN005',
      memberId: 'm5',
      memberName: 'জাকির হোসেন',
      memberPhone: '01512345678',
      type: 'LOAN_DISBURSEMENT',
      amount: 50000,
      status: 'CONFIRMED',
      date: '2025-01-12T15:00:00',
      balanceAfter: 75000,
      reference: 'LND-20250112-001',
      notes: 'ঋণ L006 বিতরণ',
    },
    {
      id: 'TXN006',
      memberId: 'm6',
      memberName: 'শামিমা বেগম',
      memberPhone: '01312345678',
      type: 'LOAN_PAYMENT',
      amount: 4000,
      status: 'CONFIRMED',
      date: '2025-01-13T10:30:00',
      balanceAfter: 55000,
      reference: 'LPN-20250113-001',
      notes: 'কিস্তি ৫/১০',
    },
    {
      id: 'TXN007',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      memberPhone: '01712345678',
      type: 'DEPOSIT',
      amount: 8000,
      status: 'DISPUTED',
      date: '2025-01-11T16:00:00',
      balanceAfter: 80000,
      reference: 'DEP-20250111-001',
      notes: 'সদস্য ১০,০০০ টাকা দিয়েছেন বলে দাবি',
    },
    {
      id: 'TXN008',
      memberId: 'm2',
      memberName: 'ফাতেমা বেগম',
      memberPhone: '01812345678',
      type: 'DEPOSIT',
      amount: 7000,
      status: 'CONFIRMED',
      date: '2025-01-10T09:00:00',
      balanceAfter: 115000,
      reference: 'DEP-20250110-001',
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
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
      LOAN_PAYMENT: {
        label: locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment',
        color: 'bg-amber-100 text-amber-700',
        icon: Receipt,
      },
    };

    const { label, color, icon: Icon } = config[type];
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
    }
  };

  const isIncoming = (type: TransactionType) => {
    return type === 'DEPOSIT' || type === 'LOAN_PAYMENT';
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
    .filter((t) => t.type === 'LOAN_PAYMENT' && t.status === 'CONFIRMED' && filterByDate(t.date))
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
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          {locale === 'bn' ? 'এক্সপোর্ট' : 'Export'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'জমা সংগ্রহ' : 'Deposits Collected'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(todayDeposits)}</p>
              </div>
              <Wallet className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ঋণ কিস্তি সংগ্রহ' : 'Loan Payments'}</p>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(todayPayments)}</p>
              </div>
              <Receipt className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
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
      <Card className="rounded-2xl border-slate-200 shadow-sm">
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
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder={locale === 'bn' ? 'ধরন' : 'Type'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</SelectItem>
                <SelectItem value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</SelectItem>
                <SelectItem value="LOAN_DISBURSEMENT">{locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan Disbursement'}</SelectItem>
                <SelectItem value="LOAN_PAYMENT">{locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full md:w-40">
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
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {locale === 'bn' ? 'লেনদেন তালিকা' : 'Transactions List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredTransactions.length} টি লেনদেন পাওয়া গেছে`
              : `${filteredTransactions.length} transactions found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                      {formatCurrency(transaction.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'} {formatCurrency(transaction.balanceAfter)}
                    </p>
                  </div>
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
            ))}

            {filteredTransactions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}</p>
              </div>
            )}
          </div>
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
                  {formatCurrency(selectedTransaction.amount)}
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
                <span className="font-medium">{formatCurrency(selectedTransaction.balanceAfter)}</span>
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
