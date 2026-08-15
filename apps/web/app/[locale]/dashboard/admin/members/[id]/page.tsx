'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
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
  CheckCircle2,
  AlertCircle,
  Loader2,
  Hash,
  Receipt,
  TrendingUp,
  Users,
  Printer,
  FileImage,
  Eye,
  Download,
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
import { downloadDocumentFile, guessFileNameFromUrl, isImageDocument } from '@/lib/document-files';
import { formatCurrency, getLoanRepaymentPresets } from '@/lib/utils';
import {
  buildReceipt,
  buildLoanAgreement,
  buildStatement,
  downloadDocumentPDF,
  fetchOrgSettings,
  type ReceiptData,
  type LoanDocumentData,
  type StatementData,
} from '@/lib/documents';

interface MemberDetails {
  id: string;
  memberId: string;
  uid?: string;
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
  documents?: MemberDocument[];
}

interface MemberDocument {
  id: string;
  type: string;
  url: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
}

interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | string;
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
  const [allowActiveLoanWithdrawal, setAllowActiveLoanWithdrawal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal states
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showLoanPaymentModal, setShowLoanPaymentModal] = useState(false);
  const [selectedLoanForPayment, setSelectedLoanForPayment] = useState<Loan | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<MemberDocument | null>(null);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);

  // Form states
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalNotes, setWithdrawalNotes] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [loanInstallments, setLoanInstallments] = useState('12');
  const [maxInstallmentMonths, setMaxInstallmentMonths] = useState(24);
  const [loanPaymentAmount, setLoanPaymentAmount] = useState('');
  const [loanPaymentNotes, setLoanPaymentNotes] = useState('');

  const parseAmount = (value: string): number | null => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed);
  };

  const loadMemberDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [data, settingsResponse] = await Promise.all([
        apiGet<{
        member: MemberDetails;
        transactions: Transaction[];
        loans: Loan[];
        }>(`/v1/dashboard/worker/members/${memberId}`),
        fetch('/api/v1/settings', { cache: 'no-store' }),
      ]);
      
      setMember(data.member);
      setTransactions(data.transactions || []);
      setLoans(data.loans || []);

      if (settingsResponse.ok) {
        const settings = (await settingsResponse.json()) as Record<string, unknown>;
        setAllowActiveLoanWithdrawal(
          typeof settings['loan.allowActiveLoanWithdrawal'] === 'string' &&
            settings['loan.allowActiveLoanWithdrawal'].trim().toLowerCase() === 'true'
        );
        const parsedMaxInstallments = Number(settings['loan.maxInstallmentMonths']);
        setMaxInstallmentMonths(Number.isFinite(parsedMaxInstallments) && parsedMaxInstallments > 0 ? Math.trunc(parsedMaxInstallments) : 24);
      }
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
    const amountVal = parseAmount(depositAmount);
    if (!amountVal) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/deposit`, {
        amount: amountVal,
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
    const amountVal = parseAmount(withdrawalAmount);
    if (!amountVal) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    if (member && amountVal > member.currentDeposit) {
      setActionError(locale === 'bn' ? 'অপর্যাপ্ত ব্যালেন্স' : 'Insufficient balance');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/withdrawal`, {
        amount: amountVal,
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
    const amountVal = parseAmount(loanAmount);
    const requestedInstallments = Number.parseInt(loanInstallments, 10);
    if (!amountVal) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    if (!Number.isFinite(requestedInstallments) || requestedInstallments < 1 || requestedInstallments > maxInstallmentMonths) {
      setActionError(
        locale === 'bn'
          ? `কিস্তি সংখ্যা ১ থেকে ${maxInstallmentMonths} এর মধ্যে দিন`
          : `Enter installments between 1 and ${maxInstallmentMonths}`
      );
      return;
    }

    if (!loanPurpose.trim()) {
      setActionError(locale === 'bn' ? 'ঋণের উদ্দেশ্য লিখুন' : 'Enter loan purpose');
      return;
    }

    if (member && amountVal > member.loanEligibility.maxLoanAmount) {
      setActionError(locale === 'bn' ? 'সর্বোচ্চ ঋণ সীমা অতিক্রম করেছে' : 'Exceeds maximum loan limit');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/loan`, {
        amount: amountVal,
        purpose: loanPurpose,
        installments: requestedInstallments,
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

  // Handle loan payment
  const handleLoanPayment = async () => {
    if (!selectedLoanForPayment) return;

    const amountVal = parseAmount(loanPaymentAmount);
    if (!amountVal) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    const maxPaymentVal = Math.round(selectedLoanForPayment.remainingAmount);

    if (amountVal > maxPaymentVal) {
      setActionError(locale === 'bn'
        ? `সর্বোচ্চ পরিশোধযোগ্য: ${formatCurrency(selectedLoanForPayment.remainingAmount, locale)}`
        : `Maximum payable: ${formatCurrency(selectedLoanForPayment.remainingAmount, locale)}`);
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost(`/v1/dashboard/worker/members/${memberId}/loan-payment`, {
        loanId: selectedLoanForPayment.id,
        amount: amountVal,
        notes: loanPaymentNotes,
      });
      setActionSuccess(locale === 'bn' ? 'ঋণ পরিশোধ সফল হয়েছে' : 'Loan payment recorded successfully');
      setShowLoanPaymentModal(false);
      setSelectedLoanForPayment(null);
      setLoanPaymentAmount('');
      setLoanPaymentNotes('');
      loadMemberDetails();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to process loan payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open loan payment modal
  const openLoanPaymentModal = (loan: Loan) => {
    setSelectedLoanForPayment(loan);
    const presets = getLoanRepaymentPresets(loan.installmentAmount, loan.remainingAmount);
    setLoanPaymentAmount(presets.monthly.toString());
    setLoanPaymentNotes('');
    setActionError(null);
    setShowLoanPaymentModal(true);
  };

  const handlePrintReceipt = async (tx: Transaction) => {
    if (!member) return;
    const orgSettings = await fetchOrgSettings();
    
    const receiptData: ReceiptData = {
      receiptNumber: tx.receiptNumber,
      type: tx.type,
      amount: tx.amount,
      date: tx.createdAt,
      memberName: member.name,
      memberId: member.memberId || member.uid || 'N/A',
      memberPhone: member.phone,
      balanceAfter: tx.balanceAfter,
      notes: tx.notes,
    };
    
    const html = buildReceipt(receiptData, orgSettings);
    await downloadDocumentPDF(html);
  };

  const handlePrintLoanDocument = async (loan: Loan) => {
    if (!member) return;
    const orgSettings = await fetchOrgSettings();
    
    const loanData: LoanDocumentData = {
      loanNumber: loan.loanNumber,
      memberName: member.name,
      memberId: member.memberId || member.uid || 'N/A',
      memberPhone: member.phone,
      memberAddress: member.address,
      principalAmount: loan.principalAmount,
      totalInstallments: loan.totalInstallments,
      installmentAmount: loan.installmentAmount,
      disbursementDate: loan.disbursementDate,
    };
    
    const html = buildLoanAgreement(loanData, orgSettings);
    await downloadDocumentPDF(html);
  };

  const handlePrintStatement = async () => {
    if (!member) return;
    const orgSettings = await fetchOrgSettings();
    
    const statementData: StatementData = {
      memberName: member.name,
      memberId: member.memberId || member.uid || 'N/A',
      memberPhone: member.phone,
      periodStart: new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString(),
      periodEnd: new Date().toISOString(),
      openingBalance: Math.round((member.currentDeposit - member.totalDeposited + member.totalWithdrawn)),
      closingBalance: Math.round(member.currentDeposit),
      totalDeposits: Math.round(member.totalDeposited),
      totalWithdrawals: Math.round(member.totalWithdrawn),
      transactions: transactions.map(tx => ({
        date: tx.createdAt,
        type: tx.type,
        amount: Math.round(tx.amount),
        balance: Math.round(tx.balanceAfter),
        description: tx.notes,
        receiptNumber: tx.receiptNumber,
      })),
    };
    
    const html = buildStatement(statementData, orgSettings);
    await downloadDocumentPDF(html);
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

  const formatDocumentType = (type: string) => {
    const normalized = (type || '').toLowerCase();
    const labels: Record<string, { en: string; bn: string }> = {
      nid_front: { en: 'NID Front', bn: 'NID সামনের অংশ' },
      nid_back: { en: 'NID Back', bn: 'NID পেছনের অংশ' },
      member_photo: { en: 'Member Photo', bn: 'সদস্যের ছবি' },
      member_signature: { en: 'Member Signature', bn: 'সদস্যের স্বাক্ষর' },
      passport_photo: { en: 'Passport Photo', bn: 'পাসপোর্ট ছবি' },
      nominee_photo: { en: 'Nominee Photo', bn: 'নমিনীর ছবি' },
    };
    return labels[normalized]?.[locale === 'bn' ? 'bn' : 'en'] || type.replace(/_/g, ' ');
  };

  const formatFileSize = (size?: number) => {
    if (!size || size <= 0) return '-';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadDocument = async (doc: MemberDocument) => {
    setDownloadingDocumentId(doc.id);
    try {
      const fallbackName = guessFileNameFromUrl(doc.url, `document-${doc.id}`);
      await downloadDocumentFile(doc.url, doc.fileName || fallbackName);
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const getTransactionMeta = (type: Transaction['type']) => {
    const meta = {
      DEPOSIT: {
        label: locale === 'bn' ? 'জমা' : 'Deposit',
        color: 'text-green-600',
        bg: 'bg-green-100',
        sign: '+',
        icon: Plus,
      },
      WITHDRAWAL: {
        label: locale === 'bn' ? 'উত্তোলন' : 'Withdrawal',
        color: 'text-orange-600',
        bg: 'bg-orange-100',
        sign: '-',
        icon: Minus,
      },
      LOAN_DISBURSEMENT: {
        label: locale === 'bn' ? 'ঋণ বিতরণ' : 'Loan Disbursement',
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        sign: '+',
        icon: Plus,
      },
      LOAN_REPAYMENT: {
        label: locale === 'bn' ? 'ঋণ পরিশোধ' : 'Loan Repayment',
        color: 'text-amber-600',
        bg: 'bg-amber-100',
        sign: '-',
        icon: Minus,
      },
    } as const;

    return meta[type as keyof typeof meta] ?? {
      label: type.replace(/_/g, ' '),
      color: 'text-slate-600',
      bg: 'bg-slate-100',
      sign: '',
      icon: Receipt,
    };
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
                      (allowActiveLoanWithdrawal || member.activeLoan === 0) && 
                      !member.isGuarantorForActiveLoan;

  const canGetLoan = member.status === 'ACTIVE' && 
                     member.loanEligibility.eligible && 
                     member.activeLoan === 0;

  return (
    <div className="space-y-4">
      {/* Success/Error Messages */}
      {actionSuccess && (
        <div className="rounded-sm bg-green-50 border border-green-200 p-4 flex items-center gap-3">
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
                <span className="font-mono">{member.memberId || member.uid || '-'}</span>
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
        <Card className="rounded-sm border-green-200 bg-green-50/50">
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

        <Card className="rounded-sm border-blue-200 bg-blue-50/50">
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

        <Card className="rounded-sm border-emerald-200 bg-emerald-50/50">
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

        <Card className="rounded-sm border-orange-200 bg-orange-50/50">
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
            <div className="rounded-sm bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {member.isGuarantorForActiveLoan
                  ? (locale === 'bn' ? 'অন্যের ঋণের জামিনদার থাকায় উত্তোলন করা যাবে না।' : 'Withdrawal blocked because member is a guarantor.')
                  : member.activeLoan > 0
                  ? (locale === 'bn' ? 'সক্রিয় ঋণ থাকায় উত্তোলন করা যাবে না।' : 'Withdrawal blocked due to active loan.')
                  : ''}
              </p>
            </div>
          )}
          {!canGetLoan && member.loanEligibility.reason && (
            <div className="rounded-sm bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
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
          <Card className="rounded-sm">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'সদস্য তথ্য' : 'Member Information'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="mt-6 border-t pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <FileImage className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-base font-semibold">
                    {locale === 'bn' ? 'নিবন্ধন নথি' : 'Registration Documents'}
                  </h3>
                </div>

                {member.documents && member.documents.length > 0 ? (
                  <div className="space-y-3">
                    {member.documents.map((doc) => (
                      <div key={doc.id} className="rounded-sm border bg-slate-50 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-sm border bg-white">
                              {isImageDocument(doc.url, doc.mimeType) ? (
                                <img
                                  src={doc.url}
                                  alt={formatDocumentType(doc.type)}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                  {locale === 'bn' ? 'ফাইল' : 'File'}
                                </div>
                              )}
                            </div>
                            <div>
                            <p className="font-medium">{formatDocumentType(doc.type)}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.fileName || '-'} • {formatFileSize(doc.size)} • {doc.uploadedAt ? formatDate(doc.uploadedAt) : '-'}
                            </p>
                          </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPreviewDocument(doc)}
                              className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-medium hover:bg-white"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {locale === 'bn' ? 'দেখুন' : 'View'}
                            </button>
                            <button
                              type="button"
                              disabled={downloadingDocumentId === doc.id}
                              onClick={() => void handleDownloadDocument(doc)}
                              className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-60"
                            >
                              {downloadingDocumentId === doc.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Download className="h-3.5 w-3.5" />}
                              {locale === 'bn' ? 'ডাউনলোড' : 'Download'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {locale === 'bn' ? 'এই সদস্যের কোনো নথি পাওয়া যায়নি।' : 'No registration documents found for this member.'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="mt-6">
          <Card className="rounded-sm">
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
                <>
                  <div className="flex justify-end mb-4">
                    <Button variant="outline" size="sm" onClick={() => void handlePrintStatement()}>
                      <Download className="h-4 w-4 mr-2" />
                      {locale === 'bn' ? 'স্টেটমেন্ট ডাউনলোড' : 'Download Statement'}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-4 rounded-sm bg-slate-50">
                        {(() => {
                          const meta = getTransactionMeta(tx.type);
                          const Icon = meta.icon;
                          return (
                            <>
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-full ${meta.bg}`}>
                                  <Icon className={`h-4 w-4 ${meta.color}`} />
                                </div>
                                <div>
                                  <p className="font-medium">{meta.label}</p>
                                  <p className="text-sm text-muted-foreground">{tx.receiptNumber} • {formatDate(tx.createdAt)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <p className={`font-semibold ${meta.color}`}>
                                    {meta.sign}{formatCurrency(tx.amount, locale)}
                                  </p>
                                  {getStatusBadge(tx.status)}
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => void handlePrintReceipt(tx)} title={locale === 'bn' ? 'রশিদ ডাউনলোড' : 'Download Receipt'}>
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans" className="mt-6">
          <Card className="rounded-sm">
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
                    <div key={loan.id} className="p-4 rounded-sm bg-slate-50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold">{loan.loanNumber}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{loan.status}</Badge>
                          {loan.status === 'ACTIVE' && loan.remainingAmount > 0 && (
                            <Button 
                              variant="default" 
                              size="sm" 
                              onClick={() => openLoanPaymentModal(loan)}
                              className="gap-1"
                            >
                              <Minus className="h-3 w-3" />
                              {locale === 'bn' ? 'পরিশোধ' : 'Pay'}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => void handlePrintLoanDocument(loan)} title={locale === 'bn' ? 'ঋণ দলিল ডাউনলোড' : 'Download Loan Document'}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'মূল পরিমাণ' : 'Principal'}</p>
                          <p className="font-medium">{formatCurrency(loan.principalAmount, locale)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{locale === 'bn' ? 'বাকি' : 'Remaining'}</p>
                          <p className="font-medium text-red-600">{formatCurrency(loan.remainingAmount, locale)}</p>
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

      <Dialog
        open={Boolean(previewDocument)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDocument(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {previewDocument ? formatDocumentType(previewDocument.type) : (locale === 'bn' ? 'নথি' : 'Document')}
            </DialogTitle>
            <DialogDescription>
              {previewDocument?.fileName || '-'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-sm border bg-slate-50 p-3">
            {previewDocument && isImageDocument(previewDocument.url, previewDocument.mimeType) ? (
              <img
                src={previewDocument.url}
                alt={previewDocument.fileName || 'Document preview'}
                className="mx-auto max-h-[62vh] w-auto rounded-sm border bg-white"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'এই নথির ইনলাইন প্রিভিউ উপলব্ধ নয়।' : 'Inline preview is unavailable for this document.'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewDocument(null)}
            >
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
            {previewDocument && (
              <Button
                onClick={() => void handleDownloadDocument(previewDocument)}
                disabled={downloadingDocumentId === previewDocument.id}
              >
                {downloadingDocumentId === previewDocument.id
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                {locale === 'bn' ? 'ডাউনলোড' : 'Download'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <div className="rounded-sm bg-red-50 border border-red-200 p-3 text-sm text-red-800">
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
              <div className="rounded-sm bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                max={member.currentDeposit}
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
              <div className="rounded-sm bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'ঋণের পরিমাণ (টাকা)' : 'Loan Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                max={member.loanEligibility.maxLoanAmount}
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
              <Input
                type="number"
                min={1}
                max={maxInstallmentMonths}
                step={1}
                value={loanInstallments}
                onChange={(e) => setLoanInstallments(e.target.value)}
                placeholder={locale === 'bn' ? `১-${maxInstallmentMonths} মাস` : `1-${maxInstallmentMonths} months`}
              />
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

      {/* Loan Payment Modal */}
      <Dialog open={showLoanPaymentModal} onOpenChange={(open) => {
        setShowLoanPaymentModal(open);
        if (!open) {
          setSelectedLoanForPayment(null);
          setLoanPaymentAmount('');
          setLoanPaymentNotes('');
          setActionError(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ পরিশোধ' : 'Record Loan Payment'}</DialogTitle>
            <DialogDescription>
              {selectedLoanForPayment && (
                locale === 'bn' 
                  ? `ঋণ নং: ${selectedLoanForPayment.loanNumber} | বাকি: ${formatCurrency(selectedLoanForPayment.remainingAmount, locale)}`
                  : `Loan #: ${selectedLoanForPayment.loanNumber} | Remaining: ${formatCurrency(selectedLoanForPayment.remainingAmount, locale)}`
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {actionError && (
              <div className="rounded-sm bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {actionError}
              </div>
            )}
            
            {selectedLoanForPayment && (
              <div className="rounded-sm bg-blue-50 border border-blue-200 p-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'মাসিক কিস্তি:' : 'Monthly:'}</span>
                    <span className="font-medium ml-1">{formatCurrency(selectedLoanForPayment.installmentAmount, locale)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'পরিশোধিত:' : 'Paid:'}</span>
                    <span className="font-medium ml-1">{selectedLoanForPayment.paidInstallments}/{selectedLoanForPayment.totalInstallments}</span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'পরিশোধের পরিমাণ (টাকা)' : 'Payment Amount (BDT)'}</Label>
              <Input
                type="number"
                min="1"
                max={selectedLoanForPayment ? selectedLoanForPayment.remainingAmount : undefined}
                step="0.01"
                placeholder="0.00"
                value={loanPaymentAmount}
                onChange={(e) => setLoanPaymentAmount(e.target.value)}
              />
              {selectedLoanForPayment && (
                <div className="flex flex-wrap gap-2 mt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const presets = getLoanRepaymentPresets(
                        selectedLoanForPayment.installmentAmount,
                        selectedLoanForPayment.remainingAmount,
                      );
                      setLoanPaymentAmount(presets.weekly.toString());
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
                        selectedLoanForPayment.installmentAmount,
                        selectedLoanForPayment.remainingAmount,
                      );
                      setLoanPaymentAmount(presets.monthly.toString());
                    }}
                  >
                    {locale === 'bn' ? 'মাসিক কিস্তি' : 'Monthly'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLoanPaymentAmount(selectedLoanForPayment.remainingAmount.toString())}
                  >
                    {locale === 'bn' ? 'সম্পূর্ণ বাকি' : 'Full Balance'}
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional notes...'}
                value={loanPaymentNotes}
                onChange={(e) => setLoanPaymentNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoanPaymentModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleLoanPayment} disabled={isSubmitting}>
              {isSubmitting ? (locale === 'bn' ? 'প্রক্রিয়াকরণ...' : 'Processing...') : (locale === 'bn' ? 'পরিশোধ করুন' : 'Record Payment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
