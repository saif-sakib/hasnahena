'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, RefreshCw, Eye, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useApi } from '@/lib/use-api';
import { formatCurrency } from '@/lib/utils';
import {
  buildLoanAgreement,
  downloadDocumentPDF,
  fetchOrgSettings,
} from '@/lib/documents';

type LoanStatus = 'PENDING_GUARANTOR' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'DEFAULTED' | 'REJECTED';

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
  approvedBy?: string | null;
  member: { id: string; memberId?: string | null; name: string };
  guarantor?: { id: string; name: string } | null;
  memberDeposit: number;
  missedPayments: number;
}

export default function AdminLoansPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // WO-27 — SWR owns the request, the loading flag and the error, so there is
  // no effect writing state. See lib/use-api.ts.
  const {
    data: loansData,
    error: actionError,
    isLoading,
    refresh: loadLoans,
  } = useApi<Loan[]>('/v1/dashboard/admin/loans');
  const loans = useMemo<Loan[]>(() => loansData ?? [], [loansData]);

  const handleDownloadLoan = async (l: Loan) => {
    try {
      const orgSettings = await fetchOrgSettings();
      const loanDoc = buildLoanAgreement({
        loanNumber: l.loanNumber,
        memberName: l.member.name,
        memberId: l.member.memberId || '',
        memberPhone: '',
        memberAddress: '',
        principalAmount: l.amount,
        totalInstallments: l.totalInstallments,
        installmentAmount: l.monthlyInstallment,
        disbursementDate: l.disbursedDate || l.approvedDate || undefined,
      }, orgSettings);
      await downloadDocumentPDF(loanDoc);
    } catch (error) {
      console.error('Failed to download loan:', error);
    }
  };

  const statusStyles: Record<LoanStatus, string> = {
    PENDING_GUARANTOR: 'bg-amber-100 text-amber-700',
    PENDING_APPROVAL: 'bg-blue-100 text-blue-700',
    APPROVED: 'bg-green-100 text-green-700',
    ACTIVE: 'bg-green-100 text-green-700',
    COMPLETED: 'bg-gray-100 text-gray-700',
    SETTLED: 'bg-gray-100 text-gray-700',
    DEFAULTED: 'bg-red-100 text-red-700',
    REJECTED: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<LoanStatus, { en: string; bn: string }> = {
    PENDING_GUARANTOR: { en: 'Awaiting Guarantor', bn: 'জামিনদার অপেক্ষমাণ' },
    PENDING_APPROVAL: { en: 'Pending', bn: 'অপেক্ষমাণ' },
    APPROVED: { en: 'Approved', bn: 'অনুমোদিত' },
    ACTIVE: { en: 'Active', bn: 'সক্রিয়' },
    COMPLETED: { en: 'Completed', bn: 'সম্পন্ন' },
    SETTLED: { en: 'Settled', bn: 'নিষ্পত্তি' },
    DEFAULTED: { en: 'Defaulted', bn: 'খেলাপি' },
    REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  };

  const filteredLoans = useMemo(() => loans.filter((l) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = l.member.name.toLowerCase().includes(q) || (l.member.memberId ?? '').toLowerCase().includes(q) || (l.guarantor?.name ?? '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [loans, searchQuery, statusFilter]);

  const totalDisbursed = loans.filter((l) => ['ACTIVE', 'COMPLETED', 'SETTLED', 'DEFAULTED'].includes(l.status)).reduce((s, l) => s + l.amount, 0);
  const totalRecovered = loans.reduce((s, l) => s + l.paidAmount, 0);
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE').length;
  const defaultedLoans = loans.filter((l) => l.status === 'DEFAULTED').length;
  const recoveryRate = totalDisbursed > 0 ? ((totalRecovered / totalDisbursed) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'ঋণ ব্যবস্থাপনা' : 'Loan Management'}</h1>
          <p className="text-sm text-gray-500">{filteredLoans.length} {locale === 'bn' ? 'টি ঋণ' : 'loans'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadLoans()} disabled={isLoading} className="h-8">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-gray-500">{locale === 'bn' ? 'বিতরণ:' : 'Disbursed:'}</span> <span className="font-medium text-blue-600">{formatCurrency(totalDisbursed, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'পুনরুদ্ধার:' : 'Recovered:'}</span> <span className="font-medium text-green-600">{formatCurrency(totalRecovered, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span> <span className="font-medium">{activeLoans}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'খেলাপি:' : 'Defaulted:'}</span> <span className="font-medium text-red-600">{defaultedLoans}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'হার:' : 'Rate:'}</span> <span className="font-medium text-green-600">{recoveryRate}%</span></div>
      </div>

      {actionError && <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{actionError}</div>}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={locale === 'bn' ? 'সদস্য বা গ্যারান্টর দিয়ে খুঁজুন...' : 'Search member/guarantor...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <select aria-label={tA11y('filterByStatus')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500">
          <option value="all">{locale === 'bn' ? 'সব স্ট্যাটাস' : 'All Status'}</option>
          <option value="PENDING_GUARANTOR">{locale === 'bn' ? 'জামিনদার অপেক্ষমাণ' : 'Awaiting Guarantor'}</option>
          <option value="PENDING_APPROVAL">{locale === 'bn' ? 'অনুমোদন অপেক্ষমাণ' : 'Pending Approval'}</option>
          <option value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</option>
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
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'সদস্য' : 'Member'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : filteredLoans.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{locale === 'bn' ? 'কোনো ঋণ পাওয়া যায়নি' : 'No loans found'}</td></tr>
            ) : filteredLoans.map((l) => (
              <tr key={l.id} className={`border-b border-gray-100 hover:bg-gray-50 ${l.status === 'DEFAULTED' ? 'bg-red-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{l.member.name}</div>
                  {l.member.memberId && <div className="text-xs text-gray-500">{l.member.memberId}</div>}
                </td>
                <td className="px-4 py-3 text-right font-medium text-blue-600">{formatCurrency(l.amount, locale)}</td>
                <td className="px-4 py-3 text-right hidden sm:table-cell">
                  <span className="text-green-600">{formatCurrency(l.paidAmount, locale)}</span>
                  <div className="text-xs text-gray-500">{l.installmentsPaid}/{l.totalInstallments}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-600">{l.guarantor?.name ?? '-'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs rounded ${statusStyles[l.status]}`}>
                    {locale === 'bn' ? statusLabels[l.status].bn : statusLabels[l.status].en}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => void handleDownloadLoan(l)} className="text-blue-600 hover:text-blue-800" title={locale === 'bn' ? 'ঋণ ডাউনলোড' : 'Download Loan'}>
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { setSelectedLoan(l); setShowDetailModal(true); }}
                      className="text-blue-600 hover:text-blue-800"
                      title={locale === 'bn' ? 'ঋণের বিবরণ' : 'View Loan Details'}
                      aria-label={locale === 'bn' ? 'ঋণের বিবরণ দেখুন' : 'View loan details'}
                    >
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
            <DialogTitle>{locale === 'bn' ? 'ঋণ বিস্তারিত' : 'Loan Details'}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'সদস্য' : 'Member'}</span><span>{selectedLoan.member.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'নম্বর' : 'Number'}</span><span>{selectedLoan.loanNumber}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</span><span className="font-medium text-blue-600">{formatCurrency(selectedLoan.amount, locale)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'পরিশোধিত' : 'Paid'}</span><span className="text-green-600">{formatCurrency(selectedLoan.paidAmount, locale)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'বাকি' : 'Remaining'}</span><span className="text-amber-600">{formatCurrency(selectedLoan.remainingAmount, locale)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'কিস্তি' : 'Installments'}</span><span>{selectedLoan.installmentsPaid}/{selectedLoan.totalInstallments}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'মাসিক' : 'Monthly'}</span><span>{formatCurrency(selectedLoan.monthlyInstallment, locale)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'গ্যারান্টর' : 'Guarantor'}</span><span>{selectedLoan.guarantor?.name ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'উদ্দেশ্য' : 'Purpose'}</span><span>{selectedLoan.purpose || '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</span><span className={`px-2 py-0.5 text-xs rounded ${statusStyles[selectedLoan.status]}`}>{locale === 'bn' ? statusLabels[selectedLoan.status].bn : statusLabels[selectedLoan.status].en}</span></div>
              {selectedLoan.approvedBy && <div className="flex justify-between"><span className="text-gray-500">{locale === 'bn' ? 'অনুমোদনকারী' : 'Approved By'}</span><span>{selectedLoan.approvedBy}</span></div>}
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
