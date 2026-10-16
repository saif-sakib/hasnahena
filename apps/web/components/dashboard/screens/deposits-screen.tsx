'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
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
import { buildReceipt, downloadDocumentPDF, fetchOrgSettings } from '@/lib/documents';
import { useDashboardRole } from '@/components/dashboard/role';
import { MoneyActionDialog, type MoneyAction } from '@/components/dashboard/money-actions';

/**
 * Deposits and withdrawals for both staff dashboards. The list's scope differs
 * by role (admin: the whole ledger; worker: their own postings), so the
 * endpoint is chosen here and both payloads are normalised.
 */

type PostingStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED' | string;
type PostingType = 'DEPOSIT' | 'WITHDRAWAL';

interface Posting {
  /** The receipt number — `DEP-2026-000001`. The id IS it (ADR-044). */
  id: string;
  type: PostingType;
  amount: number;
  status: PostingStatus;
  notes?: string;
  processedBy?: string;
  date: string;
  balanceAfter: number;
  memberId: string;
  memberName: string;
  /** The English name, for documents (English only, ADR-012). */
  memberNameEn: string;
  memberPhone: string;
  accountNo: string;
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  PROCESSED: 'bg-blue-100 text-blue-700',
  DISPUTED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, { en: string; bn: string }> = {
  CONFIRMED: { en: 'Confirmed', bn: 'নিশ্চিত' },
  PENDING: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  PROCESSED: { en: 'Processed', bn: 'প্রক্রিয়াকৃত' },
  DISPUTED: { en: 'Disputed', bn: 'বিতর্কিত' },
  REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
};

/** The admin payload nests the member; the worker payload is flat. */
function normalise(raw: any): Posting | null {
  const type = String(raw?.type ?? '').toUpperCase();
  if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') return null;
  const member = raw?.member ?? {};
  return {
    id: String(raw?.id ?? ''),
    type,
    amount: Number(raw?.amount ?? 0),
    status: String(raw?.status ?? 'CONFIRMED').toUpperCase(),
    notes: raw?.notes ? String(raw.notes) : raw?.description ? String(raw.description) : undefined,
    processedBy: raw?.processedBy ? String(raw.processedBy) : undefined,
    date: String(raw?.processedDate ?? raw?.date ?? new Date().toISOString()),
    balanceAfter: Number(raw?.balanceAfter ?? 0),
    memberId: String(member.id ?? raw?.memberUserId ?? ''),
    memberName: String(member.name ?? raw?.memberName ?? ''),
    memberNameEn: String(raw?.memberName ?? member.name ?? ''),
    memberPhone: String(member.phone ?? raw?.memberPhone ?? ''),
    accountNo: String(member.accountNo ?? raw?.accountNo ?? ''),
  };
}

export default function DepositsScreen() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const role = useDashboardRole();

  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const listPath =
    role === 'admin' ? '/v1/dashboard/admin/deposits' : '/v1/dashboard/worker/transactions';
  const {
    data,
    error: loadError,
    isLoading,
    refresh: reloadPostings,
  } = useApi<any>(listPath);

  const postings = useMemo<Posting[]>(() => {
    const rows: any[] = Array.isArray(data) ? data : (data?.deposits ?? []);
    return rows.map(normalise).filter((row): row is Posting => row !== null);
  }, [data]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<Posting | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // The posting the shared MoneyActionDialog is open on.
  const [formAction, setFormAction] = useState<MoneyAction | null>(null);

  const filtered = useMemo(
    () =>
      postings.filter((p) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          p.memberName.toLowerCase().includes(q) ||
          p.accountNo.toLowerCase().includes(q) ||
          p.memberPhone.includes(searchQuery) ||
          (p.processedBy ?? '').toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
        const matchesType = typeFilter === 'all' || p.type === typeFilter;
        return matchesSearch && matchesStatus && matchesType;
      }),
    [postings, searchQuery, statusFilter, typeFilter],
  );

  // Rule 6a: only CONFIRMED moved money.
  const totalDeposits = postings
    .filter((p) => p.type === 'DEPOSIT' && p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalWithdrawals = postings
    .filter((p) => p.type === 'WITHDRAWAL' && p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingCount = postings.filter((p) => p.status === 'PENDING').length;

  const handleDownloadReceipt = async (p: Posting) => {
    try {
      const orgSettings = await fetchOrgSettings();
      await downloadDocumentPDF(
        buildReceipt(
          {
            receiptNumber: p.id,
            type: p.type,
            amount: p.amount,
            date: p.date,
            memberName: p.memberNameEn,
            accountNo: p.accountNo,
            memberPhone: p.memberPhone,
            balanceAfter: p.balanceAfter,
            notes: p.notes,
          },
          orgSettings,
        ),
      );
    } catch (error) {
      console.error('Failed to download receipt:', error);
    }
  };

  const statusLabel = (status: string) =>
    STATUS_LABELS[status]
      ? locale === 'bn'
        ? STATUS_LABELS[status].bn
        : STATUS_LABELS[status].en
      : status;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'জমা ও উত্তোলন' : 'Deposits & Withdrawals'}
          </h1>
          {/* The scope, stated — admin and worker totals answer different questions. */}
          <p className="text-sm text-gray-500">
            {filtered.length}{' '}
            {locale === 'bn' ? 'টি লেনদেন' : 'transactions'}
            {' · '}
            {role === 'admin'
              ? locale === 'bn'
                ? 'পুরো ফাউন্ডেশন'
                : 'whole foundation'
              : locale === 'bn'
                ? 'আপনার প্রক্রিয়াকৃত'
                : 'processed by you'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reloadPostings()}
            disabled={isLoading}
            className="h-8"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
          </Button>
          <Button
            size="sm"
            onClick={() => setFormAction('DEPOSIT')}
            className="h-8 bg-green-600 hover:bg-green-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            {locale === 'bn' ? 'জমা' : 'Deposit'}
          </Button>
          <Button
            size="sm"
            onClick={() => setFormAction('WITHDRAWAL')}
            className="h-8 bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            {locale === 'bn' ? 'উত্তোলন' : 'Withdraw'}
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'মোট জমা:' : 'Deposits:'}</span>{' '}
          <span className="font-medium text-green-600">{formatCurrency(totalDeposits, locale)}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'মোট উত্তোলন:' : 'Withdrawals:'}</span>{' '}
          <span className="font-medium text-purple-600">
            {formatCurrency(totalWithdrawals, locale)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'অপেক্ষমাণ:' : 'Pending:'}</span>{' '}
          <span className="font-medium text-amber-600">{pendingCount}</span>
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
              locale === 'bn'
                ? 'সদস্য, কর্মী, ট্রানজেকশন নম্বর দিয়ে খুঁজুন...'
                : 'Search member, processor, transaction number...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <select
          aria-label={tA11y('filterByType')}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
        >
          <option value="all">{locale === 'bn' ? 'সব ধরন' : 'All Types'}</option>
          <option value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</option>
          <option value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</option>
        </select>
        <select
          aria-label={tA11y('filterByStatus')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
        >
          <option value="all">{locale === 'bn' ? 'সব স্ট্যাটাস' : 'All Status'}</option>
          <option value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</option>
          <option value="PROCESSED">{locale === 'bn' ? 'প্রক্রিয়াকৃত' : 'Processed'}</option>
          <option value="CONFIRMED">{locale === 'bn' ? 'নিশ্চিত' : 'Confirmed'}</option>
          <option value="DISPUTED">{locale === 'bn' ? 'বিতর্কিত' : 'Disputed'}</option>
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
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                {locale === 'bn' ? 'ধরন' : 'Type'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden md:table-cell">
                {locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">
                {locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden lg:table-cell">
                {locale === 'bn' ? 'ট্রানজেকশন নম্বর' : 'Transaction No'}
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                {locale === 'bn' ? 'তারিখ' : 'Date'}
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{p.memberName}</div>
                    {p.accountNo && <div className="text-xs text-gray-500">{p.accountNo}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
                        p.type === 'DEPOSIT'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {p.type === 'DEPOSIT' ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {p.type === 'DEPOSIT'
                        ? locale === 'bn'
                          ? 'জমা'
                          : 'Deposit'
                        : locale === 'bn'
                          ? 'উত্তোলন'
                          : 'Withdrawal'}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      p.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'
                    }`}
                  >
                    {p.type === 'DEPOSIT' ? '+' : '-'}
                    {formatCurrency(p.amount, locale)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">
                    {formatCurrency(p.balanceAfter, locale)}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${STATUS_STYLES[p.status] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-600">
                    {p.id}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                    {new Date(p.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => void handleDownloadReceipt(p)}
                        className="text-blue-600 hover:text-blue-800"
                        title={locale === 'bn' ? 'রশিদ ডাউনলোড' : 'Download Receipt'}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelected(p);
                          setShowDetail(true);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                        title={locale === 'bn' ? 'বিস্তারিত' : 'Details'}
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
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'লেনদেন বিস্তারিত' : 'Transaction Details'}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'সদস্য' : 'Member'}</span>
                <span>{selected.memberName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'ধরন' : 'Type'}</span>
                <span className={selected.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}>
                  {selected.type === 'DEPOSIT'
                    ? locale === 'bn'
                      ? 'জমা'
                      : 'Deposit'
                    : locale === 'bn'
                      ? 'উত্তোলন'
                      : 'Withdrawal'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span>
                <span
                  className={`font-medium ${selected.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}`}
                >
                  {selected.type === 'DEPOSIT' ? '+' : '-'}
                  {formatCurrency(selected.amount, locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}</span>
                <span>{formatCurrency(selected.balanceAfter, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded ${STATUS_STYLES[selected.status] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {statusLabel(selected.status)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'রসিদ' : 'Receipt'}</span>
                <span>{selected.id || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'প্রসেসকারী' : 'Processor'}</span>
                <span>{selected.processedBy ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{locale === 'bn' ? 'তারিখ' : 'Date'}</span>
                <span>
                  {new Date(selected.date).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}
                </span>
              </div>
              {selected.notes && (
                <div className="p-2 bg-gray-50 text-xs">
                  <span className="text-gray-500">{locale === 'bn' ? 'নোট:' : 'Note:'}</span>{' '}
                  {selected.notes}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetail(false)}>
              {locale === 'bn' ? 'বন্ধ' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record a posting — the one implementation, shared with the member's
          page and the loans screen. It asks which member itself. */}
      <MoneyActionDialog
        action={formAction ?? 'DEPOSIT'}
        open={formAction !== null}
        onOpenChange={(next) => {
          if (!next) setFormAction(null);
        }}
        onCompleted={reloadPostings}
      />
    </div>
  );
}
