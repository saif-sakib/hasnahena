'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  HandCoins,
  Plus,
  Check,
  X,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Users,
  Calendar,
  FileText,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

type LoanStatus = 'PENDING_GUARANTOR' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'REJECTED';

interface Loan {
  id: string;
  loanNumber: string;
  principalAmount: number;
  remainingAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentAmount: number;
  disbursementDate?: string;
  nextDueDate?: string;
  purpose: string;
  status: LoanStatus;
  guarantor?: string;
}

interface GuarantorRequest {
  id: string;
  borrowerName: string;
  loanAmount: number;
  requestDate: string;
}

type AvailableGuarantor = { id: string; name: string; deposit: number };

export default function LoansPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [selectedGuarantor, setSelectedGuarantor] = useState('');
  const [installments, setInstallments] = useState<number>(6);
  const [currentDeposit, setCurrentDeposit] = useState(0);
  const minDepositRequired = 8000;
  const maxLoanMultiplier = 5;
  const maxLoanAmount = currentDeposit * maxLoanMultiplier;
  const isEligible = currentDeposit >= minDepositRequired;
  const [activeLoan, setActiveLoan] = useState<Loan | null>(null);
  const [loanHistory, setLoanHistory] = useState<Loan[]>([]);
  const [guarantorRequests, setGuarantorRequests] = useState<GuarantorRequest[]>([]);
  const [availableGuarantors, setAvailableGuarantors] = useState<AvailableGuarantor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = localStorage.getItem('hn_access_token');
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const data = await apiGet<{
        currentDeposit?: number;
        activeLoan?: Loan | null;
        loanHistory?: Loan[];
        guarantorRequests?: GuarantorRequest[];
        availableGuarantors?: AvailableGuarantor[];
      }>('/v1/dashboard/member/loans');
      setCurrentDeposit(data?.currentDeposit ?? 0);
      setActiveLoan(data?.activeLoan ?? null);
      setLoanHistory(data?.loanHistory ?? []);
      setGuarantorRequests(data?.guarantorRequests ?? []);
      setAvailableGuarantors(data?.availableGuarantors ?? []);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load loans');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);


  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusLabel = (status: LoanStatus) => {
    const labels: Record<LoanStatus, { bn: string; en: string; color: string }> = {
      PENDING_GUARANTOR: { bn: 'জামিনদার অপেক্ষমান', en: 'Awaiting Guarantor', color: 'bg-amber-100 text-amber-700' },
      PENDING_APPROVAL: { bn: 'অনুমোদন অপেক্ষমান', en: 'Pending Approval', color: 'bg-blue-100 text-blue-700' },
      APPROVED: { bn: 'অনুমোদিত', en: 'Approved', color: 'bg-green-100 text-green-700' },
      ACTIVE: { bn: 'সক্রিয়', en: 'Active', color: 'bg-emerald-100 text-emerald-700' },
      COMPLETED: { bn: 'সম্পন্ন', en: 'Completed', color: 'bg-gray-100 text-gray-700' },
      DEFAULTED: { bn: 'খেলাপি', en: 'Defaulted', color: 'bg-red-100 text-red-700' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected', color: 'bg-red-100 text-red-700' },
    };
    return labels[status];
  };

  const handleLoanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      setActionError(null);
      const token = localStorage.getItem('hn_access_token');
      if (!token) {
        router.push(`/${locale}/login`);
        return;
      }

      const amount = Number(loanAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setActionError('Invalid loan amount');
        return;
      }
      if (!loanPurpose.trim()) {
        setActionError('Loan purpose is required');
        return;
      }
      if (!selectedGuarantor) {
        setActionError('Guarantor is required');
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch('/api/v1/loans/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amount,
            installments,
            purpose: loanPurpose,
            guarantorId: selectedGuarantor,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionError(json?.error ?? 'Failed to submit loan application');
          return;
        }

        setShowLoanForm(false);
        setLoanAmount('');
        setLoanPurpose('');
        setSelectedGuarantor('');
        setInstallments(6);
        await refresh();
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  const handleAcceptGuarantor = (requestId: string) => {
    void (async () => {
      setActionError(null);
      const token = localStorage.getItem('hn_access_token');
      if (!token) {
        router.push(`/${locale}/login`);
        return;
      }

      const res = await fetch(`/api/v1/loans/${requestId}/guarantor-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accepted: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error ?? 'Failed to accept guarantor request');
        return;
      }
      await refresh();
    })();
  };

  const handleRejectGuarantor = (requestId: string) => {
    void (async () => {
      setActionError(null);
      const token = localStorage.getItem('hn_access_token');
      if (!token) {
        router.push(`/${locale}/login`);
        return;
      }

      const res = await fetch(`/api/v1/loans/${requestId}/guarantor-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accepted: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json?.error ?? 'Failed to reject guarantor request');
        return;
      }
      await refresh();
    })();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {t('myLoans')}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'আপনার ঋণ পরিচালনা করুন এবং নতুন ঋণের জন্য আবেদন করুন'
              : 'Manage your loans and apply for new loans'}
          </p>
        </div>
        {isEligible && !activeLoan && (
          <Button onClick={() => setShowLoanForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('applyForLoan')}
          </Button>
        )}
      </div>

      {/* Eligibility Card */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            {t('loanEligibility')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">{t('yourDeposit')}</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(currentDeposit, locale)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">{t('minDepositRequired')}</p>
              <p className="text-xl font-bold">{formatCurrency(minDepositRequired, locale)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">{t('maxLoanAmount')}</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(maxLoanAmount, locale)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">{t('status')}</p>
              <p className={`text-xl font-bold ${isEligible ? 'text-green-600' : 'text-red-600'}`}>
                {isEligible
                  ? locale === 'bn'
                    ? 'যোগ্য'
                    : 'Eligible'
                  : locale === 'bn'
                  ? 'অযোগ্য'
                  : 'Not Eligible'}
              </p>
            </div>
          </div>
          {!isEligible && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-800">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {locale === 'bn'
                  ? `ঋণের জন্য আবেদন করতে আপনার আমানত কমপক্ষে ${formatCurrency(minDepositRequired, locale)} হতে হবে।`
                  : `You need at least ${formatCurrency(minDepositRequired, locale)} in deposits to apply for a loan.`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guarantor Requests */}
      {guarantorRequests.length > 0 && (
        <Card className="rounded-2xl border-blue-200 bg-blue-50/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              {t('guarantorRequests')}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'অন্য সদস্যদের জামিনদার হওয়ার অনুরোধ'
                : 'Requests to be a guarantor for other members'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {guarantorRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-white p-4 border border-blue-100"
                >
                  <div>
                    <p className="font-semibold">{request.borrowerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {locale === 'bn' ? 'ঋণের পরিমাণ:' : 'Loan Amount:'} {formatCurrency(request.loanAmount, locale)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn' ? 'অনুরোধের তারিখ:' : 'Request Date:'} {formatDate(request.requestDate)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => handleAcceptGuarantor(request.id)}
                    >
                      <Check className="h-3 w-3" />
                      {t('acceptGuarantor')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-red-600 hover:text-red-700"
                      onClick={() => handleRejectGuarantor(request.id)}
                    >
                      <X className="h-3 w-3" />
                      {t('rejectGuarantor')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loan Application Form */}
      {showLoanForm && (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" />
              {t('applyForLoan')}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'সুদমুক্ত ঋণের জন্য আবেদন করুন'
                : 'Apply for an interest-free loan'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {actionError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </div>
            )}
            <form onSubmit={handleLoanSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="loanAmount">{t('loanAmount')}</Label>
                  <Input
                    id="loanAmount"
                    type="number"
                    placeholder={t('enterAmount')}
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)}
                    min="1000"
                    max={maxLoanAmount}
                    required
                    className="text-lg"
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn' ? 'সর্বোচ্চ:' : 'Maximum:'} {formatCurrency(maxLoanAmount, locale)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="installments">{t('installments')}</Label>
                  <select
                    id="installments"
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                    required
                  >
                    <option value="6">6 {locale === 'bn' ? 'কিস্তি' : 'installments'}</option>
                    <option value="10">10 {locale === 'bn' ? 'কিস্তি' : 'installments'}</option>
                    <option value="12">12 {locale === 'bn' ? 'কিস্তি' : 'installments'}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="purpose">{t('loanPurpose')}</Label>
                <Input
                  id="purpose"
                  type="text"
                  placeholder={locale === 'bn' ? 'ঋণের উদ্দেশ্য লিখুন' : 'Enter loan purpose'}
                  value={loanPurpose}
                  onChange={(e) => setLoanPurpose(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="guarantor">{t('selectGuarantor')}</Label>
                <select
                  id="guarantor"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={selectedGuarantor}
                  onChange={(e) => setSelectedGuarantor(e.target.value)}
                  required
                >
                  <option value="">{locale === 'bn' ? 'জামিনদার নির্বাচন করুন' : 'Select a guarantor'}</option>
                  {availableGuarantors.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({formatCurrency(g.deposit, locale)})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {locale === 'bn'
                    ? 'জামিনদারের আমানত ঋণের পরিমাণের সমান বা বেশি হতে হবে'
                    : "Guarantor's deposit must be equal to or greater than the loan amount"}
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-blue-800">
                <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  {locale === 'bn'
                    ? 'আপনার আবেদন প্রথমে জামিনদারের অনুমোদন, তারপর প্রশাসনের অনুমোদনের জন্য পাঠানো হবে।'
                    : 'Your application will be sent for guarantor approval first, then admin approval.'}
                </p>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="gap-2" disabled={isSubmitting}>
                  <Check className="h-4 w-4" />
                  {t('submitRequest')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowLoanForm(false)}
                >
                  {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Active Loan Card */}
      {activeLoan && (
        <Card className="rounded-2xl border-emerald-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <p className="text-sm opacity-90">{t('activeLoan')}</p>
                <p className="text-2xl font-bold">{activeLoan.loanNumber}</p>
              </div>
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusLabel(activeLoan.status).color}`}>
                {locale === 'bn' ? getStatusLabel(activeLoan.status).bn : getStatusLabel(activeLoan.status).en}
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('loanAmount')}</p>
                <p className="text-xl font-bold">{formatCurrency(activeLoan.principalAmount, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('remainingAmount')}</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(activeLoan.remainingAmount, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('installments')}</p>
                <p className="text-xl font-bold">
                  {activeLoan.paidInstallments}/{activeLoan.totalInstallments}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('installmentAmount')}</p>
                <p className="text-xl font-bold">{formatCurrency(activeLoan.installmentAmount, locale)}</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">
                  {locale === 'bn' ? 'পরিশোধ অগ্রগতি' : 'Repayment Progress'}
                </span>
                <span className="font-medium">
                  {Math.round((activeLoan.paidInstallments / activeLoan.totalInstallments) * 100)}%
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-slate-200">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                  style={{
                    width: `${(activeLoan.paidInstallments / activeLoan.totalInstallments) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 border-t pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('nextInstallment')}</p>
                  <p className="font-medium">{activeLoan.nextDueDate && formatDate(activeLoan.nextDueDate)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('loanPurpose')}</p>
                  <p className="font-medium">{activeLoan.purpose}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{locale === 'bn' ? 'জামিনদার' : 'Guarantor'}</p>
                  <p className="font-medium">{activeLoan.guarantor}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Active Loan */}
      {!activeLoan && (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="py-12 text-center">
            <HandCoins className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('noActiveLoan')}</h3>
            <p className="text-muted-foreground mb-4">
              {locale === 'bn'
                ? 'আপনার কোন সক্রিয় ঋণ নেই। যোগ্য হলে নতুন ঋণের জন্য আবেদন করুন।'
                : 'You have no active loans. Apply for a new loan if eligible.'}
            </p>
            {isEligible && (
              <Button onClick={() => setShowLoanForm(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t('applyForLoan')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loan History */}
      {loanHistory.length > 0 && (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>{t('loanHistory')}</CardTitle>
            <CardDescription>
              {locale === 'bn' ? 'আপনার পূর্ববর্তী ঋণসমূহ' : 'Your previous loans'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {loanHistory.map((loan) => {
                const statusInfo = getStatusLabel(loan.status);
                return (
                  <div
                    key={loan.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-10 w-10 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0">
                        <HandCoins className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{loan.loanNumber}</p>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                          >
                            {locale === 'bn' ? statusInfo.bn : statusInfo.en}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(loan.principalAmount, locale)} • {loan.totalInstallments} {locale === 'bn' ? 'কিস্তি' : 'installments'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {loan.disbursementDate && formatDate(loan.disbursementDate)}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-1">
                      {locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
