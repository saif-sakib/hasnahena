'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Wallet,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  XCircle,
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

type DepositStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
type DepositType = 'DEPOSIT' | 'WITHDRAWAL';

interface Deposit {
  id: string;
  type: DepositType;
  amount: number;
  status: DepositStatus;
  receiptNumber: string;
  notes?: string | null;
  processedBy?: string | null;
  processedDateTime?: string | null;
  processedDate: string;
  confirmedDate?: string | null;
  balanceAfter?: number | null;
  member: {
    id: string;
    memberId?: string | null;
    name: string;
  };
}

export default function AdminDepositsPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDeposits = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('hn_access_token');
      const res = await fetch('/api/v1/admin/deposits', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load transactions');
      setDeposits((json?.data ?? []) as Deposit[]);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load transactions');
      setDeposits([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDeposits();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: DepositStatus) => {
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
      case 'PROCESSED':
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রক্রিয়াকৃত' : 'Processed'}
          </Badge>
        );
      case 'DISPUTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}
          </Badge>
        );
      case 'REJECTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <XCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}
          </Badge>
        );
    }
  };

  const getTypeBadge = (type: DepositType) => {
    return type === 'DEPOSIT' ? (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        <ArrowDownLeft className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'জমা' : 'Deposit'}
      </Badge>
    ) : (
      <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">
        <ArrowUpRight className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}
      </Badge>
    );
  };

  const filteredDeposits = useMemo(
    () =>
      deposits.filter((deposit) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          deposit.member.name.toLowerCase().includes(q) ||
          (deposit.member.memberId ?? '').toLowerCase().includes(q) ||
          (deposit.processedBy ?? '').toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || deposit.status === statusFilter;
        const matchesType = typeFilter === 'all' || deposit.type === typeFilter;
        return matchesSearch && matchesStatus && matchesType;
      }),
    [deposits, searchQuery, statusFilter, typeFilter],
  );

  const totalDeposits = deposits
    .filter((d) => d.type === 'DEPOSIT' && d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + d.amount, 0);
  const totalWithdrawals = deposits
    .filter((d) => d.type === 'WITHDRAWAL' && d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + d.amount, 0);
  const pendingCount = deposits.filter((d) => d.status === 'PENDING').length;
  const disputedCount = deposits.filter((d) => d.status === 'DISPUTED').length;

  const handleReview = async (tx: Deposit, action: 'approve' | 'reject') => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('hn_access_token');
      const res = await fetch(`/api/v1/admin/deposits/${tx.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to process transaction');
      await loadDeposits();
      if (selectedDeposit?.id === tx.id) {
        setShowDetailModal(false);
        setSelectedDeposit(null);
      }
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to process transaction');
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'জমা ও উত্তোলন' : 'Deposits & Withdrawals'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'সকল সদস্যদের জমা ও উত্তোলন ইতিহাস'
              : 'All member deposits and withdrawals'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadDeposits()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট জমা' : 'Total Deposits'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposits)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট উত্তোলন' : 'Total Withdrawals'}</p>
                <p className="text-2xl font-bold text-purple-600">{formatCurrency(totalWithdrawals)}</p>
              </div>
              <TrendingDown className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</p>
                <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}</p>
                <p className="text-2xl font-bold text-red-600">{disputedCount}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'সদস্য/কর্মী দিয়ে খুঁজুন...' : 'Search by member/processor...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder={locale === 'bn' ? 'ধরন' : 'Type'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</SelectItem>
                <SelectItem value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-44">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
                <SelectItem value="PROCESSED">{locale === 'bn' ? 'প্রক্রিয়াকৃত' : 'Processed'}</SelectItem>
                <SelectItem value="CONFIRMED">{locale === 'bn' ? 'নিশ্চিত' : 'Confirmed'}</SelectItem>
                <SelectItem value="DISPUTED">{locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}</SelectItem>
                <SelectItem value="REJECTED">{locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {locale === 'bn' ? 'লেনদেন তালিকা' : 'Transaction List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredDeposits.length} টি লেনদেন পাওয়া গেছে`
              : `${filteredDeposits.length} transactions found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDeposits.map((deposit) => (
                <div
                  key={deposit.id}
                  className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl ${
                    deposit.status === 'DISPUTED'
                      ? 'bg-red-50'
                      : deposit.status === 'PENDING'
                        ? 'bg-amber-50'
                        : 'bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`h-12 w-12 rounded-full flex items-center justify-center font-semibold ${
                        deposit.type === 'DEPOSIT'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {deposit.type === 'DEPOSIT' ? <ArrowDownLeft className="h-6 w-6" /> : <ArrowUpRight className="h-6 w-6" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">{deposit.member.name}</span>
                        {deposit.member.memberId && <Badge variant="outline">{deposit.member.memberId}</Badge>}
                        {getTypeBadge(deposit.type)}
                        {getStatusBadge(deposit.status)}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p>
                          {locale === 'bn' ? 'পরিমাণ:' : 'Amount:'}{' '}
                          <span className={`font-bold ${deposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}`}>
                            {deposit.type === 'DEPOSIT' ? '+' : '-'}
                            {formatCurrency(deposit.amount)}
                          </span>
                        </p>
                        <p className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {locale === 'bn' ? 'প্রসেসকারী:' : 'Processed by:'} {deposit.processedBy ?? '-'}
                        </p>
                        <p className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(deposit.processedDate).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {deposit.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          disabled={isActionLoading}
                          onClick={() => void handleReview(deposit, 'reject')}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={isActionLoading}
                          onClick={() => void handleReview(deposit, 'approve')}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedDeposit(deposit);
                        setShowDetailModal(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {filteredDeposits.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'লেনদেন বিস্তারিত' : 'Transaction Details'}</DialogTitle>
          </DialogHeader>
          {selectedDeposit && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
                <span className="font-medium">{selectedDeposit.member.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'ধরন' : 'Type'}</span>
                {getTypeBadge(selectedDeposit.type)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span>
                <span className={`font-bold ${selectedDeposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}`}>
                  {selectedDeposit.type === 'DEPOSIT' ? '+' : '-'}
                  {formatCurrency(selectedDeposit.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                {getStatusBadge(selectedDeposit.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'রসিদ' : 'Receipt'}</span>
                <span className="font-medium">{selectedDeposit.receiptNumber}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসকারী' : 'Processed By'}</span>
                <span className="font-medium">{selectedDeposit.processedBy ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসের তারিখ' : 'Processed Date'}</span>
                <span className="font-medium">
                  {new Date(selectedDeposit.processedDate).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}
                </span>
              </div>
              {selectedDeposit.notes && (
                <div className="p-3 bg-slate-100 rounded-lg text-sm">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'নোট:' : 'Note:'}</span> {selectedDeposit.notes}
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
