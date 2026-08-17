'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, RefreshCw, Eye, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  buildReceipt,
  downloadDocumentPDF,
  fetchOrgSettings,
} from '@/lib/documents';

type DepositStatus = 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
type DepositType = 'DEPOSIT' | 'WITHDRAWAL';

interface Deposit {
  id: string;
  type: DepositType;
  amount: number;
  status: DepositStatus;
  receiptNumber: string;
  notes?: string | null;
  processedBy?: string | null;
  processedDateTime?: string | null;
  processedDate: string;
  confirmedDate?: string | null;
  balanceAfter?: number | null;
  member: { id: string; memberId?: string | null; name: string };
}

type DepositsResponse = { deposits: Deposit[] };

export default function AdminDepositsPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDeposits = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const data = await apiGet<Deposit[] | DepositsResponse>('/v1/dashboard/admin/deposits');
      setDeposits(Array.isArray(data) ? data : (data?.deposits ?? []));
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load transactions');
      setDeposits([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadDeposits(); }, []);

  const handleDownloadReceipt = async (d: Deposit) => {
    try {
      const orgSettings = await fetchOrgSettings();
      const receiptDoc = buildReceipt({
        receiptNumber: d.receiptNumber || d.id,
        type: d.type,
        amount: d.amount,
        date: d.processedDate,
        memberName: d.member.name,
        memberId: d.member.memberId || '',
        memberPhone: '',
        balanceAfter: d.balanceAfter || 0,
        notes: d.notes || undefined,
      }, orgSettings);
      await downloadDocumentPDF(receiptDoc);
    } catch (error) {
      console.error('Failed to download receipt:', error);
    }
  };

  const statusStyles: Record<DepositStatus, string> = {
    CONFIRMED: 'bg-green-100 text-green-700',
    PENDING: 'bg-amber-100 text-amber-700',
    PROCESSED: 'bg-blue-100 text-blue-700',
    DISPUTED: 'bg-red-100 text-red-700',
    REJECTED: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<DepositStatus, { en: string; bn: string }> = {
    CONFIRMED: { en: 'Confirmed', bn: 'নিশ্চিত' },
    PENDING: { en: 'Pending', bn: 'অপেক্ষমাণ' },
    PROCESSED: { en: 'Processed', bn: 'প্রক্রিয়াকৃত' },
    DISPUTED: { en: 'Disputed', bn: 'বিতর্কিত' },
    REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  };

  const filteredDeposits = useMemo(() => deposits.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      d.member.name.toLowerCase().includes(q) ||
      (d.member.memberId ?? '').toLowerCase().includes(q) ||
      (d.processedBy ?? '').toLowerCase().includes(q) ||
      (d.receiptNumber ?? '').toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchesType = typeFilter === 'all' || d.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  }), [deposits, searchQuery, statusFilter, typeFilter]);

  const totalDeposits = deposits.filter((d) => d.type === 'DEPOSIT' && d.status === 'CONFIRMED').reduce((s, d) => s + d.amount, 0);
  const totalWithdrawals = deposits.filter((d) => d.type === 'WITHDRAWAL' && d.status === 'CONFIRMED').reduce((s, d) => s + d.amount, 0);
  const pendingCount = deposits.filter((d) => d.status === 'PENDING').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'জমা ও উত্তোলন' : 'Deposits & Withdrawals'}</h1>
          <p className="text-sm text-gray-500">{filteredDeposits.length} {locale === 'bn' ? 'টি লেনদেন' : 'transactions'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadDeposits()} disabled={isLoading} className="h-8">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-gray-500">{locale === 'bn' ? 'মোট জমা:' : 'Deposits:'}</span> <span className="font-medium text-green-600">{formatCurrency(totalDeposits, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'মোট উত্তোলন:' : 'Withdrawals:'}</span> <span className="font-medium text-purple-600">{formatCurrency(totalWithdrawals, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'অপেক্ষমাণ:' : 'Pending:'}</span> <span className="font-medium text-amber-600">{pendingCount}</span></div>
      </div>

      {actionError && <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{actionError}</div>}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={locale === 'bn' ? 'সদস্য, কর্মী, ট্রানজেকশন নম্বর দিয়ে খুঁজুন...' : 'Search member, processor, transaction number...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <select aria-label={tA11y('filterByType')} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500">
          <option value="all">{locale === 'bn' ? 'সব ধরন' : 'All Types'}</option>
          <option value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposit'}</option>
          <option value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawal'}</option>
        </select>
        <select aria-label={tA11y('filterByStatus')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500">
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
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'সদস্য' : 'Member'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ধরন' : 'Type'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden lg:table-cell">{locale === 'bn' ? 'ট্রানজেকশন নম্বর' : 'Transaction No'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : filteredDeposits.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}</td></tr>
            ) : filteredDeposits.map((d) => (
              <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{d.member.name}</div>
                  {d.member.memberId && <div className="text-xs text-gray-500">{d.member.memberId}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs rounded ${d.type === 'DEPOSIT' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                    {d.type === 'DEPOSIT' ? (locale === 'bn' ? 'জমা' : 'Deposit') : (locale === 'bn' ? 'উত্তোলন' : 'Withdrawal')}
                  </span>
                </td>
                <td className={`px-4 py-3 text-right font-medium ${d.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}`}>
                  {d.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(d.amount, locale)}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className={`px-2 py-0.5 text-xs rounded ${statusStyles[d.status]}`}>
                    {locale === 'bn' ? statusLabels[d.status].bn : statusLabels[d.status].en}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-600">
                  {d.receiptNumber || d.id}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                  {new Date(d.processedDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => void handleDownloadReceipt(d)} className="text-blue-600 hover:text-blue-800" title={locale === 'bn' ? 'রশিদ ডাউনলোড' : 'Download Receipt'}>
                      <Download className="h-4 w-4" />
                    </button>
                    <button onClick={() => { setSelectedDeposit(d); setShowDetailModal(true); }} className="text-blue-600 hover:text-blue-800">
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'লেনদেন বিস্তারিত' : 'Transaction Details'}</DialogTitle>
          </DialogHeader>
          {selectedDeposit && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'সদস্য' : 'Member'}</span><span>{selectedDeposit.member.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'ধরন' : 'Type'}</span><span className={selectedDeposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}>{selectedDeposit.type === 'DEPOSIT' ? (locale === 'bn' ? 'জমা' : 'Deposit') : (locale === 'bn' ? 'উত্তোলন' : 'Withdrawal')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span><span className={`font-medium ${selectedDeposit.type === 'DEPOSIT' ? 'text-green-600' : 'text-purple-600'}`}>{selectedDeposit.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(selectedDeposit.amount, locale)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span><span className={`px-2 py-0.5 text-xs rounded ${statusStyles[selectedDeposit.status]}`}>{locale === 'bn' ? statusLabels[selectedDeposit.status].bn : statusLabels[selectedDeposit.status].en}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'রসিদ' : 'Receipt'}</span><span>{selectedDeposit.receiptNumber}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'প্রসেসকারী' : 'Processor'}</span><span>{selectedDeposit.processedBy ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'তারিখ' : 'Date'}</span><span>{new Date(selectedDeposit.processedDate).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}</span></div>
              {selectedDeposit.notes && <div className="p-2 bg-gray-50 text-xs"><span className="text-gray-500">{locale === 'bn' ? 'নোট:' : 'Note:'}</span> {selectedDeposit.notes}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetailModal(false)}>{locale === 'bn' ? 'বন্ধ' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
