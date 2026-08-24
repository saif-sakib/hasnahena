'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import useSWR, { mutate as globalMutate } from 'swr';
import { AlertCircle, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { apiPost } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { fetchSettings } from '@/lib/settings-client';
import { formatCurrency, getLoanRepaymentPresets, parseWholeTaka } from '@/lib/utils';

/**
 * The four ways staff move a member's money — in one place.
 *
 * ## Why
 *
 * Each of them existed twice. A deposit could be recorded from the member's
 * page and from the Deposits & Withdrawals screen; a loan instalment from the
 * member's page and from the Loans screen. Two implementations of one action,
 * and they had already drifted apart in ways that matter:
 *
 *  - the member page parses whole taka and **refuses** 1500.75 (rule 1); the
 *    list screens ran `Math.round(Number.parseFloat(...))`, so the same typed
 *    amount silently posted 1501 and reported success. That exact bug was found
 *    and fixed once already — on one of the two copies.
 *  - the member page refuses a withdrawal with no matured notice behind it
 *    (FR-08) because it can see the notices; the deposits screen checked the
 *    balance only, so the worker submitted, waited, and got a 409 from the API
 *    with no idea a notice was the thing missing.
 *  - the member page caps an instalment at what is left owing and offers
 *    weekly/monthly/full presets; the loans screen offered neither.
 *
 * Whichever copy you happened to use decided which rules you got. So there is
 * one now, and every screen opens it.
 *
 * ## Shape
 *
 * The dialog owns the *rules*, so it needs the facts they are about — the
 * balance, the matured notices, the loan eligibility, what is left on each
 * loan. All of that is on `/v1/dashboard/worker/members/{id}`, so the dialog
 * fetches it rather than making each caller pass a different subset. SWR keys
 * on the path, so opening this from the member's own page costs no request: the
 * page has already loaded it.
 *
 * A caller that has no member yet (the Deposits screen's "Deposit" button) omits
 * `memberUserId` and gets a member picker as the first step.
 *
 * ## Zero interest, zero fees (rule 3)
 *
 * Nothing here adds to what a borrower owes. A loan application posts the
 * principal and a number of instalments; the instalment amount is the API's
 * arithmetic, and every figure below is a subtraction.
 */

export type MoneyAction =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'LOAN_PAYMENT'
  | 'LOAN_APPLICATION'
  | 'LOAN_TOPUP';

/** An unpaid withdrawal request. Pre-ADR-030 rows; nothing creates new ones. */
interface PendingWithdrawal {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
}

interface MemberFacts {
  id: string;
  accountNo: string;
  name: string;
  phone: string;
  status: string;
  currentDeposit: number;
  pendingWithdrawals: PendingWithdrawal[];
  loanEligibility: { eligible: boolean; maxLoanAmount: number; reason?: string };
}

interface LoanFacts {
  id: string;
  loanNumber: string;
  status: string;
  remainingAmount: number;
  installmentAmount: number;
  paidInstallments: number;
  totalInstallments: number;
}

interface MemberOption {
  id: string;
  name: string;
  accountNo: string;
  phone: string;
  balance: number;
}

export interface MoneyActionDialogProps {
  action: MoneyAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to let the dialog ask which member first. */
  memberUserId?: string;
  /** Pre-selects a loan for LOAN_PAYMENT. */
  loanId?: string;
  /** Called after the API accepted the posting, so the caller can re-fetch. */
  onCompleted?: () => void | Promise<void>;
}

const TITLES: Record<MoneyAction, { en: string; bn: string }> = {
  DEPOSIT: { en: 'Record Deposit', bn: 'জমা রেকর্ড করুন' },
  WITHDRAWAL: { en: 'Pay Withdrawal', bn: 'উত্তোলন পরিশোধ' },
  LOAN_PAYMENT: { en: 'Record Instalment', bn: 'কিস্তি রেকর্ড করুন' },
  LOAN_APPLICATION: { en: 'New Loan Application', bn: 'নতুন ঋণ আবেদন' },
  LOAN_TOPUP: { en: 'Increase Loan', bn: 'ঋণ বৃদ্ধি' },
};

const SUBMIT_LABELS: Record<MoneyAction, { en: string; bn: string }> = {
  DEPOSIT: { en: 'Record Deposit', bn: 'জমা করুন' },
  WITHDRAWAL: { en: 'Pay Out', bn: 'পরিশোধ করুন' },
  LOAN_PAYMENT: { en: 'Record Payment', bn: 'পরিশোধ রেকর্ড' },
  LOAN_APPLICATION: { en: 'Submit Application', bn: 'আবেদন জমা দিন' },
  LOAN_TOPUP: { en: 'Add to Loan', bn: 'ঋণে যোগ করুন' },
};

const SUCCESS: Record<MoneyAction, { en: string; bn: string }> = {
  DEPOSIT: { en: 'Deposit recorded', bn: 'জমা সফল হয়েছে' },
  WITHDRAWAL: { en: 'Withdrawal paid', bn: 'উত্তোলন সফল হয়েছে' },
  LOAN_PAYMENT: { en: 'Instalment recorded', bn: 'কিস্তি রেকর্ড হয়েছে' },
  LOAN_APPLICATION: { en: 'Application submitted', bn: 'আবেদন জমা হয়েছে' },
  LOAN_TOPUP: { en: 'Loan increased', bn: 'ঋণ বৃদ্ধি হয়েছে' },
};

export function MoneyActionDialog({
  action,
  open,
  onOpenChange,
  memberUserId,
  loanId,
  onCompleted,
}: MoneyActionDialogProps) {
  const locale = useLocale();
  const bn = locale === 'bn';

  const [pickedMemberId, setPickedMemberId] = useState<string | null>(null);
  const targetId = memberUserId ?? pickedMemberId;

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [purpose, setPurpose] = useState('');
  const [installments, setInstallments] = useState('12');
  const [pickedLoanId, setPickedLoanId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only fetched while the dialog is open and a member is known. SWR keys on
  // the path, so this is free when the caller is the member's own page.
  const { data: detail, isLoading: isDetailLoading } = useApi<{
    member: MemberFacts;
    loans: LoanFacts[];
  }>(open && targetId ? `/v1/dashboard/worker/members/${targetId}` : null);

  // Only the member picker needs the list, and only when no member was given.
  const { data: memberRows } = useApi<any[]>(
    open && !targetId ? '/v1/dashboard/worker/members' : null,
  );

  // Carries the token: `loan.maxInstallmentMonths` is not in the anonymous tier.
  const { data: settings } = useSWR<Record<string, string> | null>(
    open && action === 'LOAN_APPLICATION' ? '/api/v1/settings' : null,
    () => fetchSettings(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const maxInstallmentMonths = useMemo(() => {
    const parsed = Number(settings?.['loan.maxInstallmentMonths']);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 24;
  }, [settings]);

  const member = detail?.member ?? null;

  const members = useMemo<MemberOption[]>(
    () =>
      (memberRows ?? []).map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        accountNo: String(row.accountNo ?? row.uid ?? ''),
        phone: String(row.phone ?? ''),
        balance: Number(row.currentDeposit ?? 0),
      })),
    [memberRows],
  );

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members.slice(0, 25);
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.accountNo.toLowerCase().includes(q) ||
          m.phone.includes(memberSearch.trim()),
      )
      .slice(0, 25);
  }, [members, memberSearch]);

  const payableLoans = useMemo(
    () => (detail?.loans ?? []).filter((l) => l.status === 'ACTIVE' && l.remainingAmount > 0),
    [detail],
  );

  const selectedLoan = useMemo(() => {
    const wanted = pickedLoanId ?? loanId;
    return payableLoans.find((l) => l.id === wanted) ?? payableLoans[0] ?? null;
  }, [payableLoans, pickedLoanId, loanId]);

  // Outstanding requests are no longer a precondition of anything (ADR-030) —
  // they are a note to the worker at the desk: this member already asked for
  // ৳5,000, so settle that rather than pay it twice. The API consumes the
  // largest one a payout covers.
  const largestPendingWithdrawal = useMemo(
    () => (member?.pendingWithdrawals ?? []).reduce((max, n) => Math.max(max, n.amount), 0),
    [member],
  );

  // What the instalment becomes if this top-up is posted. The same arithmetic
  // as money.TopUpPlan in the Go API — deliberately, so the figure shown before
  // submitting is the figure the API writes. It is a preview only: the API's
  // answer is the one that counts, and it recomputes from the row it locks.
  const topUpInstalment = useMemo(() => {
    if (action !== 'LOAN_TOPUP' || !selectedLoan) return null;
    const added = parseWholeTaka(amount);
    if (!added) return null;
    const left = Math.max(1, selectedLoan.totalInstallments - selectedLoan.paidInstallments);
    return Math.floor((selectedLoan.remainingAmount + added) / left);
  }, [action, selectedLoan, amount]);

  const reset = () => {
    setAmount('');
    setNotes('');
    setPurpose('');
    setInstallments('12');
    setPickedLoanId(null);
    setPickedMemberId(null);
    setMemberSearch('');
    setError(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const invalidAmount = bn
    ? 'পূর্ণ টাকায় পরিমাণ দিন (পয়সা নয়)'
    : 'Enter a whole-taka amount, with no paisa';

  /**
   * Every client-side rule, in one function, returning the first reason this
   * cannot be submitted.
   *
   * The API refuses all of these too and its answer is the one that counts —
   * these exist so a worker is not made to submit a form to be told a fact the
   * screen already had. Nothing here is a *substitute* for the server check:
   * the notice maturity date and the loan eligibility both come from the API.
   */
  const validate = (value: number): string | null => {
    if (!member) return bn ? 'সদস্যের তথ্য পাওয়া যায়নি' : 'Member details not loaded';

    if (action === 'WITHDRAWAL') {
      if (value > member.currentDeposit) {
        return bn ? 'অপর্যাপ্ত ব্যালেন্স' : 'Insufficient balance';
      }
      // No notice check (ADR-030). This used to refuse unless a matured notice
      // covered the amount, which was the single most common outcome of the
      // screen. Staff pay when the member asks; the balance is the only
      // client-side rule left, and the API still refuses a suspended member or
      // one whose savings are locked by a guarantee.
    }

    if (action === 'LOAN_PAYMENT') {
      if (!selectedLoan) return bn ? 'কোনো সক্রিয় ঋণ নেই' : 'This member has no active loan';
      if (value > selectedLoan.remainingAmount) {
        return bn
          ? `সর্বোচ্চ পরিশোধযোগ্য: ${formatCurrency(selectedLoan.remainingAmount, locale)}`
          : `Maximum payable: ${formatCurrency(selectedLoan.remainingAmount, locale)}`;
      }
    }

    if (action === 'LOAN_TOPUP') {
      if (!selectedLoan) return bn ? 'কোনো সক্রিয় ঋণ নেই' : 'This member has no active loan';
      // The ceiling is against what they will owe in TOTAL, which is the same
      // arithmetic the API does. Checking the increment alone would let five
      // small top-ups do what one large loan is refused.
      const wouldOwe = selectedLoan.remainingAmount + value;
      if (wouldOwe > member.loanEligibility.maxLoanAmount) {
        return bn
          ? `এতে মোট বকেয়া দাঁড়াবে ${formatCurrency(wouldOwe, locale)}, সর্বোচ্চ সীমা ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)}`
          : `That would take the total owed to ${formatCurrency(wouldOwe, locale)}, above the ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)} limit`;
      }
    }

    if (action === 'LOAN_APPLICATION') {
      const months = Number.parseInt(installments, 10);
      if (!Number.isFinite(months) || months < 1 || months > maxInstallmentMonths) {
        return bn
          ? `কিস্তি সংখ্যা ১ থেকে ${maxInstallmentMonths} এর মধ্যে দিন`
          : `Enter instalments between 1 and ${maxInstallmentMonths}`;
      }
      if (!purpose.trim()) return bn ? 'ঋণের উদ্দেশ্য লিখুন' : 'Enter the loan purpose';
      if (value > member.loanEligibility.maxLoanAmount) {
        return bn
          ? `সর্বোচ্চ ঋণ সীমা: ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)}`
          : `Maximum loan: ${formatCurrency(member.loanEligibility.maxLoanAmount, locale)}`;
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    const value = parseWholeTaka(amount);
    if (!value) {
      setError(invalidAmount);
      return;
    }
    const refusal = validate(value);
    if (refusal) {
      setError(refusal);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const base = `/v1/dashboard/worker/members/${targetId}`;
      if (action === 'DEPOSIT') {
        await apiPost(`${base}/deposit`, { amount: value, notes: notes.trim() });
      } else if (action === 'WITHDRAWAL') {
        await apiPost(`${base}/withdrawal`, { amount: value, notes: notes.trim() });
      } else if (action === 'LOAN_PAYMENT') {
        await apiPost(`${base}/loan-payment`, {
          loanId: selectedLoan?.id,
          amount: value,
          notes: notes.trim(),
        });
      } else if (action === 'LOAN_TOPUP') {
        await apiPost(`${base}/loan-topup`, {
          loanId: selectedLoan?.id,
          amount: value,
          notes: notes.trim(),
        });
      } else {
        await apiPost(`${base}/loan`, {
          amount: value,
          purpose: purpose.trim(),
          installments: Number.parseInt(installments, 10),
        });
      }
      // The member's balance, notices and loans all just changed, and so did
      // the balance the picker shows. Invalidating here rather than leaving it
      // to each caller is the same reason the rules live here: three callers
      // meant three chances to forget one, and a stale balance on a money
      // screen is indistinguishable from a posting that did not happen.
      await Promise.all([
        globalMutate(`/v1/dashboard/worker/members/${targetId}`),
        globalMutate('/v1/dashboard/worker/members'),
      ]);
      await onCompleted?.();
      close();
    } catch (e: any) {
      // The API's own words. It refuses for reasons this screen cannot know —
      // a suspended member, a guarantor obligation, a notice that has not
      // matured — and each of those is an answer, not a fault (rule 2b).
      setError(e?.message || (bn ? 'অনুরোধ ব্যর্থ হয়েছে' : 'Request failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = bn ? TITLES[action].bn : TITLES[action].en;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {member
              ? `${member.name} · ${member.accountNo}`
              : bn
                ? 'সদস্য নির্বাচন করুন'
                : 'Choose a member'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: which member ---- */}
        {!targetId && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                autoFocus
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder={bn ? 'নাম, অ্যাকাউন্ট নং বা ফোন' : 'Name, account no or phone'}
                className="pl-9 h-9"
              />
            </div>
            <div className="max-h-64 overflow-y-auto border border-gray-200 divide-y divide-gray-100">
              {filteredMembers.length === 0 ? (
                <p className="px-3 py-6 text-sm text-center text-gray-500">
                  {bn ? 'কোনো সদস্য পাওয়া যায়নি' : 'No members found'}
                </p>
              ) : (
                filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPickedMemberId(m.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{m.name}</span>
                      <span className="block text-xs text-gray-500">
                        {m.accountNo} · {m.phone}
                      </span>
                    </span>
                    <span className="text-xs text-gray-600 shrink-0">
                      {formatCurrency(m.balance, locale)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- Step 2: the posting ---- */}
        {targetId && isDetailLoading && (
          <div className="py-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" />
          </div>
        )}

        {targetId && !isDetailLoading && member && (
          <div className="space-y-3">
            {/* What the rules are about, shown rather than left implicit. */}
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">{bn ? 'সঞ্চয়' : 'Savings'}</span>
                <span className="font-medium">
                  {formatCurrency(member.currentDeposit, locale)}
                </span>
              </div>
              {/* Shown only when there is one. It is no longer a precondition
                  (ADR-030) — it is the reason to check before paying twice. */}
              {action === 'WITHDRAWAL' && largestPendingWithdrawal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {bn ? 'অপরিশোধিত অনুরোধ' : 'Already requested'}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(largestPendingWithdrawal, locale)}
                  </span>
                </div>
              )}
              {(action === 'LOAN_PAYMENT' || action === 'LOAN_TOPUP') && selectedLoan && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{bn ? 'বাকি' : 'Remaining'}</span>
                  <span className="font-medium">
                    {formatCurrency(selectedLoan.remainingAmount, locale)}
                  </span>
                </div>
              )}
              {(action === 'LOAN_APPLICATION' || action === 'LOAN_TOPUP') && (
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {action === 'LOAN_TOPUP'
                      ? bn
                        ? 'সর্বোচ্চ মোট বকেয়া'
                        : 'Maximum total owed'
                      : bn
                        ? 'সর্বোচ্চ ঋণ'
                        : 'Maximum loan'}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(member.loanEligibility.maxLoanAmount, locale)}
                  </span>
                </div>
              )}
              {/* What actually changes for the borrower: the schedule keeps its
                  end date, so the instalment goes up. Shown before submitting
                  rather than discovered at the next collection. */}
              {action === 'LOAN_TOPUP' && selectedLoan && topUpInstalment !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{bn ? 'নতুন কিস্তি' : 'New instalment'}</span>
                  <span className="font-medium">
                    {formatCurrency(selectedLoan.installmentAmount, locale)} →{' '}
                    {formatCurrency(topUpInstalment, locale)}
                  </span>
                </div>
              )}
            </div>

            {/* LOAN_APPLICATION only. `eligible` is false whenever the member
                already holds a loan, which is the precondition of a top-up — so
                showing it there would warn about the thing being done. */}
            {action === 'LOAN_APPLICATION' && !member.loanEligibility.eligible && (
              <p className="flex items-start gap-2 px-3 py-2 text-sm text-amber-800 bg-amber-50 border border-amber-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {member.loanEligibility.reason ||
                  (bn ? 'এই সদস্য ঋণের যোগ্য নন' : 'This member is not eligible for a loan')}
              </p>
            )}

            {(action === 'LOAN_PAYMENT' || action === 'LOAN_TOPUP') && payableLoans.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="money-action-loan">{bn ? 'ঋণ' : 'Loan'}</Label>
                <select
                  id="money-action-loan"
                  value={selectedLoan?.id ?? ''}
                  onChange={(e) => setPickedLoanId(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
                >
                  {payableLoans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.loanNumber} — {formatCurrency(l.remainingAmount, locale)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="money-action-amount">{bn ? 'পরিমাণ (৳)' : 'Amount (BDT)'}</Label>
              <Input
                id="money-action-amount"
                type="number"
                step="1"
                min="1"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="h-9"
              />
              {action === 'LOAN_PAYMENT' && selectedLoan && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {(() => {
                    const presets = getLoanRepaymentPresets(
                      selectedLoan.installmentAmount,
                      selectedLoan.remainingAmount,
                    );
                    const options: Array<[string, string, number]> = [
                      ['weekly', bn ? 'সাপ্তাহিক' : 'Weekly', presets.weekly],
                      ['monthly', bn ? 'মাসিক কিস্তি' : 'Monthly', presets.monthly],
                      ['full', bn ? 'সম্পূর্ণ' : 'Full', presets.full],
                    ];
                    return options
                      .filter(([, , value]) => value > 0)
                      .map(([key, label, value]) => (
                        <Button
                          key={key}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setAmount(String(value))}
                        >
                          {label} · {formatCurrency(value, locale)}
                        </Button>
                      ));
                  })()}
                </div>
              )}
              {action === 'WITHDRAWAL' && largestPendingWithdrawal > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs mt-1"
                  onClick={() => setAmount(String(largestPendingWithdrawal))}
                >
                  {bn ? 'অনুরোধের পরিমাণ' : 'Requested amount'} ·{' '}
                  {formatCurrency(largestPendingWithdrawal, locale)}
                </Button>
              )}
            </div>

            {action === 'LOAN_APPLICATION' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="money-action-installments">
                    {bn ? 'কিস্তি সংখ্যা (মাস)' : 'Instalments (months)'}
                  </Label>
                  <Input
                    id="money-action-installments"
                    type="number"
                    step="1"
                    min="1"
                    max={maxInstallmentMonths}
                    inputMode="numeric"
                    value={installments}
                    onChange={(e) => setInstallments(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="money-action-purpose">{bn ? 'উদ্দেশ্য' : 'Purpose'}</Label>
                  <Textarea
                    id="money-action-purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={2}
                    placeholder={bn ? 'ঋণের উদ্দেশ্য' : 'What the loan is for'}
                  />
                </div>
              </>
            )}

            {action !== 'LOAN_APPLICATION' && (
              <div className="space-y-1">
                <Label htmlFor="money-action-notes">
                  {bn ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}
                </Label>
                <Textarea
                  id="money-action-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            {error && (
              <p className="flex items-start gap-2 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}

        {!targetId && error && (
          <p className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isSubmitting}>
            {bn ? 'বাতিল' : 'Cancel'}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!member || isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {bn ? SUBMIT_LABELS[action].bn : SUBMIT_LABELS[action].en}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The confirmation copy each action reports on success. Exported for callers
 * that show a toast of their own. */
export function moneyActionSuccessMessage(action: MoneyAction, locale: string): string {
  return locale === 'bn' ? SUCCESS[action].bn : SUCCESS[action].en;
}
