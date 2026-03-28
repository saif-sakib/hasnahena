'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  Wallet,
  HandCoins,
  History,
  Plus,
  Minus,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Hash,
  Building,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { apiGet, apiPost } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface MemberDetails {
  id: string;
  uid: string;
  name: string;
  phone: string;
  email?: string;
  nidNumber: string;
  address: string;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
  joinDate: string;
  currentDeposit: number;
  activeLoan: number;
  totalDeposited: number;
  totalWithdrawn: number;
  isGuarantorForActiveLoan: boolean;
  loanEligibility: {
    eligible: boolean;
    maxLoanAmount: number;
    reason?: string;
  };
}

interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  balanceAfter: number;
  receiptNumber: string;
  status: 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'REJECTED';
  createdAt: string;
  notes?: string;
}

interface Loan {
  id: string;
  loanNumber: string;
  principalAmount: number;
  remainingAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentAmount: number;
  status: string;
  disbursementDate?: string;
  nextDueDate?: string;
}

export default function MemberDetailPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams();
  const memberId = params.id as string;

  const [member, setMember] = useState<MemberDetails | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal states
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalNotes, setWithdrawalNotes] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [loanInstallments, setLoanInstallments] = useState('12');

  const loadMemberDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiGet<{
        member: MemberDetails;
        transactions: Transaction[];
        loans: Loan[];
      }>(`/v1/dashboard/worker/members/${memberId}`);
      
      setMember(data.member);
      setTransactions(data.transactions || []);
      setLoans(data.loans || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load member details');
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    if (memberId) {
      loadMemberDetails();
    }
  }, [memberId, loadMemberDetails]);

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/deposit`, {
        amount: Math.round(parseFloat(depositAmount) * 100), // Convert to paisa
        notes: depositNotes,
      });
      setActionSuccess(locale === 'bn' ? 'জমা সফল হয়েছে' : 'Deposit successful');
      setShowDepositModal(false);
      setDepositAmount('');
      setDepositNotes('');
      loadMemberDetails();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to add deposit');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawal = async () => {
    if (!withdrawalAmount || parseFloat(withdrawalAmount) <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    const amountPaisa = Math.round(parseFloat(withdrawalAmount) * 100);
    if (member && amountPaisa > member.currentDeposit) {
      setActionError(locale === 'bn' ? 'অপর্যাপ্ত ব্যালেন্স' : 'Insufficient balance');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/withdrawal`, {
        amount: amountPaisa,
        notes: withdrawalNotes,
      });
      setActionSuccess(locale === 'bn' ? 'উত্তোলন সফল হয়েছে' : 'Withdrawal successful');
      setShowWithdrawalModal(false);
      setWithdrawalAmount('');
      setWithdrawalNotes('');
      loadMemberDetails();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to process withdrawal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoanApplication = async () => {
    if (!loanAmount || parseFloat(loanAmount) <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    if (!loanPurpose.trim()) {
      setActionError(locale === 'bn' ? 'ঋণের উদ্দেশ্য লিখুন' : 'Enter loan purpose');
      return;
    }

    const amountPaisa = Math.round(parseFloat(loanAmount) * 100);
    if (member && amountPaisa > member.loanEligibility.maxLoanAmount) {
      setActionError(locale === 'bn' ? 'সর্বোচ্চ ঋণ সীমা অতিক্রম করেছে' : 'Exceeds maximum loan limit');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/loan`, {
        amount: amountPaisa,
        purpose: loanPurpose,
        installments: parseInt(loanInstallments),
      });
      setActionSuccess(locale === 'bn' ? 'ঋণ আবেদন সফল হয়েছে' : 'Loan application submitted');
      setShowLoanModal(false);
      setLoanAmount('');
      setLoanPurpose('');
      setLoanInstallments('12');
      loadMemberDetails();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to submit loan application');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      ACTIVE: 'bg-green-100 text-green-700',
      PENDING: 'bg-amber-100 text-amber-700',
      SUSPENDED: 'bg-red-100 text-red-700',
      PROCESSED: 'bg-blue-100 text-blue-700',
      CONFIRMED: 'bg-green-100 text-green-700',
      REJECTED: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, { bn: string; en: string }> = {
      ACTIVE: { bn: 'সক্রিয়', en: 'Active' },
      PENDING: { bn: 'অপেক্ষমাণ', en: 'Pending' },
      SUSPENDED: { bn: 'স্থগিত', en: 'Suspended' },
      PROCESSED: { bn: 'প্রক্রিয়াকৃত', en: 'Processed' },
      CONFIRMED: { bn: 'নিশ্চিত', en: 'Confirmed' },
      REJECTED: { bn: 'প্রত্যাখ্যাত', en: 'Rejected' },
    };
    return (
      <Badge className={styles[status] || 'bg-gray-100 text-gray-700'}>
        {labels[status]?.[locale === 'bn' ? 'bn' : 'en'] || status}
      </Badge>
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">{locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h3 className="font-semibold mb-2">{locale === 'bn' ? 'ত্রুটি' : 'Error'}</h3>
            <p className="text-muted-foreground mb-4">{error || 'Member not found'}</p>
            <Button onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {locale === 'bn' ? 'ফিরে যান' : 'Go Back'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canWithdraw = member.status === 'ACTIVE' && 
                      member.currentDeposit > 0 && 
                      member.activeLoan === 0 && 
                      !member.isGuarantorForActiveLoan;

  const canGetLoan = member.status === 'ACTIVE' && 
                     member.loanEligibility.eligible && 
                     member.activeLoan === 0;

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {actionSuccess && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <p className="text-green-800">{actionSuccess}</p>
          <Button variant="ghost" size="sm" onClick={() => setActionSuccess(null)} className="ml-auto">×</Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
              {member.name}
              {getStatusBadge(member.status)}
            </h1>
            <div className="flex items-center gap-4 text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Hash className="h-4 w-4" />
                <span className="font-mono">{member.uid}</span>
              </span>
              <span className="flex items-center gap-1">
                <Phone className="h-4 w-4" />
                {member.phone}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        {member.status === 'ACTIVE' && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowDepositModal(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {locale === 'bn' ? 'জমা করুন' : 'Add Deposit'}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setShowWithdrawalModal(true)}
              disabled={!canWithdraw}
              className="gap-2"
            >
              <Minus className="h-4 w-4" />
              {locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}
            </Button>
            <Button 
              variant="outline"
              onClick={() => setShowLoanModal(true)}
              disabled={!canGetLoan}
              className="gap-2"
            >
              <HandCoins className="h-4 w-4" />
              {locale === 'bn' ? 'ঋণ দিন' : 'Give Loan'}
            </Button>
          </div>
        )}
      </div>

      {/* Account Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-green-200 bg-green-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'বর্তমান ব্যালেন্স' : 'Current Balance'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(member.currentDeposit, locale)}</p>
              </div>
              <Wallet className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-blue-200 bg-blue-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(member.activeLoan, locale)}</p>
              </div>
              <HandCoins className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট জমা' : 'Total Deposited'}</p>
                <p className="text-2xl font-bold text-emerald-600">{formatCurrency(member.totalDeposited, locale)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-orange-200 bg-orange-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট উত্তোলন' : 'Total Withdrawn'}</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(member.totalWithdrawn, locale)}</p>
              </div>
              <Receipt className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Withdrawal/Loan Eligibility Warnings */}
      {member.status === 'ACTIVE' && (
        <div className="space-y-2">
          {!canWithdraw && member.currentDeposit > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {member.activeLoan > 0
                  ? (locale === 'bn' ? 'সক্রিয় ঋণ থাকায় উত্তোলন করা যাবে না।' : 'Withdrawal blocked due to active loan.')
                  : member.isGuarantorForActiveLoan
                  ? (locale === 'bn' ? 'অন্যের ঋণের জামিনদার থাকায় উত্তোলন করা যাবে না।' : 'Withdrawal blocked because member is a guarantor.')
                  : ''}
              </p>
            </div>
          )}
          {!canGetLoan && member.loanEligibility.reason && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {locale === 'bn' ? 'ঋণ যোগ্যতা:' : 'Loan eligibility:'} {member.loanEligibility.reason}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Member Info & History Tabs */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="info" className="gap-2">
            <User className="h-4 w-4" />
            {locale === 'bn' ? 'তথ্য' : 'Info'}
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-2">
            <History className="h-4 w-4" />
            {locale === 'bn' ? 'লেনদেন' : 'Transactions'}
          </TabsTrigger>
          <TabsTrigger value="loans" className="gap-2">
            <HandCoins className="h-4 w-4" />
            {locale === 'bn' ? 'ঋণ' : 'Loans'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'সদস্য তথ্য' : 'Member Information'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'পুরো নাম' : 'Full Name'}</p>
                      <p className="font-medium">{member.name}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ফোন নম্বর' : 'Phone Number'}</p>
                      <p className="font-medium">{member.phone}</p>
                    </div>
                  </div>
                  {member.email && (
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ইমেইল' : 'Email'}</p>
                        <p className="font-medium">{member.email}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'NID নম্বর' : 'NID Number'}</p>
                      <p className="font-medium font-mono">{member.nidNumber}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ঠিকানা' : 'Address'}</p>
                      <p className="font-medium">{member.address}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}</p>
                      <p className="font-medium">{formatDate(member.joinDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <TrendingUp className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সর্বোচ্চ ঋণ সীমা' : 'Max Loan Limit'}</p>
                      <p className="font-medium text-green-600">{formatCurrency(member.loanEligibility.maxLoanAmount, locale)}</p>
                    </div>
                  </div>
                  {member.isGuarantorForActiveLoan && (
                    <div className="flex items-start gap-3">
                      <Users className="h-5 w-5 text-amber-500 mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'জামিনদার স্ট্যাটাস' : 'Guarantor Status'}</p>
                        <p className="font-medium text-amber-600">{locale === 'bn' ? 'সক্রিয় ঋণের জামিনদার' : 'Guarantor for active loan'}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'লেনদেন ইতিহাস' : 'Transaction History'}</CardTitle>
              <CardDescription>
                {locale === 'bn' ? 'সাম্প্রতিক লেনদেন' : 'Recent transactions'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো লেনদেন নেই' : 'No transactions found'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${tx.type === 'DEPOSIT' ? 'bg-green-100' : 'bg-orange-100'}`}>
                          {tx.type === 'DEPOSIT' ? (
                            <Plus className="h-4 w-4 text-green-600" />
                          ) : (
                            <Minus className="h-4 w-4 text-orange-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">
                            {tx.type === 'DEPOSIT' 
                              ? (locale === 'bn' ? 'জমা' : 'Deposit')
                              : (locale === 'bn' ? 'উত্তোলন' : 'Withdrawal')}
                          </p>
                          <p className="text-sm text-muted-foreground">{tx.receiptNumber} • {formatDate(tx.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${tx.type === 'DEPOSIT' ? 'text-green-600' : 'text-orange-600'}`}>
                          {tx.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(tx.amount, locale)}
                        </p>
                        {getStatusBadge(tx.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'ঋণ ইতিহাস' : 'Loan History'}</CardTitle>
              <CardDescription>
                {locale === 'bn' ? 'সকল ঋণের তথ্য' : 'All loan records'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loans.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <HandCoins className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো ঋণ নেই' : 'No loans found'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {loans.map((loan) => (
                    <div key={loan.id} className="p-4 rounded-xl bg-slate-50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold">{loan.loanNumber}</p>
                        <Badge variant="outline">{loan.status}</Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'মূল পরিমাণ' : 'Principal'}</p>
                          <p className="font-medium">{formatCurrency(loan.principalAmount, locale)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</p>
                          <p className="font-medium">{formatCurrency(loan.remainingAmount, locale)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'কিস্তি' : 'Installments'}</p>
                          <p className="font-medium">{loan.paidInstallments}/{loan.totalInstallments}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly'}</p>
                          <p className="font-medium">{formatCurrency(loan.installmentAmount, locale)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Deposit Modal */}
      <Dialog open={showDepositModal} onOpenChange={setShowDepositModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'জমা করুন' : 'Add Deposit'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? `${member.name} এর জন্য জমা যোগ করুন` : `Add deposit for ${member.name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {actionError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional notes...'}
                value={depositNotes}
                onChange={(e) => setDepositNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepositModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleDeposit} disabled={isSubmitting}>
              {isSubmitting ? (locale === 'bn' ? 'প্রক্রিয়াকরণ...' : 'Processing...') : (locale === 'bn' ? 'জমা করুন' : 'Add Deposit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdrawal Modal */}
      <Dialog open={showWithdrawalModal} onOpenChange={setShowWithdrawalModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' 
                ? `${member.name} এর জন্য উত্তোলন করুন। সর্বোচ্চ: ${formatCurrency(member.currentDeposit, locale)}`
                : `Process withdrawal for ${member.name}. Max: ${formatCurrency(member.currentDeposit, locale)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {actionError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                max={member.currentDeposit / 100}
                step="0.01"
                placeholder="0.00"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional notes...'}
                value={withdrawalNotes}
                onChange={(e) => setWithdrawalNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWithdrawalModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleWithdrawal} disabled={isSubmitting}>
              {isSubmitting ? (locale === 'bn' ? 'প্রক্রিয়াকরণ...' : 'Processing...') : (locale === 'bn' ? 'উত্তোলন করুন' : 'Process Withdrawal')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan Modal */}
      <Dialog open={showLoanModal} onOpenChange={setShowLoanModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ প্রদান' : 'Give Loan'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' 
                ? `${member.name} এর জন্য ঋণ আবেদন। সর্বোচ্চ: ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)}`
                : `Loan application for ${member.name}. Max: ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {actionError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'ঋণের পরিমাণ (টাকা)' : 'Loan Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                max={member.loanEligibility.maxLoanAmount / 100}
                step="0.01"
                placeholder="0.00"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'ঋণের উদ্দেশ্য' : 'Loan Purpose'}</Label>
              <Textarea
                placeholder={locale === 'bn' ? 'ঋণ কেন প্রয়োজন...' : 'Why the loan is needed...'}
                value={loanPurpose}
                onChange={(e) => setLoanPurpose(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'কিস্তি সংখ্যা' : 'Number of Installments'}</Label>
              <Select value={loanInstallments} onValueChange={setLoanInstallments}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 {locale === 'bn' ? 'মাস' : 'months'}</SelectItem>
                  <SelectItem value="12">12 {locale === 'bn' ? 'মাস' : 'months'}</SelectItem>
                  <SelectItem value="18">18 {locale === 'bn' ? 'মাস' : 'months'}</SelectItem>
                  <SelectItem value="24">24 {locale === 'bn' ? 'মাস' : 'months'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoanModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleLoanApplication} disabled={isSubmitting}>
              {isSubmitting ? (locale === 'bn' ? 'প্রক্রিয়াকরণ...' : 'Processing...') : (locale === 'bn' ? 'ঋণ দিন' : 'Submit Loan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
