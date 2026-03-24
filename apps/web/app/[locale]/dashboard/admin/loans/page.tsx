'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  HandCoins,
  Search,
  Filter,
  Download,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  TrendingUp,
  CreditCard,
  AlertTriangle,
  Users,
  Loader2,
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
} from '@/components/ui/dialog';

type LoanStatus =
  | 'PENDING_GUARANTOR'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SETTLED'
  | 'DEFAULTED'
  | 'REJECTED';

interface Loan {
  id: string;
  loanNumber: string;
  status: LoanStatus;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  installmentsPaid: number;
  totalInstallments: number;
  monthlyInstallment: number;
  purpose: string;
  approvedDate?: string | null;
  disbursedDate?: string | null;
  dueDate?: string | null;
  member: {
    id: string;
    memberId?: string | null;
    name: string;
  };
  guarantor?: { id: string; name: string } | null;
  memberDeposit: number;
  missedPayments: number;
}

export default function AdminLoansPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);

  const loadLoans = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('hn_access_token');
      const res = await fetch('/api/v1/admin/loans', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load loans');
      setLoans((json?.data ?? []) as Loan[]);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load loans');
      setLoans([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLoans();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: LoanStatus) => {
    switch (status) {
      case 'PENDING_GUARANTOR':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'জামিনদার অপেক্ষমাণ' : 'Awaiting Guarantor'}
          </Badge>
        );
      case 'PENDING_APPROVAL':
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অনুমোদন অপেক্ষমাণ' : 'Pending Approval'}
          </Badge>
        );
      case 'APPROVED':
      case 'ACTIVE':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সক্রিয়' : 'Active'}
          </Badge>
        );
      case 'COMPLETED':
      case 'SETTLED':
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
      case 'REJECTED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <XCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}
          </Badge>
        );
    }
  };

  const filteredLoans = useMemo(
    () =>
      loans.filter((loan) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          loan.member.name.toLowerCase().includes(q) ||
          (loan.member.memberId ?? '').toLowerCase().includes(q) ||
          (loan.guarantor?.name ?? '').toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [loans, searchQuery, statusFilter],
  );

  const totalDisbursed = loans
    .filter((l) => ['ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED'].includes(l.status))
    .reduce((sum, l) => sum + l.amount, 0);
  const totalRecovered = loans.reduce((sum, l) => sum + l.paidAmount, 0);
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
  const defaultedLoans = loans.filter((l) => l.status === 'DEFAULTED').length;
  const recoveryRate = totalDisbursed > 0 ? ((totalRecovered / totalDisbursed) * 100).toFixed(1) : '0';

  const handleReview = async (loan: Loan, action: 'approve' | 'reject') => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('hn_access_token');
      const res = await fetch(`/api/v1/admin/loans/${loan.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to review loan');
      await loadLoans();
      if (selectedLoan?.id === loan.id) {
        setShowDetailModal(false);
        setSelectedLoan(null);
      }
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to review loan');
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'ঋণ ব্যবস্থাপনা' : 'Loan Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn' ? 'সকল ঋণ পর্যবেক্ষণ এবং পরিচালনা করুন' : 'Monitor and manage all loans'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadLoans()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

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
              <SelectTrigger className="w-full md:w-56">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="PENDING_GUARANTOR">{locale === 'bn' ? 'জামিনদার অপেক্ষমাণ' : 'Awaiting Guarantor'}</SelectItem>
                <SelectItem value="PENDING_APPROVAL">{locale === 'bn' ? 'অনুমোদন অপেক্ষমাণ' : 'Pending Approval'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="COMPLETED">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</SelectItem>
                <SelectItem value="DEFAULTED">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</SelectItem>
                <SelectItem value="REJECTED">{locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5" />
            {locale === 'bn' ? 'ঋণ তালিকা' : 'Loans List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn' ? `${filteredLoans.length} টি ঋণ পাওয়া গেছে` : `${filteredLoans.length} loans found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {filteredLoans.map((loan) => (
                <div
                  key={loan.id}
                  className={`flex flex-col gap-4 p-4 rounded-xl ${
                    loan.status === 'DEFAULTED'
                      ? 'bg-red-50'
                      : loan.status === 'PENDING_APPROVAL'
                        ? 'bg-amber-50'
                        : 'bg-slate-50'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                        {loan.member.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold">{loan.member.name}</span>
                          {loan.member.memberId && <Badge variant="outline">{loan.member.memberId}</Badge>}
                          {getStatusBadge(loan.status)}
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
                            {locale === 'bn' ? 'গ্যারান্টর:' : 'Guarantor:'} {loan.guarantor?.name ?? '-'}
                            {' • '}
                            {locale === 'bn' ? 'উদ্দেশ্য:' : 'Purpose:'} {loan.purpose || '-'}
                          </p>
                          {loan.disbursedDate && (
                            <p className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {locale === 'bn' ? 'বিতরণ:' : 'Disbursed:'}{' '}
                              {new Date(loan.disbursedDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                            </p>
                          )}
                        </div>

                        {(loan.status === 'ACTIVE' || loan.status === 'DEFAULTED') && (
                          <div className="mt-3">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-muted-foreground">
                                {locale === 'bn' ? 'পরিশোধ অগ্রগতি' : 'Repayment Progress'}
                              </span>
                              <span className="font-medium">
                                {loan.installmentsPaid}/{loan.totalInstallments}
                              </span>
                            </div>
                            <Progress value={loan.amount > 0 ? (loan.paidAmount / loan.amount) * 100 : 0} className="h-2" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {loan.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            disabled={isActionLoading}
                            onClick={() => void handleReview(loan, 'reject')}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                          </Button>
                          <Button size="sm" disabled={isActionLoading} onClick={() => void handleReview(loan, 'approve')}>
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                          </Button>
                        </>
                      )}
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

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ বিস্তারিত' : 'Loan Details'}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-semibold">
                  {selectedLoan.member.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedLoan.member.name}</h3>
                  {getStatusBadge(selectedLoan.status)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণের নম্বর' : 'Loan Number'}</span>
                  <p className="font-medium">{selectedLoan.loanNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণের পরিমাণ' : 'Loan Amount'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedLoan.amount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedLoan.paidAmount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span>
                  <p className="font-medium text-amber-600">{formatCurrency(selectedLoan.remainingAmount)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</span>
                  <p className="font-medium">{selectedLoan.guarantor?.name ?? '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'সদস্যের জমা' : 'Member Deposit'}</span>
                  <p className="font-medium">{formatCurrency(selectedLoan.memberDeposit)}</p>
                </div>
              </div>
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
