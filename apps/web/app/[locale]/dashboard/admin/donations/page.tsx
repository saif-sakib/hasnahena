'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, Download, Plus, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/utils';
import { apiPost } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Donation = {
  id: string;
  amount: number;
  receipt?: string;
  description?: string;
  date: string;
  donorName?: string;
  donorNameBn?: string;
  donorId?: string;
};

function exportDonationsCsv(rows: Donation[], locale: string) {
  const headers = [locale === 'bn' ? 'তারিখ' : 'Date', locale === 'bn' ? 'রসিদ' : 'Receipt', locale === 'bn' ? 'দাতার নাম' : 'Donor Name', locale === 'bn' ? 'পরিমাণ (BDT)' : 'Amount (BDT)', locale === 'bn' ? 'বিবরণ' : 'Description'];
  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const donor = (locale === 'bn' ? row.donorNameBn : row.donorName) || row.donorName || row.donorNameBn || '-';
    const date = new Date(row.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB');
    lines.push([date, row.receipt || '-', donor, row.amount.toFixed(2), row.description || '-'].map((v) => escapeCsv(v)).join(','));
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `donations-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminDonationsPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  // WO-27 — loaded by SWR, not by an effect. See lib/use-api.ts.
  const {
    data: donationsData,
    error: loadError,
    isLoading,
    refresh: loadDonations,
  } = useApi<Donation[]>('/v1/dashboard/admin/donations');
  // Recording a donation fails for different reasons than reading the list
  // does, so it carries its own message rather than overwriting the load error.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const actionError = submitError ?? loadError;
  const donations = useMemo<Donation[]>(() => donationsData ?? [], [donationsData]);
  const [searchQuery, setSearchQuery] = useState('');

  const [showAddDonationModal, setShowAddDonationModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newDonation, setNewDonation] = useState({ donorName: '', amount: '', notes: '' });


  const filteredDonations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return donations;
    return donations.filter((d) => `${d.donorName || ''} ${d.donorNameBn || ''}`.toLowerCase().includes(q) || (d.receipt || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q));
  }, [donations, searchQuery]);

  const totalReceived = useMemo(() => donations.reduce((s, d) => s + d.amount, 0), [donations]);
  const monthReceived = useMemo(() => {
    const now = new Date();
    return donations.filter((d) => { const date = new Date(d.date); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }).reduce((s, d) => s + d.amount, 0);
  }, [donations]);

  const handleAddDonation = async () => {
    const amountBdt = Number.parseFloat(newDonation.amount);
    if (!Number.isFinite(amountBdt) || amountBdt <= 0) { setSubmitError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount'); return; }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await apiPost('/v1/dashboard/admin/donations', { amount: Math.round(amountBdt ), donorName: newDonation.donorName.trim(), notes: newDonation.notes.trim() });
      setShowAddDonationModal(false);
      setNewDonation({ donorName: '', amount: '', notes: '' });
      await loadDonations();
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Failed to record donation');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'দান ব্যবস্থাপনা' : 'Donation Management'}</h1>
          <p className="text-sm text-gray-500">{filteredDonations.length} {locale === 'bn' ? 'টি দান' : 'donations'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportDonationsCsv(filteredDonations, locale)} disabled={filteredDonations.length === 0} className="h-8">
            <Download className="h-3.5 w-3.5 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadDonations()} disabled={isLoading} className="h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="sr-only">{tA11y('refresh')}</span>
          </Button>
          <Button size="sm" onClick={() => setShowAddDonationModal(true)} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />{locale === 'bn' ? 'যোগ' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-gray-500">{locale === 'bn' ? 'মোট:' : 'Total:'}</span> <span className="font-medium text-green-600">{formatCurrency(totalReceived, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'এই মাস:' : 'This Month:'}</span> <span className="font-medium text-green-600">{formatCurrency(monthReceived, locale)}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'এন্ট্রি:' : 'Entries:'}</span> <span className="font-medium">{donations.length}</span></div>
      </div>

      {actionError && <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">{actionError}</div>}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder={locale === 'bn' ? 'দাতা/রশিদ/বিবরণ দিয়ে খুঁজুন...' : 'Search donor/receipt/description...'} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500" />
      </div>

      {/* Table */}
      <div className="border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'দাতা' : 'Donor'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'রসিদ' : 'Receipt'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : filteredDonations.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">{locale === 'bn' ? 'কোনো দান পাওয়া যায়নি' : 'No donations found'}</td></tr>
            ) : filteredDonations.map((d) => (
              <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{(locale === 'bn' ? d.donorNameBn : d.donorName) || d.donorName || d.donorNameBn || '-'}</div>
                  {d.description && <div className="text-xs text-gray-500 truncate max-w-[200px]">{d.description}</div>}
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">+{formatCurrency(d.amount, locale)}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-gray-600">{d.receipt || '-'}</td>
                <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">{new Date(d.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      <Dialog open={showAddDonationModal} onOpenChange={setShowAddDonationModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'নতুন দান যোগ' : 'Add New Donation'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'দাতার নাম' : 'Donor Name'}</Label>
              <Input value={newDonation.donorName} onChange={(e) => setNewDonation((p) => ({ ...p, donorName: e.target.value }))} placeholder={locale === 'bn' ? 'দাতার নাম' : 'Donor name'} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
              <Input type="number" min="0" step="0.01" value={newDonation.amount} onChange={(e) => setNewDonation((p) => ({ ...p, amount: e.target.value }))} placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'নোট' : 'Notes'}</Label>
              <Textarea value={newDonation.notes} onChange={(e) => setNewDonation((p) => ({ ...p, notes: e.target.value }))} placeholder={locale === 'bn' ? 'ঐচ্ছিক' : 'Optional'} className="mt-1" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddDonationModal(false)}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={() => void handleAddDonation()} disabled={isSubmitting}>{isSubmitting ? '...' : (locale === 'bn' ? 'যোগ করুন' : 'Add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
