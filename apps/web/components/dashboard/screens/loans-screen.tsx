'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Download,
  Eye,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useApi } from '@/lib/use-api';
import { formatCurrency } from '@/lib/utils';
import { buildLoanAgreement, downloadDocumentPDF, fetchOrgSettings } from '@/lib/documents';
import { useDashboardRole } from '@/components/dashboard/role';
import { MoneyActionDialog } from '@/components/dashboard/money-actions';

/**
 * Loans — one screen for both staff dashboards.
 *
 * The admin's version listed every loan and could not take an instalment; the
 * worker's could take an instalment and showed a different set of columns, a
 * different status vocabulary (it collapsed the four PENDING_* labels into one
 * "Pending") and its own `dueThisWeek` arithmetic — which multiplied by
 * `7 * 24 * 60 * 600` and so counted a window of ten minutes.
 *
 * One component, the union of both. As with the deposits screen the *scope* of
 * the list still depends on who is asking, because the queries differ, so the
 * endpoint is chosen here and the two payload shapes are normalised into one.
 *
 * Zero interest, zero fees (rule 3): nothing on this screen adds to what a
 * borrower owes. `remainingAmount` comes from the API and the arithmetic here is
 * subtraction and counting.
 */

type LoanStatus =
  | 'PENDING_GUARANTOR'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SETTLED'
  | 'DEFAULTED'
  | 'REJECTED'
  | string;

interface Loan {
  id: string;
  memberUserId: string;
  memberName: string;
  /**
   * The **English** name, for the document.
   *
   * `memberName` above is what the screen shows, and both payloads prefer the
   * Bengali one where it exists. Generated documents are English only
   * ([ADR-012](../../../docs/decisions.md)) and the PDF sanitiser strips every
   * glyph the standard fonts cannot encode — so feeding a Bengali name to
   * `buildReceipt` prints a bare `-` on the Name line of a member's receipt.
   * Both payloads carry `memberName` at the top level and it is always `nameEn`.
   */
  memberNameEn: string;
  accountNo: string;
  memberPhone: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  installmentsPaid: number;
  totalInstallments: number;
  monthlyInstallment: number;
  purpose: string;
  guarantorName: string;
  status: LoanStatus;
  nextDueDate?: string;
  approvedBy?: string;
  disbursedDate?: string;
  /** How many due instalments are unpaid. From the API — see `isOverdue`. */
  missedInstallments: number;
  /**
   * Decided by the API, not here.
   *
   * It used to be `status === 'ACTIVE' && nextDueDate < now`, which sounds
   * right and was wrong twice over, because the two endpoints behind this one
   * component did not agree on what `nextDueDate` meant: `/worker/loans` sent
   * the date the schedule *started*, so every active loan was overdue, and
   * `/admin/loans` sent no date at all, so none was. The same four loans read
   * "4 overdue" in one dashboard and "0 overdue" in the other.
   *
   * Both now come from `money.MissedInstallments` in the Go API, which is the
   * same arithmetic that decides whether a loan may be defaulted. A second
   * implementation in the browser is how those diverge again.
   */
  isOverdue: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING_GUARANTOR: 'bg-amber-100 text-amber-700',
  PENDING_APPROVAL: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  ACTIVE: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-700',
  SETTLED: 'bg-gray-100 text-gray-700',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, { en: string; bn: string }> = {
  PENDING_GUARANTOR: { en: 'Awaiting Guarantor', bn: 'জামিনদার অপেক্ষমাণ' },
  PENDING_APPROVAL: { en: 'Pending Approval', bn: 'অনুমোদন অপেক্ষমাণ' },
  APPROVED: { en: 'Approved', bn: 'অনুমোদিত' },
  ACTIVE: { en: 'Active', bn: 'সক্রিয়' },
  COMPLETED: { en: 'Completed', bn: 'সম্পন্ন' },
  SETTLED: { en: 'Settled', bn: 'নিষ্পত্তি' },
  DEFAULTED: { en: 'Defaulted', bn: 'খেলাপি' },
  REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The admin payload nests member and guarantor; the worker payload is flat. */
function normalise(raw: any): Loan {
  const member = raw?.member ?? {};
  const amount = Number(raw?.amount ?? raw?.principalAmount ?? 0);
  const remainingAmount = Number(raw?.remainingAmount ?? 0);
  const status = String(raw?.status ?? '').toUpperCase();
  const nextDueDate = raw?.nextDueDate ? String(raw.nextDueDate) : undefined;

  return {
    // `id` IS the loan number (ADR-044). The payload used to carry both, and
    // this read the one that no longer exists.
    id: String(raw?.id ?? ''),
    memberUserId: String(member.id ?? raw?.memberUserId ?? ''),
    memberName: String(member.name ?? raw?.memberName ?? ''),
    memberNameEn: String(raw?.memberName ?? member.name ?? ''),
    accountNo: String(member.accountNo ?? raw?.accountNo ?? ''),
    memberPhone: String(raw?.memberPhone ?? ''),
    amount,
    paidAmount: Number(raw?.paidAmount ?? Math.max(amount - remainingAmount, 0)),
    remainingAmount,
    installmentsPaid: Number(raw?.installmentsPaid ?? raw?.paidInstallments ?? 0),
    totalInstallments: Number(raw?.totalInstallments ?? 0),
    monthlyInstallment: Number(raw?.monthlyInstallment ?? raw?.installmentAmount ?? 0),
    purpose: String(raw?.purpose ?? ''),
    guarantorName: String(raw?.guarantor?.name ?? raw?.guarantorName ?? ''),
    status,
    nextDueDate,
    approvedBy: raw?.approvedBy ? String(raw.approvedBy) : undefined,
    disbursedDate: raw?.disbursedDate
      ? String(raw.disbursedDate)
      : raw?.approvedDate
        ? String(raw.approvedDate)
        : undefined,
    missedInstallments: Number(raw?.missedInstallments ?? 0),
    isOverdue: raw?.isOverdue === true,
  };
}

export default function LoansScreen() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const role = useDashboardRole();

  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const listPath = role === 'admin' ? '/v1/dashboard/admin/loans' : '/v1/dashboard/worker/loans';
  const { data, error: loadError, isLoading, refresh: loadLoans } = useApi<any[]>(listPath);
  const loans = useMemo<Loan[]>(() => (data ?? []).map(normalise), [data]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // Which loan the shared instalment dialog is open on. The form, the whole-taka
  // rule, the presets and the refusal messages all live in MoneyActionDialog —
  // this screen had its own copy, which rounded 1500.75 to 1501 and posted it.
  const [payingLoan, setPayingLoan] = useState<Loan | null>(null);
  /** Adding principal to a loan that is already running (ADR-030). */
  const [toppingUpLoan, setToppingUpLoan] = useState<Loan | null>(null);

  const filteredLoans = useMemo(
    () =>
      loans.filter((l) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          l.memberName.toLowerCase().includes(q) ||
          l.accountNo.toLowerCase().includes(q) ||
          l.id.toLowerCase().includes(q) ||
          l.guarantorName.toLowerCase().includes(q);
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'OVERDUE' ? l.isOverdue : l.status === statusFilter);
        return matchesSearch && matchesStatus;
      }),
    [loans, searchQuery, statusFilter],
  );

  const totalDisbursed = loans
    .filter((l) => ['ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED'].includes(l.status))
    .reduce((sum, l) => sum + l.amount, 0);
  const totalRecovered = loans.reduce((sum, l) => sum + l.paidAmount, 0);
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
  const overdueLoans = loans.filter((l) => l.isOverdue).length;
  const defaultedLoans = loans.filter((l) => l.status === 'DEFAULTED').length;
  const recoveryRate =
    totalDisbursed > 0 ? ((totalRecovered / totalDisbursed) * 100).toFixed(1) : '0';
  // Inside a memo because the clock is impure: read once per data change rather
  // than twice per loan per render. The version this replaced added
  // `7 * 24 * 60 * 600` milliseconds — ten minutes — so it counted almost
  // nothing and looked like a quiet week.
  const dueThisWeek = useMemo(() => {
    const now = new Date().getTime();
    return loans.filter((l) => {
      if (!l.nextDueDate || l.status !== 'ACTIVE') return false;
      const due = new Date(l.nextDueDate).getTime();
      return due >= now && due <= now + WEEK_MS;
    }).length;
  }, [loans]);

  const handleDownloadLoan = async (l: Loan) => {
    try {
      const orgSettings = await fetchOrgSettings();
      await downloadDocumentPDF(
        buildLoanAgreement(
          {
            loanNumber: l.id,
            memberName: l.memberNameEn,
            accountNo: l.accountNo,
            memberPhone: l.memberPhone,
            memberAddress: '',
            principalAmount: l.amount,
            totalInstallments: l.totalInstallments,
            installmentAmount: l.monthlyInstallment,
            disbursementDate: l.disbursedDate,
          },
          orgSettings,
        ),
      );
    } catch (error) {
      console.error('Failed to download loan:', error);
    }
  };

  const statusBadge = (l: Loan) => {
    const key = l.isOverdue ? 'OVERDUE' : l.status;
    if (key === 'OVERDUE') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-red-100 text-red-700">
          <AlertTriangle className="h-3 w-3" />
          {locale === 'bn' ? 'বকেয়া' : 'Overdue'}
        </span>
      );
    }
    const label = STATUS_LABELS[key];
    return (
      <span
        className={`px-2 py-0.5 text-xs rounded ${STATUS_STYLES[key] ?? 'bg-slate-100 text-slate-700'}`}
      >
        {label ? (locale === 'bn' ? label.bn : label.en) : key}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'ঋণ ব্যবস্থাপনা' : 'Loan Management'}
          </h1>
          <p className="text-sm text-gray-500">
            {filteredLoans.length} {locale === 'bn' ? 'টি ঋণ' : 'loans'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadLoans()}
          disabled={isLoading}
          className="h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'বিতরণ:' : 'Disbursed:'}</span>{' '}
          <span className="font-medium text-blue-600">{formatCurrency(totalDisbursed, locale)}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'পুনরুদ্ধার:' : 'Recovered:'}</span>{' '}
          <span className="font-medium text-green-600">
            {formatCurrency(totalRecovered, locale)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span>{' '}
          <span className="font-medium">{activeLoans}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'বকেয়া:' : 'Overdue:'}</span>{' '}
          <span className="font-medium text-red-600">{overdueLoans}</span>
        </div>
        <div>
          <span className="text-gray-500">
            {locale === 'bn' ? 'এই সপ্তাহে দেয়:' : 'Due this week:'}
          </span>{' '}
          <span className="font-medium text-amber-600">{dueThisWeek}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'খেলাপি:' : 'Defaulted:'}</span>{' '}
          <span className="font-medium text-red-600">{defaultedLoans}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'হার:' : 'Rate:'}</span>{' '}
          <span className="font-medium text-green-600">{recoveryRate}%</span>
        </div>
      </div>

      {loadError && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
          {loadError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={
              locale === 'bn' ? 'সদস্য বা গ্যারান্টর দিয়ে খুঁজুন...' : 'Search member/guarantor...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <select
          aria-label={tA11y('filterByStatus')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
        >
          <option value="all">{locale === 'bn' ? 'সব স্ট্যাটাস' : 'All Status'}</option>
          <option value="PENDING_GUARANTOR">
            {locale === 'bn' ? 'জামিনদার অপেক্ষমাণ' : 'Awaiting Guarantor'}
          </option>
          <option value="PENDING_APPROVAL">
            {locale === 'bn' ? 'অনুমোদন অপেক্ষমাণ' : 'Pending Approval'}
          </option>
          <option value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</option>
          <option value="OVERDUE">{locale === 'bn' ? 'বকেয়া' : 'Overdue'}</option>
          <option value="COMPLETED">{locale === 'bn' ? 'সম্পন্ন' : 'Completed'}</option>
          <option value="DEFAULTED">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</option>
          <option value="REJECTED">{locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                {locale === 'bn' ? 'সদস্য' : 'Member'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden sm:table-cell">
                {locale === 'bn' ? 'পরিশোধিত' : 'Paid'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden lg:table-cell">
                {locale === 'bn' ? 'বাকি' : 'Remaining'}
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                {locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                {locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : filteredLoans.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো ঋণ পাওয়া যায়নি' : 'No loans found'}
                </td>
              </tr>
            ) : (
              filteredLoans.map((l) => (
                <tr
                  key={l.id}
                  className={`border-b border-gray-100 hover:bg-gray-50 ${l.status === 'DEFAULTED' ? 'bg-red-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{l.memberName}</div>
                    {l.accountNo && <div className="text-xs text-gray-500">{l.accountNo}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-blue-600">
                    {formatCurrency(l.amount, locale)}
                  </td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    <span className="text-green-600">{formatCurrency(l.paidAmount, locale)}</span>
                    <div className="text-xs text-gray-500">
                      {l.installmentsPaid}/{l.totalInstallments}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell text-amber-600">
                    {formatCurrency(l.remainingAmount, locale)}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                    {l.guarantorName || '-'}
                  </td>
                  <td className="px-4 py-3">{statusBadge(l)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {l.status === 'ACTIVE' && l.memberUserId ? (
                        <>
                          <button
                            onClick={() => setPayingLoan(l)}
                            className="text-emerald-600 hover:text-emerald-800"
                            title={locale === 'bn' ? 'কিস্তি গ্রহণ' : 'Record instalment'}
                            aria-label={locale === 'bn' ? 'কিস্তি গ্রহণ করুন' : 'Record instalment'}
                          >
                            <Wallet className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToppingUpLoan(l)}
                            className="text-blue-600 hover:text-blue-800"
                            title={locale === 'bn' ? 'ঋণ বাড়ান' : 'Increase loan'}
                            aria-label={locale === 'bn' ? 'ঋণের পরিমাণ বাড়ান' : 'Add to this loan'}
                          >
                            <PlusCircle className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      <button
                        onClick={() => void handleDownloadLoan(l)}
                        className="text-blue-600 hover:text-blue-800"
                        title={locale === 'bn' ? 'ঋণ ডাউনলোড' : 'Download Loan'}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedLoan(l);
                          setShowDetailModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                        title={locale === 'bn' ? 'ঋণের বিবরণ' : 'View Loan Details'}
                        aria-label={locale === 'bn' ? 'ঋণের বিবরণ দেখুন' : 'View loan details'}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'ঋণ বিস্তারিত' : 'Loan Details'}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
                <span>{selectedLoan.memberName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'নম্বর' : 'Number'}</span>
                <span>{selectedLoan.id || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span>
                <span className="font-medium text-blue-600">
                  {formatCurrency(selectedLoan.amount, locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</span>
                <span className="text-green-600">
                  {formatCurrency(selectedLoan.paidAmount, locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span>
                <span className="text-amber-600">
                  {formatCurrency(selectedLoan.remainingAmount, locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'কিস্তি' : 'Installments'}</span>
                <span>
                  {selectedLoan.installmentsPaid}/{selectedLoan.totalInstallments}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'মাসিক' : 'Monthly'}</span>
                <span>{formatCurrency(selectedLoan.monthlyInstallment, locale)}</span>
              </div>
              {selectedLoan.nextDueDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {locale === 'bn' ? 'পরবর্তী কিস্তি' : 'Next Due'}
                  </span>
                  <span>
                    {new Date(selectedLoan.nextDueDate).toLocaleDateString(
                      locale === 'bn' ? 'bn-BD' : 'en-GB',
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</span>
                <span>{selectedLoan.guarantorName || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</span>
                <span>{selectedLoan.purpose || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                {statusBadge(selectedLoan)}
              </div>
              {selectedLoan.approvedBy && (
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {locale === 'bn' ? 'অনুমোদনকারী' : 'Approved By'}
                  </span>
                  <span>{selectedLoan.approvedBy}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record an instalment — the one implementation, shared with the
          member's page and the deposits screen. */}
      <MoneyActionDialog
        action="LOAN_PAYMENT"
        open={payingLoan !== null}
        onOpenChange={(next) => {
          if (!next) setPayingLoan(null);
        }}
        memberUserId={payingLoan?.memberUserId}
        loanId={payingLoan?.id}
        onCompleted={loadLoans}
      />

      {/* Add to a running loan. Same dialog, same rules — a second form here
          is how the deposit and instalment forms drifted apart before they
          were merged (see money-actions.tsx). */}
      <MoneyActionDialog
        action="LOAN_TOPUP"
        open={toppingUpLoan !== null}
        onOpenChange={(next) => {
          if (!next) setToppingUpLoan(null);
        }}
        memberUserId={toppingUpLoan?.memberUserId}
        loanId={toppingUpLoan?.id}
        onCompleted={loadLoans}
      />
    </div>
  );
}
