'use client';

import { useState } from 'react';
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

type DepositStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED';
type DepositType = 'DEPOSIT' | 'WITHDRAWAL';

interface Deposit {
  id: string;
  memberId: string;
  memberName: string;
  type: DepositType;
  amount: number;
  status: DepositStatus;
  processedBy: string;
  processedDate: string;
  confirmedDate?: string;
  balanceAfter: number;
  notes?: string;
}

export default function AdminDepositsPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Mock data
  const deposits: Deposit[] = [
    {
      id: '1',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      type: 'DEPOSIT',
      amount: 5000,
      status: 'CONFIRMED',
      processedBy: 'রফিকুল ইসলাম',
      processedDate: '2025-01-10',
      confirmedDate: '2025-01-10',
      balanceAfter: 85000,
    },
    {
      id: '2',
      memberId: 'm2',
      memberName: 'ফাতেমা বেগম',
      type: 'DEPOSIT',
      amount: 10000,
      status: 'PENDING',
      processedBy: 'কামরুল হাসান',
      processedDate: '2025-01-12',
      balanceAfter: 130000,
    },
    {
      id: '3',
      memberId: 'm3',
      memberName: 'নূর হোসেন',
      type: 'WITHDRAWAL',
      amount: 15000,
      status: 'CONFIRMED',
      processedBy: 'রফিকুল ইসলাম',
      processedDate: '2025-01-08',
      confirmedDate: '2025-01-09',
      balanceAfter: 60000,
    },
    {
      id: '4',
      memberId: 'm4',
      memberName: 'রহিম উদ্দিন',
      type: 'DEPOSIT',
      amount: 3000,
      status: 'DISPUTED',
      processedBy: 'সাইফুল ইসলাম',
      processedDate: '2025-01-07',
      balanceAfter: 48000,
      notes: 'সদস্য ৫০০০ টাকা জমা দিয়েছেন বলে দাবি করেছেন',
    },
    {
      id: '5',
      memberId: 'm5',
      memberName: 'সাদিয়া আক্তার',
      type: 'DEPOSIT',
      amount: 8000,
      status: 'CONFIRMED',
      processedBy: 'কামরুল হাসান',
      processedDate: '2025-01-11',
      confirmedDate: '2025-01-11',
      balanceAfter: 128000,
    },
    {
      id: '6',
      memberId: 'm6',
      memberName: 'জাকির হোসেন',
      type: 'WITHDRAWAL',
      amount: 20000,
      status: 'PENDING',
      processedBy: 'রফিকুল ইসলাম',
      processedDate: '2025-01-13',
      balanceAfter: 55000,
    },
  ];

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
      case 'DISPUTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}
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

  const filteredDeposits = deposits.filter((deposit) => {
    const matchesSearch =
      deposit.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deposit.processedBy.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || deposit.status === statusFilter;
    const matchesType = typeFilter === 'all' || deposit.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  // Summary stats
  const totalDeposits = deposits
    .filter((d) => d.type === 'DEPOSIT' && d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + d.amount, 0);
  const totalWithdrawals = deposits
    .filter((d) => d.type === 'WITHDRAWAL' && d.status === 'CONFIRMED')
    .reduce((sum, d) => sum + d.amount, 0);
  const pendingCount = deposits.filter((d) => d.status === 'PENDING').length;
  const disputedCount = deposits.filter((d) => d.status === 'DISPUTED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
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
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          {locale === 'bn' ? 'রিপোর্ট ডাউনলোড' : 'Download Report'}
        </Button>
      </div>

      {/* Stats Cards */}
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

      {/* Filters */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'সদস্য বা কর্মী দিয়ে খুঁজুন...' : 'Search by member or worker...'}
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
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="CONFIRMED">{locale === 'bn' ? 'নিশ্চিত' : 'Confirmed'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
                <SelectItem value="DISPUTED">{locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Deposits List */}
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
                } hover:bg-opacity-80 transition-colors`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`h-12 w-12 rounded-full flex items-center justify-center font-semibold ${
                      deposit.type === 'DEPOSIT'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {deposit.type === 'DEPOSIT' ? (
                      <ArrowDownLeft className="h-6 w-6" />
                    ) : (
                      <ArrowUpRight className="h-6 w-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{deposit.memberName}</span>
                      {getTypeBadge(deposit.type)}
                      {getStatusBadge(deposit.status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        {locale === 'bn' ? 'পরিমাণ:' : 'Amount:'}{' '}
                        <span
                          className={`font-bold ${
                            deposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'
                          }`}
                        >
                          {deposit.type === 'DEPOSIT' ? '+' : '-'}
                          {formatCurrency(deposit.amount)}
                        </span>
                      </p>
                      <p className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {locale === 'bn' ? 'প্রসেসকারী:' : 'Processed by:'} {deposit.processedBy}
                      </p>
                      <p className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(deposit.processedDate).toLocaleDateString(
                          locale === 'bn' ? 'bn-BD' : 'en-GB'
                        )}
                      </p>
                      {deposit.notes && (
                        <p className="text-red-600">
                          <AlertCircle className="inline h-3 w-3 mr-1" />
                          {deposit.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right text-sm">
                    <p className="text-muted-foreground">
                      {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'}
                    </p>
                    <p className="font-medium">{formatCurrency(deposit.balanceAfter)}</p>
                  </div>
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
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'লেনদেন বিস্তারিত' : 'Transaction Details'}</DialogTitle>
          </DialogHeader>
          {selectedDeposit && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
                <span className="font-medium">{selectedDeposit.memberName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'ধরন' : 'Type'}</span>
                {getTypeBadge(selectedDeposit.type)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span>
                <span
                  className={`font-bold ${
                    selectedDeposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'
                  }`}
                >
                  {selectedDeposit.type === 'DEPOSIT' ? '+' : '-'}
                  {formatCurrency(selectedDeposit.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                {getStatusBadge(selectedDeposit.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসকারী' : 'Processed By'}</span>
                <span className="font-medium">{selectedDeposit.processedBy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসের তারিখ' : 'Processed Date'}</span>
                <span className="font-medium">
                  {new Date(selectedDeposit.processedDate).toLocaleDateString(
                    locale === 'bn' ? 'bn-BD' : 'en-GB'
                  )}
                </span>
              </div>
              {selectedDeposit.confirmedDate && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {locale === 'bn' ? 'নিশ্চিতের তারিখ' : 'Confirmed Date'}
                  </span>
                  <span className="font-medium">
                    {new Date(selectedDeposit.confirmedDate).toLocaleDateString(
                      locale === 'bn' ? 'bn-BD' : 'en-GB'
                    )}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {locale === 'bn' ? 'লেনদেন পরবর্তী ব্যালেন্স' : 'Balance After'}
                </span>
                <span className="font-medium">{formatCurrency(selectedDeposit.balanceAfter)}</span>
              </div>
              {selectedDeposit.notes && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-700">
                    <AlertCircle className="inline h-4 w-4 mr-1" />
                    {selectedDeposit.notes}
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
