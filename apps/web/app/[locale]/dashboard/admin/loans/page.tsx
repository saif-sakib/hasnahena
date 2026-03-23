'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  HandCoins,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Eye,
  TrendingUp,
  CreditCard,
  AlertTriangle,
  Users,
  MoreHorizontal,
  Ban,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';

type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED';

interface Loan {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  paidAmount: number;
  installmentsPaid: number;
  totalInstallments: number;
  monthlyInstallment: number;
  status: LoanStatus;
  guarantorName: string;
  guarantorDeposit: number;
  memberDeposit: number;
  purpose: string;
  approvedDate?: string;
  disbursedDate?: string;
  dueDate?: string;
  lastPaymentDate?: string;
  missedPayments: number;
}

export default function AdminLoansPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDefaultModal, setShowDefaultModal] = useState(false);
  const [defaultNotes, setDefaultNotes] = useState('');

  // Mock data
  const loans: Loan[] = [
    {
      id: '1',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      amount: 100000,
      paidAmount: 45000,
      installmentsPaid: 9,
      totalInstallments: 20,
      monthlyInstallment: 5000,
      status: 'ACTIVE',
      guarantorName: 'ফাতেমা বেগম',
      guarantorDeposit: 120000,
      memberDeposit: 85000,
      purpose: 'ব্যবসা সম্প্রসারণ',
      approvedDate: '2024-04-15',
      disbursedDate: '2024-04-20',
      dueDate: '2025-12-20',
      lastPaymentDate: '2025-01-05',
      missedPayments: 0,
    },
    {
      id: '2',
      memberId: 'm2',
      memberName: 'রহিম উদ্দিন',
      amount: 50000,
      paidAmount: 50000,
      installmentsPaid: 10,
      totalInstallments: 10,
      monthlyInstallment: 5000,
      status: 'COMPLETED',
      guarantorName: 'করিম সাহেব',
      guarantorDeposit: 80000,
      memberDeposit: 45000,
      purpose: 'চিকিৎসা খরচ',
      approvedDate: '2024-02-10',
      disbursedDate: '2024-02-15',
      dueDate: '2024-12-15',
      lastPaymentDate: '2024-12-10',
      missedPayments: 0,
    },
    {
      id: '3',
      memberId: 'm3',
      memberName: 'সাদিয়া আক্তার',
      amount: 200000,
      paidAmount: 0,
      installmentsPaid: 0,
      totalInstallments: 24,
      monthlyInstallment: 8334,
      status: 'PENDING',
      guarantorName: 'জামিল হোসেন',
      guarantorDeposit: 150000,
      memberDeposit: 120000,
      purpose: 'গৃহ নির্মাণ',
      missedPayments: 0,
    },
    {
      id: '4',
      memberId: 'm4',
      memberName: 'জাকির হোসেন',
      amount: 75000,
      paidAmount: 15000,
      installmentsPaid: 3,
      totalInstallments: 15,
      monthlyInstallment: 5000,
      status: 'DEFAULTED',
      guarantorName: 'মোস্তফা কামাল',
      guarantorDeposit: 90000,
      memberDeposit: 75000,
      purpose: 'কৃষি সরঞ্জাম',
      approvedDate: '2024-06-01',
      disbursedDate: '2024-06-05',
      dueDate: '2025-09-05',
      lastPaymentDate: '2024-09-01',
      missedPayments: 4,
    },
    {
      id: '5',
      memberId: 'm5',
      memberName: 'শামিমা বেগম',
      amount: 80000,
      paidAmount: 32000,
      installmentsPaid: 8,
      totalInstallments: 20,
      monthlyInstallment: 4000,
      status: 'ACTIVE',
      guarantorName: 'রাজিয়া সুলতানা',
      guarantorDeposit: 100000,
      memberDeposit: 80000,
      purpose: 'সেলাই মেশিন ব্যবসা',
      approvedDate: '2024-05-20',
      disbursedDate: '2024-05-25',
      dueDate: '2026-01-25',
      lastPaymentDate: '2025-01-12',
      missedPayments: 0,
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
      case 'PENDING':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
          </Badge>
        );
      case 'APPROVED':
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অনুমোদিত' : 'Approved'}
          </Badge>
        );
      case 'ACTIVE':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <TrendingUp className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সক্রিয়' : 'Active'}
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সম্পন্ন' : 'Completed'}
          </Badge>
        );
      case 'DEFAULTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'খেলাপি' : 'Defaulted'}
          </Badge>
        );
    }
  };

  const filteredLoans = loans.filter((loan) => {
    const matchesSearch =
      loan.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.guarantorName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Summary stats
  const totalDisbursed = loans
    .filter((l) => ['ACTIVE', 'COMPLETED', 'DEFAULTED'].includes(l.status))
    .reduce((sum, l) => sum + l.amount, 0);
  const totalRecovered = loans.reduce((sum, l) => sum + l.paidAmount, 0);
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
  const defaultedLoans = loans.filter((l) => l.status === 'DEFAULTED').length;
  const recoveryRate = totalDisbursed > 0 ? ((totalRecovered / totalDisbursed) * 100).toFixed(1) : 0;

  const handleDefaultSettlement = () => {
    // In a real app, this would trigger the default settlement waterfall:
    // 1. Deduct from borrower's deposit
    // 2. If insufficient, deduct from guarantor's deposit
    // 3. If still insufficient, use donation pool
    console.log('Processing default settlement for loan:', selectedLoan?.id, 'Notes:', defaultNotes);
    setShowDefaultModal(false);
    setSelectedLoan(null);
    setDefaultNotes('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'ঋণ ব্যবস্থাপনা' : 'Loan Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'সকল ঋণ পর্যবেক্ষণ এবং পরিচালনা করুন'
              : 'Monitor and manage all loans'}
          </p>
        </div>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          {locale === 'bn' ? 'রিপোর্ট ডাউনলোড' : 'Download Report'}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট বিতরণ' : 'Total Disbursed'}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalDisbursed)}</p>
              </div>
              <CreditCard className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট পুনরুদ্ধার' : 'Total Recovered'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(totalRecovered)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
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
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</p>
                <p className="text-2xl font-bold text-red-600">{defaultedLoans}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'পুনরুদ্ধার হার' : 'Recovery Rate'}</p>
                <p className="text-2xl font-bold text-green-600">{recoveryRate}%</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
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
                placeholder={locale === 'bn' ? 'সদস্য বা গ্যারান্টর দিয়ে খুঁজুন...' : 'Search by member or guarantor...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
                <SelectItem value="APPROVED">{locale === 'bn' ? 'অনুমোদিত' : 'Approved'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="COMPLETED">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</SelectItem>
                <SelectItem value="DEFAULTED">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</SelectItem>
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
            {locale === 'bn' ? 'ঋণ তালিকা' : 'Loans List'}
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
                  loan.status === 'DEFAULTED'
                    ? 'bg-red-50'
                    : loan.status === 'PENDING'
                      ? 'bg-amber-50'
                      : 'bg-slate-50'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                      {loan.memberName.charAt(0)}
                    </div>
                    <div className="flex-1">
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
                        <p>
                          {locale === 'bn' ? 'ঋণ:' : 'Loan:'}{' '}
                          <span className="font-bold text-blue-600">{formatCurrency(loan.amount)}</span>
                          {' • '}
                          {locale === 'bn' ? 'মাসিক কিস্তি:' : 'Monthly:'}{' '}
                          <span className="font-medium">{formatCurrency(loan.monthlyInstallment)}</span>
                        </p>
                        <p>
                          <Users className="inline h-3 w-3 mr-1" />
                          {locale === 'bn' ? 'গ্যারান্টর:' : 'Guarantor:'} {loan.guarantorName}
                          {' • '}
                          {locale === 'bn' ? 'উদ্দেশ্য:' : 'Purpose:'} {loan.purpose}
                        </p>
                        {loan.disbursedDate && (
                          <p className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {locale === 'bn' ? 'বিতরণ:' : 'Disbursed:'}{' '}
                            {new Date(loan.disbursedDate).toLocaleDateString(
                              locale === 'bn' ? 'bn-BD' : 'en-GB'
                            )}
                            {loan.dueDate && (
                              <>
                                {' • '}
                                {locale === 'bn' ? 'মেয়াদ:' : 'Due:'}{' '}
                                {new Date(loan.dueDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                              </>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Progress bar for active loans */}
                      {(loan.status === 'ACTIVE' || loan.status === 'DEFAULTED') && (
                        <div className="mt-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted-foreground">
                              {locale === 'bn' ? 'পরিশোধ অগ্রগতি' : 'Repayment Progress'}
                            </span>
                            <span className="font-medium">
                              {loan.installmentsPaid}/{loan.totalInstallments}{' '}
                              {locale === 'bn' ? 'কিস্তি' : 'installments'}
                            </span>
                          </div>
                          <Progress
                            value={(loan.paidAmount / loan.amount) * 100}
                            className="h-2"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>
                              {locale === 'bn' ? 'পরিশোধিত:' : 'Paid:'} {formatCurrency(loan.paidAmount)}
                            </span>
                            <span>
                              {locale === 'bn' ? 'বাকি:' : 'Remaining:'}{' '}
                              {formatCurrency(loan.amount - loan.paidAmount)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedLoan(loan);
                        setShowDetailModal(true);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      {locale === 'bn' ? 'দেখুন' : 'View'}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {loan.status === 'PENDING' && (
                          <>
                            <DropdownMenuItem className="text-green-600">
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600">
                              <XCircle className="h-4 w-4 mr-2" />
                              {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                            </DropdownMenuItem>
                          </>
                        )}
                        {loan.status === 'ACTIVE' && loan.missedPayments >= 3 && (
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setSelectedLoan(loan);
                              setShowDefaultModal(true);
                            }}
                          >
                            <Ban className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'খেলাপি ঘোষণা' : 'Mark Defaulted'}
                          </DropdownMenuItem>
                        )}
                        {loan.status === 'DEFAULTED' && (
                          <DropdownMenuItem
                            className="text-amber-600"
                            onClick={() => {
                              setSelectedLoan(loan);
                              setShowDefaultModal(true);
                            }}
                          >
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'নিষ্পত্তি প্রক্রিয়া' : 'Settlement Process'}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  {getStatusBadge(selectedLoan.status)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণের পরিমাণ' : 'Loan Amount'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedLoan.amount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly Installment'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.monthlyInstallment)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'পরিশোধিত' : 'Paid Amount'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedLoan.paidAmount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span>
                  <p className="font-medium text-amber-600">
                    {formatCurrency(selectedLoan.amount - selectedLoan.paidAmount)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</span>
                  <p className="font-medium">{selectedLoan.guarantorName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'গ্যারান্টরের জমা' : 'Guarantor Deposit'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.guarantorDeposit)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'সদস্যের জমা' : 'Member Deposit'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.memberDeposit)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</span>
                  <p className="font-medium">{selectedLoan.purpose}</p>
                </div>
                {selectedLoan.approvedDate && (
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'অনুমোদনের তারিখ' : 'Approved Date'}</span>
                    <p className="font-medium">
                      {new Date(selectedLoan.approvedDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                    </p>
                  </div>
                )}
                {selectedLoan.disbursedDate && (
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'বিতরণের তারিখ' : 'Disbursed Date'}</span>
                    <p className="font-medium">
                      {new Date(selectedLoan.disbursedDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                    </p>
                  </div>
                )}
              </div>

              {(selectedLoan.status === 'ACTIVE' || selectedLoan.status === 'DEFAULTED') && (
                <div className="p-3 bg-slate-100 rounded-lg">
                  <div className="flex justify-between text-sm mb-2">
                    <span>{locale === 'bn' ? 'কিস্তি অগ্রগতি' : 'Installment Progress'}</span>
                    <span className="font-medium">
                      {selectedLoan.installmentsPaid}/{selectedLoan.totalInstallments}
                    </span>
                  </div>
                  <Progress value={(selectedLoan.installmentsPaid / selectedLoan.totalInstallments) * 100} />
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

      {/* Default Settlement Modal */}
      <Dialog open={showDefaultModal} onOpenChange={setShowDefaultModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === 'bn' ? 'খেলাপি নিষ্পত্তি' : 'Default Settlement'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? 'এই প্রক্রিয়া নিম্নলিখিত ক্রমে ঋণ আদায় করবে:'
                : 'This process will recover the loan in the following order:'}
            </DialogDescription>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between p-2 bg-slate-50 rounded">
                  <span>1. {locale === 'bn' ? 'ঋণগ্রহীতার জমা থেকে' : 'From borrower deposit'}</span>
                  <span className="font-medium">{formatCurrency(selectedLoan.memberDeposit)}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-slate-50 rounded">
                  <span>2. {locale === 'bn' ? 'গ্যারান্টরের জমা থেকে' : 'From guarantor deposit'}</span>
                  <span className="font-medium">{formatCurrency(selectedLoan.guarantorDeposit)}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-amber-50 rounded">
                  <span>3. {locale === 'bn' ? 'দান তহবিল থেকে' : 'From donation pool'}</span>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'প্রয়োজনে' : 'If needed'}</span>
                </div>
              </div>

              <div className="p-3 bg-red-50 rounded-lg">
                <p className="text-sm text-red-700">
                  <AlertTriangle className="inline h-4 w-4 mr-1" />
                  {locale === 'bn'
                    ? `বাকি পরিমাণ: ${formatCurrency(selectedLoan.amount - selectedLoan.paidAmount)}`
                    : `Outstanding amount: ${formatCurrency(selectedLoan.amount - selectedLoan.paidAmount)}`}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">
                  {locale === 'bn' ? 'নোট' : 'Notes'}
                </label>
                <Textarea
                  placeholder={locale === 'bn' ? 'নিষ্পত্তির বিবরণ...' : 'Settlement details...'}
                  value={defaultNotes}
                  onChange={(e) => setDefaultNotes(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDefaultModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={handleDefaultSettlement}>
              {locale === 'bn' ? 'নিষ্পত্তি শুরু করুন' : 'Start Settlement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
