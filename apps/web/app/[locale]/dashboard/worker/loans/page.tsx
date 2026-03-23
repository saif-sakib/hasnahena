'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  HandCoins,
  Search,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Phone,
  TrendingUp,
  CreditCard,
  Plus,
  Eye,
  Receipt,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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

type LoanStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED';

interface ActiveLoan {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  loanAmount: number;
  paidAmount: number;
  installmentsPaid: number;
  totalInstallments: number;
  monthlyInstallment: number;
  status: LoanStatus;
  nextDueDate: string;
  missedPayments: number;
  guarantorName: string;
}

export default function WorkerLoansPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoan | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Mock data
  const loans: ActiveLoan[] = [
    {
      id: 'L001',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      memberPhone: '01712345678',
      loanAmount: 100000,
      paidAmount: 45000,
      installmentsPaid: 9,
      totalInstallments: 20,
      monthlyInstallment: 5000,
      status: 'ACTIVE',
      nextDueDate: '2025-01-20',
      missedPayments: 0,
      guarantorName: 'ফাতেমা বেগম',
    },
    {
      id: 'L002',
      memberId: 'm3',
      memberName: 'রহিম উদ্দিন',
      memberPhone: '01912345678',
      loanAmount: 50000,
      paidAmount: 20000,
      installmentsPaid: 4,
      totalInstallments: 10,
      monthlyInstallment: 5000,
      status: 'OVERDUE',
      nextDueDate: '2025-01-05',
      missedPayments: 2,
      guarantorName: 'জাকির হোসেন',
    },
    {
      id: 'L003',
      memberId: 'm4',
      memberName: 'সাদিয়া আক্তার',
      memberPhone: '01612345678',
      loanAmount: 80000,
      paidAmount: 32000,
      installmentsPaid: 8,
      totalInstallments: 20,
      monthlyInstallment: 4000,
      status: 'ACTIVE',
      nextDueDate: '2025-01-25',
      missedPayments: 0,
      guarantorName: 'রাজিয়া সুলতানা',
    },
    {
      id: 'L004',
      memberId: 'm5',
      memberName: 'জাকির হোসেন',
      memberPhone: '01512345678',
      loanAmount: 60000,
      paidAmount: 60000,
      installmentsPaid: 12,
      totalInstallments: 12,
      monthlyInstallment: 5000,
      status: 'COMPLETED',
      nextDueDate: '2024-12-15',
      missedPayments: 0,
      guarantorName: 'আব্দুল করিম',
    },
    {
      id: 'L005',
      memberId: 'm6',
      memberName: 'শামিমা বেগম',
      memberPhone: '01312345678',
      loanAmount: 40000,
      paidAmount: 16000,
      installmentsPaid: 4,
      totalInstallments: 10,
      monthlyInstallment: 4000,
      status: 'ACTIVE',
      nextDueDate: '2025-01-18',
      missedPayments: 0,
      guarantorName: 'সাদিয়া আক্তার',
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: LoanStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <TrendingUp className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সক্রিয়' : 'Active'}
          </Badge>
        );
      case 'OVERDUE':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'বকেয়া' : 'Overdue'}
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সম্পন্ন' : 'Completed'}
          </Badge>
        );
    }
  };

  const filteredLoans = loans.filter((loan) => {
    const matchesSearch =
      loan.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.memberPhone.includes(searchQuery) ||
      loan.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Summary stats
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
  const overdueLoans = loans.filter((l) => l.status === 'OVERDUE').length;
  const totalOutstanding = loans
    .filter((l) => l.status !== 'COMPLETED')
    .reduce((sum, l) => sum + (l.loanAmount - l.paidAmount), 0);
  const dueThisWeek = loans.filter((l) => {
    const dueDate = new Date(l.nextDueDate);
    const today = new Date();
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return l.status !== 'COMPLETED' && dueDate <= weekFromNow && dueDate >= today;
  }).length;

  const handlePayment = () => {
    console.log('Processing payment:', {
      loanId: selectedLoan?.id,
      amount: paymentAmount,
      notes: paymentNotes,
    });
    setShowPaymentModal(false);
    setSelectedLoan(null);
    setPaymentAmount('');
    setPaymentNotes('');
  };

  const openPaymentModal = (loan: ActiveLoan) => {
    setSelectedLoan(loan);
    setPaymentAmount(loan.monthlyInstallment.toString());
    setShowPaymentModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payments'}
        </h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'সদস্যদের ঋণ কিস্তি সংগ্রহ করুন'
            : 'Collect loan installments from members'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loans'}</p>
                <p className="text-2xl font-bold">{activeLoans}</p>
              </div>
              <HandCoins className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-red-200 bg-red-50/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'বকেয়া ঋণ' : 'Overdue Loans'}</p>
                <p className="text-2xl font-bold text-red-600">{overdueLoans}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট বাকি' : 'Total Outstanding'}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalOutstanding)}</p>
              </div>
              <CreditCard className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-amber-200 bg-amber-50/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'এই সপ্তাহে বকেয়া' : 'Due This Week'}</p>
                <p className="text-2xl font-bold text-amber-600">{dueThisWeek}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'সদস্য বা ঋণ ID দিয়ে খুঁজুন...' : 'Search by member or loan ID...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="OVERDUE">{locale === 'bn' ? 'বকেয়া' : 'Overdue'}</SelectItem>
                <SelectItem value="COMPLETED">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Loans List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5" />
            {locale === 'bn' ? 'ঋণ তালিকা' : 'Loan List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredLoans.length} টি ঋণ পাওয়া গেছে`
              : `${filteredLoans.length} loans found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredLoans.map((loan) => (
              <div
                key={loan.id}
                className={`flex flex-col gap-4 p-4 rounded-xl ${
                  loan.status === 'OVERDUE'
                    ? 'bg-red-50'
                    : loan.status === 'COMPLETED'
                      ? 'bg-gray-50'
                      : 'bg-slate-50'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                      {loan.memberName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">{loan.memberName}</span>
                        {getStatusBadge(loan.status)}
                        {loan.missedPayments > 0 && (
                          <Badge className="bg-red-100 text-red-700">
                            {loan.missedPayments} {locale === 'bn' ? 'মিসড' : 'missed'}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p className="flex items-center gap-2">
                          <Phone className="h-3 w-3" /> {loan.memberPhone}
                          <span className="mx-1">•</span>
                          {locale === 'bn' ? 'ঋণ ID:' : 'Loan ID:'} {loan.id}
                        </p>
                        <p>
                          {locale === 'bn' ? 'গ্যারান্টর:' : 'Guarantor:'} {loan.guarantorName}
                        </p>
                        {loan.status !== 'COMPLETED' && (
                          <p className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {locale === 'bn' ? 'পরবর্তী বকেয়া:' : 'Next Due:'}{' '}
                            <span className={loan.status === 'OVERDUE' ? 'text-red-600 font-medium' : ''}>
                              {new Date(loan.nextDueDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly'}
                      </p>
                      <p className="text-lg font-bold text-blue-600">
                        {formatCurrency(loan.monthlyInstallment)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedLoan(loan);
                          setShowDetailModal(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {loan.status !== 'COMPLETED' && (
                        <Button size="sm" onClick={() => openPaymentModal(loan)}>
                          <Receipt className="h-4 w-4 mr-1" />
                          {locale === 'bn' ? 'কিস্তি' : 'Payment'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      {locale === 'bn' ? 'পরিশোধ অগ্রগতি' : 'Repayment Progress'}
                    </span>
                    <span className="font-medium">
                      {loan.installmentsPaid}/{loan.totalInstallments} {locale === 'bn' ? 'কিস্তি' : 'installments'}
                    </span>
                  </div>
                  <Progress value={(loan.paidAmount / loan.loanAmount) * 100} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>
                      {locale === 'bn' ? 'পরিশোধিত:' : 'Paid:'} {formatCurrency(loan.paidAmount)}
                    </span>
                    <span>
                      {locale === 'bn' ? 'বাকি:' : 'Remaining:'} {formatCurrency(loan.loanAmount - loan.paidAmount)}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {filteredLoans.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <HandCoins className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{locale === 'bn' ? 'কোনো ঋণ পাওয়া যায়নি' : 'No loans found'}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ কিস্তি গ্রহণ' : 'Accept Loan Payment'}</DialogTitle>
            <DialogDescription>
              {selectedLoan?.memberName} - {locale === 'bn' ? 'ঋণ ID:' : 'Loan ID:'} {selectedLoan?.id}
            </DialogDescription>
          </DialogHeader>

          {selectedLoan && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly Installment'}</span>
                  <span className="font-medium">{formatCurrency(selectedLoan.monthlyInstallment)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি পরিমাণ' : 'Outstanding'}</span>
                  <span className="font-medium">
                    {formatCurrency(selectedLoan.loanAmount - selectedLoan.paidAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'কিস্তি অবস্থা' : 'Installment Status'}</span>
                  <span className="font-medium">
                    {selectedLoan.installmentsPaid}/{selectedLoan.totalInstallments}
                  </span>
                </div>
              </div>

              <div>
                <Label>{locale === 'bn' ? 'পরিশোধের পরিমাণ (টাকা)' : 'Payment Amount (BDT)'}</Label>
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="mt-1"
                />
                {Number(paymentAmount) !== selectedLoan.monthlyInstallment && paymentAmount && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {locale === 'bn'
                      ? 'পরিমাণ মাসিক কিস্তির চেয়ে ভিন্ন'
                      : 'Amount differs from monthly installment'}
                  </p>
                )}
              </div>

              <div>
                <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
                <Textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional notes...'}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handlePayment} disabled={!paymentAmount}>
              {locale === 'bn' ? 'কিস্তি গ্রহণ' : 'Accept Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ বিস্তারিত' : 'Loan Details'}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-semibold">
                  {selectedLoan.memberName.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedLoan.memberName}</h3>
                  <p className="text-sm text-muted-foreground">{selectedLoan.memberPhone}</p>
                  {getStatusBadge(selectedLoan.status)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণ ID' : 'Loan ID'}</span>
                  <p className="font-medium">{selectedLoan.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণের পরিমাণ' : 'Loan Amount'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedLoan.loanAmount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedLoan.paidAmount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span>
                  <p className="font-medium text-amber-600">
                    {formatCurrency(selectedLoan.loanAmount - selectedLoan.paidAmount)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly Installment'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.monthlyInstallment)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'কিস্তি অবস্থা' : 'Installments'}</span>
                  <p className="font-medium">
                    {selectedLoan.installmentsPaid}/{selectedLoan.totalInstallments}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</span>
                  <p className="font-medium">{selectedLoan.guarantorName}</p>
                </div>
                {selectedLoan.status !== 'COMPLETED' && (
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'পরবর্তী বকেয়া' : 'Next Due'}</span>
                    <p className="font-medium">
                      {new Date(selectedLoan.nextDueDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-100 rounded-lg">
                <div className="flex justify-between text-sm mb-2">
                  <span>{locale === 'bn' ? 'অগ্রগতি' : 'Progress'}</span>
                  <span className="font-medium">
                    {((selectedLoan.paidAmount / selectedLoan.loanAmount) * 100).toFixed(1)}%
                  </span>
                </div>
                <Progress value={(selectedLoan.paidAmount / selectedLoan.loanAmount) * 100} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
            {selectedLoan?.status !== 'COMPLETED' && (
              <Button
                onClick={() => {
                  setShowDetailModal(false);
                  openPaymentModal(selectedLoan!);
                }}
              >
                {locale === 'bn' ? 'কিস্তি গ্রহণ' : 'Accept Payment'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
