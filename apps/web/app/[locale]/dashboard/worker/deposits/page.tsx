'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Wallet,
  Search,
  Plus,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

type TransactionType = 'DEPOSIT' | 'WITHDRAWAL';
type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED';

interface DepositTransaction {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  processedDate: string;
  confirmedDate?: string;
  balanceAfter: number;
  notes?: string;
}

interface Member {
  id: string;
  name: string;
  phone: string;
  currentDeposit: number;
}

export default function WorkerDepositsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewDepositModal, setShowNewDepositModal] = useState(false);
  const [showNewWithdrawalModal, setShowNewWithdrawalModal] = useState(false);

  // Form state
  const [selectedMember, setSelectedMember] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Mock data
  const transactions: DepositTransaction[] = [
    {
      id: '1',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      memberPhone: '01712345678',
      type: 'DEPOSIT',
      amount: 5000,
      status: 'CONFIRMED',
      processedDate: '2025-01-14T10:30:00',
      confirmedDate: '2025-01-14T10:35:00',
      balanceAfter: 85000,
    },
    {
      id: '2',
      memberId: 'm2',
      memberName: 'ফাতেমা বেগম',
      memberPhone: '01812345678',
      type: 'DEPOSIT',
      amount: 10000,
      status: 'PENDING',
      processedDate: '2025-01-14T09:15:00',
      balanceAfter: 130000,
    },
    {
      id: '3',
      memberId: 'm3',
      memberName: 'রহিম উদ্দিন',
      memberPhone: '01912345678',
      type: 'WITHDRAWAL',
      amount: 15000,
      status: 'CONFIRMED',
      processedDate: '2025-01-13T14:20:00',
      confirmedDate: '2025-01-13T14:30:00',
      balanceAfter: 30000,
    },
    {
      id: '4',
      memberId: 'm4',
      memberName: 'সাদিয়া আক্তার',
      memberPhone: '01612345678',
      type: 'DEPOSIT',
      amount: 8000,
      status: 'DISPUTED',
      processedDate: '2025-01-12T11:00:00',
      balanceAfter: 103000,
      notes: 'সদস্য ১০,০০০ টাকা দিয়েছেন বলে দাবি করেছেন',
    },
    {
      id: '5',
      memberId: 'm5',
      memberName: 'জাকির হোসেন',
      memberPhone: '01512345678',
      type: 'DEPOSIT',
      amount: 3000,
      status: 'CONFIRMED',
      processedDate: '2025-01-11T16:45:00',
      confirmedDate: '2025-01-11T17:00:00',
      balanceAfter: 78000,
    },
  ];

  const members: Member[] = [
    { id: 'm1', name: 'আব্দুল করিম', phone: '01712345678', currentDeposit: 85000 },
    { id: 'm2', name: 'ফাতেমা বেগম', phone: '01812345678', currentDeposit: 120000 },
    { id: 'm3', name: 'রহিম উদ্দিন', phone: '01912345678', currentDeposit: 45000 },
    { id: 'm4', name: 'সাদিয়া আক্তার', phone: '01612345678', currentDeposit: 95000 },
    { id: 'm5', name: 'জাকির হোসেন', phone: '01512345678', currentDeposit: 75000 },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
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

  const getTypeBadge = (type: TransactionType) => {
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

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch =
      t.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.memberPhone.includes(searchQuery);
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'deposits' && t.type === 'DEPOSIT') ||
      (activeTab === 'withdrawals' && t.type === 'WITHDRAWAL') ||
      (activeTab === 'pending' && t.status === 'PENDING') ||
      (activeTab === 'disputed' && t.status === 'DISPUTED');
    return matchesSearch && matchesTab;
  });

  // Summary stats
  const todayDeposits = transactions
    .filter((t) => t.type === 'DEPOSIT' && t.status === 'CONFIRMED')
    .reduce((sum, t) => sum + t.amount, 0);
  const todayWithdrawals = transactions
    .filter((t) => t.type === 'WITHDRAWAL' && t.status === 'CONFIRMED')
    .reduce((sum, t) => sum + t.amount, 0);
  const pendingCount = transactions.filter((t) => t.status === 'PENDING').length;
  const disputedCount = transactions.filter((t) => t.status === 'DISPUTED').length;

  const handleNewDeposit = () => {
    console.log('New deposit:', { memberId: selectedMember, amount, notes });
    setShowNewDepositModal(false);
    resetForm();
  };

  const handleNewWithdrawal = () => {
    console.log('New withdrawal:', { memberId: selectedMember, amount, notes });
    setShowNewWithdrawalModal(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedMember('');
    setAmount('');
    setNotes('');
  };

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
              ? 'সদস্যদের জমা ও উত্তোলন প্রসেস করুন'
              : 'Process member deposits and withdrawals'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowNewWithdrawalModal(true)}>
            <ArrowUpRight className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}
          </Button>
          <Button onClick={() => setShowNewDepositModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'জমা গ্রহণ' : 'Accept Deposit'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'আজকের জমা' : "Today's Deposits"}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(todayDeposits)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'আজকের উত্তোলন' : "Today's Withdrawals"}</p>
                <p className="text-2xl font-bold text-purple-600">{formatCurrency(todayWithdrawals)}</p>
              </div>
              <ArrowUpRight className="h-8 w-8 text-purple-600" />
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

      {/* Tabs and Search */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <TabsList>
            <TabsTrigger value="all">{locale === 'bn' ? 'সব' : 'All'}</TabsTrigger>
            <TabsTrigger value="deposits">{locale === 'bn' ? 'জমা' : 'Deposits'}</TabsTrigger>
            <TabsTrigger value="withdrawals">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'}</TabsTrigger>
            <TabsTrigger value="pending">
              {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
              {pendingCount > 0 && <Badge className="ml-1" variant="secondary">{pendingCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="disputed">
              {locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}
              {disputedCount > 0 && <Badge className="ml-1 bg-red-100 text-red-700">{disputedCount}</Badge>}
            </TabsTrigger>
          </TabsList>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === 'bn' ? 'সদস্য খুঁজুন...' : 'Search member...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Transactions List */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {locale === 'bn' ? 'লেনদেন তালিকা' : 'Transaction List'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? `${filteredTransactions.length} টি লেনদেন`
                : `${filteredTransactions.length} transactions`}
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
                        transaction.type === 'DEPOSIT'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {transaction.type === 'DEPOSIT' ? (
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
                          <Calendar className="h-3 w-3" /> {formatTime(transaction.processedDate)}
                        </p>
                        {transaction.notes && (
                          <p className="text-red-600 text-xs mt-1">
                            <AlertCircle className="inline h-3 w-3 mr-1" />
                            {transaction.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <p
                      className={`text-xl font-bold ${
                        transaction.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'
                      }`}
                    >
                      {transaction.type === 'DEPOSIT' ? '+' : '-'}
                      {formatCurrency(transaction.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'} {formatCurrency(transaction.balanceAfter)}
                    </p>
                  </div>
                </div>
              ))}

              {filteredTransactions.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Wallet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </Tabs>

      {/* New Deposit Modal */}
      <Dialog open={showNewDepositModal} onOpenChange={setShowNewDepositModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'নতুন জমা গ্রহণ' : 'Accept New Deposit'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? 'সদস্যের কাছ থেকে জমা গ্রহণ করুন' : 'Accept deposit from member'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{locale === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Select Member'}</Label>
              <Select value={selectedMember} onValueChange={setSelectedMember}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={locale === 'bn' ? 'সদস্য নির্বাচন...' : 'Select member...'} />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} ({member.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedMember && (
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'বর্তমান জমা:' : 'Current Deposit:'}{' '}
                  <span className="font-medium text-green-600">
                    {formatCurrency(members.find((m) => m.id === selectedMember)?.currentDeposit || 0)}
                  </span>
                </p>
              </div>
            )}
            <div>
              <Label>{locale === 'bn' ? 'জমার পরিমাণ (টাকা)' : 'Deposit Amount (BDT)'}</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional notes...'}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDepositModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleNewDeposit} disabled={!selectedMember || !amount}>
              {locale === 'bn' ? 'জমা গ্রহণ করুন' : 'Accept Deposit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Withdrawal Modal */}
      <Dialog open={showNewWithdrawalModal} onOpenChange={setShowNewWithdrawalModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'উত্তোলন প্রসেস' : 'Process Withdrawal'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? 'সদস্যের উত্তোলন প্রসেস করুন' : 'Process member withdrawal'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{locale === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Select Member'}</Label>
              <Select value={selectedMember} onValueChange={setSelectedMember}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={locale === 'bn' ? 'সদস্য নির্বাচন...' : 'Select member...'} />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} ({member.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedMember && (
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'উত্তোলনযোগ্য:' : 'Available:'}{' '}
                  <span className="font-medium text-green-600">
                    {formatCurrency(members.find((m) => m.id === selectedMember)?.currentDeposit || 0)}
                  </span>
                </p>
              </div>
            )}
            <div>
              <Label>{locale === 'bn' ? 'উত্তোলনের পরিমাণ (টাকা)' : 'Withdrawal Amount (BDT)'}</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={locale === 'bn' ? 'উত্তোলনের কারণ...' : 'Reason for withdrawal...'}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWithdrawalModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleNewWithdrawal} disabled={!selectedMember || !amount}>
              {locale === 'bn' ? 'উত্তোলন প্রসেস' : 'Process Withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
