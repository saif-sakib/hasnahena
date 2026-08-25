'use client';

import { useMemo, useState } from 'react';
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
  FileImage,
  Eye,
  Download,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsAdmin } from '@/components/dashboard/role';
import { useApi } from '@/lib/use-api';
import {
  MoneyActionDialog,
  moneyActionSuccessMessage,
  type MoneyAction,
} from '@/components/dashboard/money-actions';
import useSWR from 'swr';
import { downloadDocumentFile, guessFileNameFromUrl, isImageDocument } from '@/lib/document-files';
import { formatCurrency } from '@/lib/utils';
import { fetchSettings } from '@/lib/settings-client';
import Image from 'next/image';
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
  accountNo: string;
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
  /**
   * Withdrawal requests this member has outstanding and unpaid.
   *
   * Not a precondition of anything since ADR-030 — a payout needs no request
   * behind it and waits out no period. They are here so a worker at the desk
   * can see that ৳5,000 was already asked for and settle *that* rather than pay
   * it twice. Nothing creates new ones; the list empties as they are paid.
   */
  pendingWithdrawals?: PendingWithdrawal[];
  loanEligibility: {
    eligible: boolean;
    maxLoanAmount: number;
    reason?: string;
  };
  documents?: MemberDocument[];
}

interface PendingWithdrawal {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
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

export default function MemberDetailScreen() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams();
  const memberUserId = params.id as string;

  /**
   * FR-23 / WO-93 / ADR-033. Erasure is the only irreversible action on this
   * screen, and an admin decision by policy — a worker must not see it. This is
   * presentation only: `/api/v1/admin/members/[id]/erase` refuses a worker's
   * token regardless, which is the gate that counts (see `role.tsx`).
   */
  const isAdmin = useIsAdmin();
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseConfirm, setEraseConfirm] = useState('');
  const [eraseReason, setEraseReason] = useState('');
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  // WO-27 — SWR, not an effect. `memberUserId` is read from the route, so the key
  // is null until it exists: that is how "not yet" is expressed to a hook that
  // cannot be called conditionally.
  const {
    data: detailsData,
    error,
    isLoading,
    refresh: loadMemberDetails,
  } = useApi<{
    member: MemberDetails;
    transactions: Transaction[];
    loans: Loan[];
  }>(memberUserId ? `/v1/dashboard/worker/members/${memberUserId}` : null);

  // Carries the token: `loan.allowActiveLoanWithdrawal` is not in the anonymous
  // tier (WO-77). `loan.maxInstallmentMonths` is read by MoneyActionDialog,
  // which needs it to bound the loan form.
  const { data: settings } = useSWR<Record<string, string> | null>(
    '/api/v1/settings',
    () => fetchSettings(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const member = detailsData?.member ?? null;
  const transactions = useMemo<Transaction[]>(() => detailsData?.transactions ?? [], [detailsData]);
  const loans = useMemo<Loan[]>(() => detailsData?.loans ?? [], [detailsData]);

  const allowActiveLoanWithdrawal =
    typeof settings?.['loan.allowActiveLoanWithdrawal'] === 'string' &&
    (settings['loan.allowActiveLoanWithdrawal'] as string).trim().toLowerCase() === 'true';

  const pendingWithdrawals = useMemo<PendingWithdrawal[]>(
    () => member?.pendingWithdrawals ?? [],
    [member],
  );
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  /**
   * Which money action is open, if any.
   *
   * Four forms used to live in this file — deposit, withdrawal, loan
   * application, loan instalment — and two of them existed a second time on the
   * Deposits and Loans screens, with different rules. They are all
   * `MoneyActionDialog` now; see the note there for what the copies disagreed
   * about.
   */
  const [moneyAction, setMoneyAction] = useState<{
    action: MoneyAction;
    loanId?: string;
  } | null>(null);
  const [previewDocument, setPreviewDocument] = useState<MemberDocument | null>(null);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);

  const handlePrintReceipt = async (tx: Transaction) => {
    if (!member) return;
    const orgSettings = await fetchOrgSettings();
    
    const receiptData: ReceiptData = {
      receiptNumber: tx.receiptNumber,
      type: tx.type,
      amount: tx.amount,
      date: tx.createdAt,
      memberName: member.name,
      accountNo: member.accountNo || member.uid || 'N/A',
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
      accountNo: member.accountNo || member.uid || 'N/A',
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
      accountNo: member.accountNo || member.uid || 'N/A',
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

  /**
   * Erase this member — anonymise if they have postings, delete if they do not.
   *
   * The route decides which by counting; nothing here chooses, and nothing here
   * is told to. All this screen owns is the confirmation: the account number is
   * echoed by hand because this action cannot be undone and the page is reached
   * from a list.
   */
  const handleErase = async () => {
    setErasing(true);
    setEraseError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      const response = await fetch(`/api/v1/admin/members/${encodeURIComponent(memberUserId)}/erase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirmAccountNo: eraseConfirm.trim(), reason: eraseReason.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        // The refusals are answers, not faults — "this member guarantees a loan
        // that is not settled" is exactly what the admin needs to read.
        throw new Error(payload?.error || 'Failed to erase member');
      }
      setEraseOpen(false);
      setEraseConfirm('');
      setEraseReason('');
      router.back();
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : 'Failed to erase member');
    } finally {
      setErasing(false);
    }
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
                <span className="font-mono">{member.accountNo || member.uid || '-'}</span>
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
            <Button onClick={() => setMoneyAction({ action: 'DEPOSIT' })} className="gap-2">
              <Plus className="h-4 w-4" />
              {locale === 'bn' ? 'জমা করুন' : 'Add Deposit'}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setMoneyAction({ action: 'WITHDRAWAL' })}
              disabled={!canWithdraw}
              className="gap-2"
            >
              <Minus className="h-4 w-4" />
              {locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}
            </Button>
            <Button 
              variant="outline"
              onClick={() => setMoneyAction({ action: 'LOAN_APPLICATION' })}
              disabled={!canGetLoan}
              className="gap-2"
            >
              <HandCoins className="h-4 w-4" />
              {locale === 'bn' ? 'ঋণ দিন' : 'Give Loan'}
            </Button>
          </div>
        )}
      </div>

      {/* FR-23. Separated from the quick actions above and shown to admins only:
          every button up there can be corrected by another posting, and this one
          cannot be undone at all. */}
      {isAdmin && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEraseError(null);
              setEraseOpen(true);
            }}
            className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
          >
            <ShieldAlert className="h-4 w-4" />
            {locale === 'bn' ? 'সদস্যের তথ্য মুছুন' : 'Erase member data'}
          </Button>
        </div>
      )}

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
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
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
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {locale === 'bn' ? 'ঋণ যোগ্যতা:' : 'Loan eligibility:'} {member.loanEligibility.reason}
              </p>
            </div>
          )}
        </div>
      )}

      {/*
        Outstanding withdrawal requests.

        A panel on the page rather than a list inside the withdrawal form, which
        is where it used to be: a member asking "when can I take my money out?"
        is a question you answer before you open anything.

        The panel now hides itself when there is nothing in it. Under FR-08 an
        empty list was the answer to "may I pay this member?" and had to be
        shown; since ADR-030 the answer is always yes, so an empty card would be
        a permanent reminder of a rule that no longer exists.
      */}
      {member.status === 'ACTIVE' && pendingWithdrawals.length > 0 && (
        <Card className="rounded-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {locale === 'bn' ? 'অপরিশোধিত উত্তোলন অনুরোধ' : 'Outstanding Withdrawal Requests'}
            </CardTitle>
            <CardDescription>
              {locale === 'bn'
                ? 'সদস্য এই পরিমাণ চেয়েছেন, এখনো পরিশোধ হয়নি। পরিশোধ করলে এই অনুরোধই নিষ্পত্তি হবে — দ্বিতীয় কোনো এন্ট্রি হবে না।'
                : 'The member asked for this and has not been paid. Paying settles this request rather than adding a second entry.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {pendingWithdrawals.map((request) => (
                <li
                  key={request.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900"
                >
                  <span className="font-medium">{formatCurrency(request.amount, locale)}</span>
                  <span className="text-xs">
                    {locale === 'bn'
                      ? `${formatDate(request.requestedAt)} তারিখে চাওয়া`
                      : `Asked ${formatDate(request.requestedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
                            <div className="relative h-14 w-14 overflow-hidden rounded-sm border bg-white">
                              {isImageDocument(doc.url, doc.mimeType) ? (
                                // 56px on screen; `sizes` keeps the optimiser from
                                // fetching a full-resolution scan for a thumbnail.
                                <Image
                                  src={doc.url}
                                  alt={formatDocumentType(doc.type)}
                                  fill
                                  sizes="56px"
                                  className="object-cover"
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
                              onClick={() => setMoneyAction({ action: 'LOAN_PAYMENT', loanId: loan.id })}
                              className="gap-1"
                            >
                              <Minus className="h-3 w-3" />
                              {locale === 'bn' ? 'পরিশোধ' : 'Pay'}
                            </Button>
                          )}
                          {/* Adding to a loan that is already running. It lives
                              on the loan rather than beside "New Loan" because
                              it needs a loan to act on, and because a member
                              with an active loan is refused a new one — which
                              is the whole reason this exists. */}
                          {loan.status === 'ACTIVE' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMoneyAction({ action: 'LOAN_TOPUP', loanId: loan.id })}
                              className="gap-1"
                            >
                              <Plus className="h-3 w-3" />
                              {locale === 'bn' ? 'বাড়ান' : 'Add'}
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
              <div className="relative mx-auto h-[62vh] w-full">
                <Image
                  src={previewDocument.url}
                  alt={previewDocument.fileName || 'Document preview'}
                  fill
                  sizes="100vw"
                  className="rounded-sm border bg-white object-contain"
                />
              </div>
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

      {/* FR-23 / ADR-033 — erasure. */}
      <Dialog
        open={eraseOpen}
        onOpenChange={(open) => {
          if (!open && !erasing) {
            setEraseOpen(false);
            setEraseConfirm('');
            setEraseReason('');
            setEraseError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <ShieldAlert className="h-5 w-5" />
              {locale === 'bn' ? 'সদস্যের তথ্য মুছুন' : 'Erase member data'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? 'এন.আই.ডি, ছবি, ঠিকানা, নমিনী ও পিতা-মাতার নাম চিরতরে মুছে যাবে। সঞ্চয়, লেনদেন ও হিসাব নম্বর অপরিবর্তিত থাকবে — খাতা মিলতেই হবে। এই কাজ ফেরানো যায় না।'
                : 'The NID number, photographs, addresses, nominee and parents’ names are removed for good. Savings, postings and the account number are kept exactly as they are, because the ledger still has to add up. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="erase-confirm">
                {locale === 'bn'
                  ? `নিশ্চিত করতে হিসাব নম্বর লিখুন (${member.accountNo || member.uid || '-'})`
                  : `Type this member’s account number to confirm (${member.accountNo || member.uid || '-'})`}
              </Label>
              <Input
                id="erase-confirm"
                value={eraseConfirm}
                onChange={(e) => setEraseConfirm(e.target.value)}
                placeholder="ACC-KH-33001"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="erase-reason">
                {locale === 'bn' ? 'কারণ (অডিটে থাকবে)' : 'Reason (kept in the audit log)'}
              </Label>
              <Input
                id="erase-reason"
                value={eraseReason}
                onChange={(e) => setEraseReason(e.target.value)}
                placeholder={
                  locale === 'bn'
                    ? 'যেমন: সদস্য সাপোর্টে অনুরোধ করেছেন'
                    : 'e.g. member requested this through the support thread'
                }
                autoComplete="off"
              />
            </div>
            {eraseError && (
              <p className="flex items-start gap-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {eraseError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEraseOpen(false)} disabled={erasing}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleErase()}
              disabled={erasing || eraseConfirm.trim().length === 0 || eraseReason.trim().length < 3}
            >
              {erasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {locale === 'bn' ? 'স্থায়ীভাবে মুছুন' : 'Erase permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Every money action on this page — one dialog, shared with the
          Deposits and Loans screens. */}
      <MoneyActionDialog
        action={moneyAction?.action ?? 'DEPOSIT'}
        open={moneyAction !== null}
        onOpenChange={(next) => {
          if (!next) setMoneyAction(null);
        }}
        memberUserId={memberUserId}
        loanId={moneyAction?.loanId}
        onCompleted={async () => {
          setActionSuccess(moneyActionSuccessMessage(moneyAction?.action ?? 'DEPOSIT', locale));
          await loadMemberDetails();
        }}
      />
    </div>
  );
}
