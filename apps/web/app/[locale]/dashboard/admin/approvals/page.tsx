'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  ClipboardCheck,
  Users,
  HandCoins,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Filter,
  Calendar,
  AlertCircle,
  FileText,
  User,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface RegistrationRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  nidNumber: string;
  area: string;
  requestDate: string;
  documents: string[];
}

interface LoanRequest {
  id: string;
  memberId: string;
  memberName: string;
  requestedAmount: number;
  currentDeposit: number;
  maxEligible: number;
  guarantorId: string;
  guarantorName: string;
  guarantorApproved: boolean;
  purpose: string;
  requestDate: string;
  previousLoans: number;
  repaymentHistory: 'EXCELLENT' | 'GOOD' | 'POOR' | 'NONE';
}

interface WithdrawalRequest {
  id: string;
  memberId: string;
  memberName: string;
  requestedAmount: number;
  currentDeposit: number;
  requestDate: string;
  reason: string;
  hasActiveLoan: boolean;
  isGuarantor: boolean;
  noticePeriodMet: boolean;
}

export default function AdminApprovalsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState('registrations');
  const [selectedRegistration, setSelectedRegistration] = useState<RegistrationRequest | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanRequest | null>(null);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const [approvalReason, setApprovalReason] = useState('');

  // Mock data
  const registrationRequests: RegistrationRequest[] = [
    {
      id: '1',
      name: 'নূর হোসেন',
      email: 'nur.hossain@email.com',
      phone: '01912345678',
      nidNumber: '3456789012345',
      area: 'সিলেট',
      requestDate: '2025-01-10',
      documents: ['NID', 'Photo', 'Address Proof'],
    },
    {
      id: '2',
      name: 'মোহাম্মদ আলী',
      email: 'mohammad.ali@email.com',
      phone: '01412345678',
      nidNumber: '6789012345678',
      area: 'বরিশাল',
      requestDate: '2025-01-12',
      documents: ['NID', 'Photo'],
    },
  ];

  const loanRequests: LoanRequest[] = [
    {
      id: '1',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      requestedAmount: 100000,
      currentDeposit: 85000,
      maxEligible: 425000,
      guarantorId: 'g1',
      guarantorName: 'ফাতেমা বেগম',
      guarantorApproved: true,
      purpose: 'ব্যবসা সম্প্রসারণ',
      requestDate: '2025-01-08',
      previousLoans: 2,
      repaymentHistory: 'EXCELLENT',
    },
    {
      id: '2',
      memberId: 'm2',
      memberName: 'রহিম উদ্দিন',
      requestedAmount: 50000,
      currentDeposit: 45000,
      maxEligible: 225000,
      guarantorId: 'g2',
      guarantorName: 'করিম সাহেব',
      guarantorApproved: false,
      purpose: 'চিকিৎসা খরচ',
      requestDate: '2025-01-11',
      previousLoans: 1,
      repaymentHistory: 'GOOD',
    },
    {
      id: '3',
      memberId: 'm3',
      memberName: 'সাদিয়া আক্তার',
      requestedAmount: 200000,
      currentDeposit: 120000,
      maxEligible: 600000,
      guarantorId: 'g3',
      guarantorName: 'জামিল হোসেন',
      guarantorApproved: true,
      purpose: 'গৃহ নির্মাণ',
      requestDate: '2025-01-05',
      previousLoans: 0,
      repaymentHistory: 'NONE',
    },
  ];

  const withdrawalRequests: WithdrawalRequest[] = [
    {
      id: '1',
      memberId: 'm4',
      memberName: 'জাকির হোসেন',
      requestedAmount: 30000,
      currentDeposit: 75000,
      requestDate: '2025-01-01',
      reason: 'জরুরি চিকিৎসা',
      hasActiveLoan: false,
      isGuarantor: false,
      noticePeriodMet: true,
    },
    {
      id: '2',
      memberId: 'm5',
      memberName: 'শামিমা বেগম',
      requestedAmount: 50000,
      currentDeposit: 80000,
      requestDate: '2025-01-10',
      reason: 'সন্তানের শিক্ষা',
      hasActiveLoan: false,
      isGuarantor: true,
      noticePeriodMet: false,
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getRepaymentBadge = (history: LoanRequest['repaymentHistory']) => {
    const colors = {
      EXCELLENT: 'bg-green-100 text-green-700',
      GOOD: 'bg-blue-100 text-blue-700',
      POOR: 'bg-red-100 text-red-700',
      NONE: 'bg-gray-100 text-gray-700',
    };
    const labels = {
      EXCELLENT: locale === 'bn' ? 'চমৎকার' : 'Excellent',
      GOOD: locale === 'bn' ? 'ভালো' : 'Good',
      POOR: locale === 'bn' ? 'দুর্বল' : 'Poor',
      NONE: locale === 'bn' ? 'নতুন' : 'New',
    };
    return <Badge className={colors[history]}>{labels[history]}</Badge>;
  };

  const pendingCounts = {
    registrations: registrationRequests.length,
    loans: loanRequests.filter((l) => l.guarantorApproved).length,
    withdrawals: withdrawalRequests.length,
  };

  const handleApproval = (action: 'approve' | 'reject') => {
    setApprovalAction(action);
    setApprovalReason('');
    setShowApprovalModal(true);
  };

  const confirmApproval = () => {
    const type = selectedRegistration ? 'registration' : selectedLoan ? 'loan' : 'withdrawal';
    const id = selectedRegistration?.id || selectedLoan?.id || selectedWithdrawal?.id;
    console.log(`${approvalAction} ${type} ${id}: ${approvalReason}`);
    setShowApprovalModal(false);
    setSelectedRegistration(null);
    setSelectedLoan(null);
    setSelectedWithdrawal(null);
    setApprovalReason('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {locale === 'bn' ? 'অনুমোদন' : 'Approvals'}
        </h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'নিবন্ধন, ঋণ এবং উত্তোলন অনুরোধ অনুমোদন করুন'
            : 'Approve registration, loan, and withdrawal requests'}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          className={`cursor-pointer transition-all ${activeTab === 'registrations' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('registrations')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}
                </p>
                <p className="text-2xl font-bold">{pendingCounts.registrations}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                <Users className="h-6 w-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all ${activeTab === 'loans' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('loans')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'ঋণ অনুরোধ' : 'Loan Requests'}
                </p>
                <p className="text-2xl font-bold">{pendingCounts.loans}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <HandCoins className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all ${activeTab === 'withdrawals' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('withdrawals')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'উত্তোলন অনুরোধ' : 'Withdrawal Requests'}
                </p>
                <p className="text-2xl font-bold">{pendingCounts.withdrawals}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <Wallet className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="registrations" className="gap-2">
            <Users className="h-4 w-4" />
            {locale === 'bn' ? 'নিবন্ধন' : 'Registrations'}
            {pendingCounts.registrations > 0 && (
              <Badge variant="secondary">{pendingCounts.registrations}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="loans" className="gap-2">
            <HandCoins className="h-4 w-4" />
            {locale === 'bn' ? 'ঋণ' : 'Loans'}
            {pendingCounts.loans > 0 && <Badge variant="secondary">{pendingCounts.loans}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="gap-2">
            <Wallet className="h-4 w-4" />
            {locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'}
            {pendingCounts.withdrawals > 0 && (
              <Badge variant="secondary">{pendingCounts.withdrawals}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Registration Requests */}
        <TabsContent value="registrations">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                {locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'নতুন সদস্যদের নিবন্ধন অনুমোদন করুন'
                  : 'Approve new member registrations'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {registrationRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold">
                        {request.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{request.name}</span>
                          <Badge className="bg-amber-100 text-amber-700">
                            <Clock className="h-3 w-3 mr-1" />
                            {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>
                            {request.email} • {request.phone}
                          </p>
                          <p>
                            NID: {request.nidNumber} • {locale === 'bn' ? 'এলাকা:' : 'Area:'}{' '}
                            {request.area}
                          </p>
                          <p className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(request.requestDate).toLocaleDateString(
                              locale === 'bn' ? 'bn-BD' : 'en-GB'
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedRegistration(request);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {locale === 'bn' ? 'দেখুন' : 'View'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          setSelectedRegistration(request);
                          handleApproval('reject');
                        }}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedRegistration(request);
                          handleApproval('approve');
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                      </Button>
                    </div>
                  </div>
                ))}

                {registrationRequests.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{locale === 'bn' ? 'কোনো অপেক্ষমাণ নিবন্ধন নেই' : 'No pending registrations'}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Loan Requests */}
        <TabsContent value="loans">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HandCoins className="h-5 w-5" />
                {locale === 'bn' ? 'ঋণ অনুরোধ' : 'Loan Requests'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'গ্যারান্টর অনুমোদিত ঋণ অনুরোধ পর্যালোচনা করুন'
                  : 'Review guarantor-approved loan requests'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {loanRequests.map((request) => (
                  <div
                    key={request.id}
                    className={`flex flex-col gap-4 p-4 rounded-xl ${request.guarantorApproved ? 'bg-slate-50' : 'bg-amber-50'}`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold">
                          {request.memberName.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold">{request.memberName}</span>
                            {getRepaymentBadge(request.repaymentHistory)}
                            {!request.guarantorApproved && (
                              <Badge className="bg-amber-100 text-amber-700">
                                <Clock className="h-3 w-3 mr-1" />
                                {locale === 'bn' ? 'গ্যারান্টর অপেক্ষমাণ' : 'Guarantor Pending'}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <p>
                              {locale === 'bn' ? 'অনুরোধিত:' : 'Requested:'}{' '}
                              <span className="font-medium text-blue-600">
                                {formatCurrency(request.requestedAmount)}
                              </span>{' '}
                              • {locale === 'bn' ? 'জমা:' : 'Deposit:'}{' '}
                              <span className="font-medium text-green-600">
                                {formatCurrency(request.currentDeposit)}
                              </span>
                            </p>
                            <p>
                              {locale === 'bn' ? 'সর্বোচ্চ যোগ্য:' : 'Max Eligible:'}{' '}
                              {formatCurrency(request.maxEligible)} •{' '}
                              {locale === 'bn' ? 'আগের ঋণ:' : 'Previous Loans:'} {request.previousLoans}
                            </p>
                            <p>
                              {locale === 'bn' ? 'গ্যারান্টর:' : 'Guarantor:'} {request.guarantorName}{' '}
                              {request.guarantorApproved ? (
                                <CheckCircle2 className="inline h-3 w-3 text-green-600" />
                              ) : (
                                <Clock className="inline h-3 w-3 text-amber-600" />
                              )}
                            </p>
                            <p>
                              {locale === 'bn' ? 'উদ্দেশ্য:' : 'Purpose:'} {request.purpose}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedLoan(request)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          {locale === 'bn' ? 'দেখুন' : 'View'}
                        </Button>
                        {request.guarantorApproved && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => {
                                setSelectedLoan(request);
                                handleApproval('reject');
                              }}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedLoan(request);
                                handleApproval('approve');
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {loanRequests.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{locale === 'bn' ? 'কোনো অপেক্ষমাণ ঋণ অনুরোধ নেই' : 'No pending loan requests'}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Withdrawal Requests */}
        <TabsContent value="withdrawals">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {locale === 'bn' ? 'উত্তোলন অনুরোধ' : 'Withdrawal Requests'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'সদস্যদের উত্তোলন অনুরোধ পর্যালোচনা করুন'
                  : 'Review member withdrawal requests'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {withdrawalRequests.map((request) => {
                  const hasIssues = request.hasActiveLoan || request.isGuarantor || !request.noticePeriodMet;
                  return (
                    <div
                      key={request.id}
                      className={`flex flex-col gap-4 p-4 rounded-xl ${hasIssues ? 'bg-red-50' : 'bg-slate-50'}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-semibold">
                            {request.memberName.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold">{request.memberName}</span>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>
                                {locale === 'bn' ? 'অনুরোধিত:' : 'Requested:'}{' '}
                                <span className="font-medium text-purple-600">
                                  {formatCurrency(request.requestedAmount)}
                                </span>{' '}
                                • {locale === 'bn' ? 'বর্তমান জমা:' : 'Current Deposit:'}{' '}
                                <span className="font-medium text-green-600">
                                  {formatCurrency(request.currentDeposit)}
                                </span>
                              </p>
                              <p>
                                {locale === 'bn' ? 'কারণ:' : 'Reason:'} {request.reason}
                              </p>
                              <p className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(request.requestDate).toLocaleDateString(
                                  locale === 'bn' ? 'bn-BD' : 'en-GB'
                                )}
                              </p>
                            </div>

                            {/* Validation Issues */}
                            {hasIssues && (
                              <div className="mt-2 space-y-1">
                                {request.hasActiveLoan && (
                                  <div className="flex items-center gap-1 text-sm text-red-600">
                                    <AlertCircle className="h-3 w-3" />
                                    {locale === 'bn' ? 'সক্রিয় ঋণ আছে' : 'Has active loan'}
                                  </div>
                                )}
                                {request.isGuarantor && (
                                  <div className="flex items-center gap-1 text-sm text-red-600">
                                    <AlertCircle className="h-3 w-3" />
                                    {locale === 'bn' ? 'গ্যারান্টর হিসেবে দায়বদ্ধ' : 'Active as guarantor'}
                                  </div>
                                )}
                                {!request.noticePeriodMet && (
                                  <div className="flex items-center gap-1 text-sm text-amber-600">
                                    <AlertCircle className="h-3 w-3" />
                                    {locale === 'bn'
                                      ? '৩ মাসের নোটিস পূরণ হয়নি'
                                      : '3-month notice not met'}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedWithdrawal(request)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            {locale === 'bn' ? 'দেখুন' : 'View'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => {
                              setSelectedWithdrawal(request);
                              handleApproval('reject');
                            }}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                          </Button>
                          <Button
                            size="sm"
                            disabled={request.hasActiveLoan || request.isGuarantor}
                            onClick={() => {
                              setSelectedWithdrawal(request);
                              handleApproval('approve');
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {withdrawalRequests.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {locale === 'bn' ? 'কোনো অপেক্ষমাণ উত্তোলন অনুরোধ নেই' : 'No pending withdrawal requests'}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Approval Confirmation Modal */}
      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalAction === 'approve'
                ? locale === 'bn'
                  ? 'অনুমোদন নিশ্চিত করুন'
                  : 'Confirm Approval'
                : locale === 'bn'
                  ? 'প্রত্যাখ্যান নিশ্চিত করুন'
                  : 'Confirm Rejection'}
            </DialogTitle>
            <DialogDescription>
              {selectedRegistration?.name || selectedLoan?.memberName || selectedWithdrawal?.memberName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                {approvalAction === 'reject'
                  ? locale === 'bn'
                    ? 'প্রত্যাখ্যানের কারণ *'
                    : 'Rejection Reason *'
                  : locale === 'bn'
                    ? 'মন্তব্য (ঐচ্ছিক)'
                    : 'Comments (optional)'}
              </Label>
              <Textarea
                placeholder={
                  approvalAction === 'reject'
                    ? locale === 'bn'
                      ? 'প্রত্যাখ্যানের কারণ লিখুন...'
                      : 'Enter rejection reason...'
                    : locale === 'bn'
                      ? 'মন্তব্য লিখুন...'
                      : 'Enter comments...'
                }
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              onClick={confirmApproval}
              variant={approvalAction === 'reject' ? 'destructive' : 'default'}
              disabled={approvalAction === 'reject' && !approvalReason.trim()}
            >
              {approvalAction === 'approve'
                ? locale === 'bn'
                  ? 'অনুমোদন করুন'
                  : 'Approve'
                : locale === 'bn'
                  ? 'প্রত্যাখ্যান করুন'
                  : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
