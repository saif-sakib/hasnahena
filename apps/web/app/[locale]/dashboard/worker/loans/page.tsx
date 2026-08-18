'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  HandCoins,
  Search,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Phone,
  TrendingUp,
  CreditCard,
  Eye,
  Receipt,
  Download,
} from 'lucide-react';
import {
  buildLoanAgreement,
  downloadDocumentPDF,
  fetchOrgSettings,
} from '@/lib/documents';
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
import { formatCurrency, getLoanRepaymentPresets } from '@/lib/utils';
import { apiPost } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type LoanStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'PENDING' | 'DEFAULTED' | string;

interface ActiveLoan {
  id: string;
  loanNumber: string;
  memberUserId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  loanAmount: number;
  remainingAmount: number;
  paidAmount: number;
  installmentsPaid: number;
  totalInstallments: number;
  monthlyInstallment: number;
  status: LoanStatus;
  nextDueDate?: string;
  missedPayments: number;
  guarantorName: string;
}

export default function WorkerLoansPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoan | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // WO-27 — SWR, not an effect. The shaping that used to run inside the loader
  // is a memo over the payload: same arithmetic, no state written.
  const {
    data: loansData,
    isLoading,
    refresh: loadLoans,
  } = useApi<any[]>('/v1/dashboard/worker/loans');

  const loans = useMemo<ActiveLoan[]>(() => {
    const today = new Date();
    return (loansData ?? []).map((loan) => {
      const principalAmount = Number(loan.principalAmount ?? 0);
      const remainingAmount = Number(loan.remainingAmount ?? 0);
      const rawStatus = String(loan.status ?? 'PENDING').toUpperCase();
      const nextDueDate = loan.nextDueDate ? String(loan.nextDueDate) : undefined;

      let status: LoanStatus = rawStatus;
      if (rawStatus === 'PENDING' || rawStatus === 'PENDING_APPROVAL' || rawStatus === 'PENDING_GUARANTOR') {
        status = 'PENDING';
      } else if (rawStatus === 'REJECTED') {
        status = 'PENDING';
      } else if (rawStatus === 'COMPLETED' || rawStatus === 'SETTLED') {
        status = 'COMPLETED';
      } else if (rawStatus === 'DEFAULTED') {
        status = 'DEFAULTED';
      } else {
        status = 'ACTIVE';
        if (nextDueDate && new Date(nextDueDate).getTime() < today.getTime()) {
          status = 'OVERDUE';
        }
      }

      return {
        id: String(loan.id ?? ''),
        loanNumber: String(loan.loanNumber ?? ''),
        memberUserId: String(loan.memberUserId ?? ''),
        memberId: String(loan.memberId ?? ''),
        memberName: String(loan.memberName ?? ''),
        memberPhone: String(loan.memberPhone ?? ''),
        loanAmount: principalAmount,
        remainingAmount,
        paidAmount: Math.max(principalAmount - remainingAmount, 0),
        installmentsPaid: Number(loan.paidInstallments ?? 0),
        totalInstallments: Number(loan.totalInstallments ?? 0),
        monthlyInstallment: Number(loan.installmentAmount ?? 0),
        status,
        nextDueDate,
        missedPayments: status === 'OVERDUE' ? 1 : 0,
        guarantorName: String(loan.guarantorName ?? ''),
      } satisfies ActiveLoan;
    });
  }, [loansData]);

  const handleDownloadLoan = async (loan: ActiveLoan) => {
    try {
      const orgSettings = await fetchOrgSettings();
      const loanDoc = buildLoanAgreement({
        loanNumber: loan.loanNumber,
        memberName: loan.memberName,
        memberId: loan.memberId,
        memberPhone: loan.memberPhone,
        memberAddress: '',
        principalAmount: loan.loanAmount,
        totalInstallments: loan.totalInstallments,
        installmentAmount: loan.monthlyInstallment,
        disbursementDate: undefined,
      }, orgSettings);
      await downloadDocumentPDF(loanDoc);
    } catch (error) {
      console.error('Failed to download loan:', error);
    }
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
      case 'PENDING':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
          </Badge>
        );
      case 'DEFAULTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'খেলাপি' : 'Defaulted'}
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

  const filteredLoans = loans.filter((loan) => {
    const matchesSearch =
      loan.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.memberPhone.includes(searchQuery) ||
      loan.loanNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Summary stats
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE' || l.status === 'OVERDUE').length;
  const overdueLoans = loans.filter((l) => l.status === 'OVERDUE').length;
  const totalOutstanding = loans
    .filter((l) => l.status !== 'COMPLETED')
    .reduce((sum, l) => sum + l.remainingAmount, 0);
  const dueThisWeek = loans.filter((l) => {
    if (!l.nextDueDate || l.status === 'COMPLETED') return false;
    const dueDate = new Date(l.nextDueDate);
    const today = new Date();
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 600);
    return dueDate <= weekFromNow && dueDate >= today;
  }).length;

  const handlePayment = async () => {
    if (!selectedLoan) return;

    const parsedAmount = Number.parseFloat(paymentAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setPaymentError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid payment amount');
      return;
    }
    if (parsedAmount > selectedLoan.remainingAmount) {
      setPaymentError(locale === 'bn' ? 'বাকি পরিমাণের বেশি নয়' : 'Amount exceeds remaining balance');
      return;
    }

    setPaymentError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${selectedLoan.memberUserId}/loan-payment`, {
        loanId: selectedLoan.id,
        amount: Math.round(parsedAmount ),
        notes: paymentNotes.trim(),
      });
      setShowPaymentModal(false);
      setSelectedLoan(null);
      setPaymentAmount('');
      setPaymentNotes('');
      await loadLoans();
    } catch (error: any) {
      setPaymentError(error?.message || (locale === 'bn' ? 'পরিশোধ ব্যর্থ হয়েছে' : 'Payment failed'));
    }
  };

  const openPaymentModal = (loan: ActiveLoan) => {
    setSelectedLoan(loan);
    const presets = getLoanRepaymentPresets(loan.monthlyInstallment, loan.remainingAmount);
    setPaymentAmount(String(presets.monthly));
    setPaymentError(null);
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
        <Card className="rounded-2xl border-slate-200 shadow-xs">
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
        <Card className="rounded-2xl border-red-200 bg-red-50/50 shadow-xs">
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
        <Card className="rounded-2xl border-slate-200 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট বাকি' : 'Total Outstanding'}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalOutstanding, locale)}</p>
              </div>
              <CreditCard className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-amber-200 bg-amber-50/50 shadow-xs">
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
      <Card className="rounded-2xl border-slate-200 shadow-xs">
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
              <SelectTrigger className="w-full md:w-40" aria-label={tA11y('filterByStatus')}>
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="OVERDUE">{locale === 'bn' ? 'বকেয়া' : 'Overdue'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
                <SelectItem value="DEFAULTED">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</SelectItem>
                <SelectItem value="COMPLETED">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Loans List */}
      <Card className="rounded-2xl border-slate-200 shadow-xs">
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
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : (
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
                          {locale === 'bn' ? 'ঋণ নং:' : 'Loan No:'} {loan.loanNumber}
                        </p>
                        <p>
                          {locale === 'bn' ? 'গ্যারান্টর:' : 'Guarantor:'} {loan.guarantorName}
                        </p>
                        {loan.status !== 'COMPLETED' && loan.nextDueDate && (
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
                        {formatCurrency(loan.monthlyInstallment, locale)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDownloadLoan(loan)}
                        title={locale === 'bn' ? 'ঋণ ডাউনলোড' : 'Download Loan'}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedLoan(loan);
                          setShowDetailModal(true);
                        }}
                        title={locale === 'bn' ? 'ঋণের বিবরণ' : 'View Loan Details'}
                        aria-label={locale === 'bn' ? 'ঋণের বিবরণ দেখুন' : 'View loan details'}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {(loan.status === 'ACTIVE' || loan.status === 'OVERDUE') && loan.remainingAmount > 0 && (
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
                  <Progress value={loan.loanAmount > 0 ? (loan.paidAmount / loan.loanAmount) * 100 : 0} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>
                      {locale === 'bn' ? 'পরিশোধিত:' : 'Paid:'} {formatCurrency(loan.paidAmount, locale)}
                    </span>
                    <span>
                      {locale === 'bn' ? 'বাকি:' : 'Remaining:'} {formatCurrency(loan.remainingAmount, locale)}
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
          )}
        </CardContent>
      </Card>

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ কিস্তি গ্রহণ' : 'Accept Loan Payment'}</DialogTitle>
            <DialogDescription>
              {selectedLoan?.memberName} - {locale === 'bn' ? 'ঋণ নং:' : 'Loan No:'} {selectedLoan?.loanNumber}
            </DialogDescription>
          </DialogHeader>

          {selectedLoan && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly Installment'}</span>
                  <span className="font-medium">{formatCurrency(selectedLoan.monthlyInstallment, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি পরিমাণ' : 'Outstanding'}</span>
                  <span className="font-medium">
                    {formatCurrency(selectedLoan.remainingAmount, locale)}
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
                {paymentError && (
                  <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {paymentError}
                  </div>
                )}
                <Label>{locale === 'bn' ? 'পরিশোধের পরিমাণ (টাকা)' : 'Payment Amount (BDT)'}</Label>
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="mt-1"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const presets = getLoanRepaymentPresets(
                        selectedLoan.monthlyInstallment,
                        selectedLoan.remainingAmount,
                      );
                      setPaymentAmount(String(presets.weekly));
                    }}
                  >
                    {locale === 'bn' ? 'সাপ্তাহিক' : 'Weekly'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const presets = getLoanRepaymentPresets(
                        selectedLoan.monthlyInstallment,
                        selectedLoan.remainingAmount,
                      );
                      setPaymentAmount(String(presets.monthly));
                    }}
                  >
                    {locale === 'bn' ? 'মাসিক' : 'Monthly'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount(String(selectedLoan.remainingAmount))}
                  >
                    {locale === 'bn' ? 'সম্পূর্ণ' : 'Full'}
                  </Button>
                </div>
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
                  <p className="font-medium">{selectedLoan.loanNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণের পরিমাণ' : 'Loan Amount'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedLoan.loanAmount, locale)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedLoan.paidAmount, locale)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span>
                  <p className="font-medium text-amber-600">
                    {formatCurrency(selectedLoan.remainingAmount, locale)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly Installment'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.monthlyInstallment, locale)}</p>
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
                {selectedLoan.status !== 'COMPLETED' && selectedLoan.nextDueDate && (
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
                    {selectedLoan.loanAmount > 0 ? ((selectedLoan.paidAmount / selectedLoan.loanAmount) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
                <Progress value={selectedLoan.loanAmount > 0 ? (selectedLoan.paidAmount / selectedLoan.loanAmount) * 100 : 0} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
            {(selectedLoan?.status === 'ACTIVE' || selectedLoan?.status === 'OVERDUE') && selectedLoan.remainingAmount > 0 && (
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
