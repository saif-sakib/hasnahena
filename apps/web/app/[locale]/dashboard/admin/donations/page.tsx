'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Heart,
  Search,
  Download,
  Calendar,
  Plus,
  RefreshCw,
  Wallet,
  ArrowDownLeft,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/utils';
import { apiGet, apiPost } from '@/lib/api';

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
  const headers = [
    locale === 'bn' ? 'তারিখ' : 'Date',
    locale === 'bn' ? 'রসিদ' : 'Receipt',
    locale === 'bn' ? 'দাতার নাম' : 'Donor Name',
    locale === 'bn' ? 'পরিমাণ (BDT)' : 'Amount (BDT)',
    locale === 'bn' ? 'বিবরণ' : 'Description',
  ];

  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];

  rows.forEach((row) => {
    const donor = (locale === 'bn' ? row.donorNameBn : row.donorName) || row.donorName || row.donorNameBn || '-';
    const date = new Date(row.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB');
    const values = [
      date,
      row.receipt || '-',
      donor,
      row.amount.toFixed(2),
      row.description || '-',
    ];
    lines.push(values.map((v) => escapeCsv(v)).join(','));
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
  const [donations, setDonations] = useState<Donation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAddDonationModal, setShowAddDonationModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newDonation, setNewDonation] = useState({
    donorName: '',
    amount: '',
    notes: '',
  });

  const loadDonations = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const data = await apiGet<Donation[]>('/v1/dashboard/admin/donations');
      setDonations(data ?? []);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load donations');
      setDonations([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDonations();
  }, []);

  const filteredDonations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return donations;
    return donations.filter((donation) => {
      const donor = `${donation.donorName || ''} ${donation.donorNameBn || ''}`.toLowerCase();
      return donor.includes(q) ||
        (donation.receipt || '').toLowerCase().includes(q) ||
        (donation.description || '').toLowerCase().includes(q);
    });
  }, [donations, searchQuery]);

  const totalReceived = useMemo(
    () => donations.reduce((sum, donation) => sum + donation.amount, 0),
    [donations],
  );

  const monthReceived = useMemo(() => {
    const now = new Date();
    return donations
      .filter((d) => {
        const date = new Date(d.date);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      })
      .reduce((sum, d) => sum + d.amount, 0);
  }, [donations]);

  const handleAddDonation = async () => {
    const amountBdt = Number.parseFloat(newDonation.amount);
    if (!Number.isFinite(amountBdt) || amountBdt <= 0) {
      setActionError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await apiPost('/v1/dashboard/admin/donations', {
        amount: Math.round(amountBdt * 100),
        donorName: newDonation.donorName.trim(),
        notes: newDonation.notes.trim(),
      });

      setShowAddDonationModal(false);
      setNewDonation({ donorName: '', amount: '', notes: '' });
      await loadDonations();
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to record donation');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'দান ব্যবস্থাপনা' : 'Donation Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn' ? 'ডাটাবেইস থেকে দানের তথ্য দেখুন ও নতুন দান যুক্ত করুন' : 'Track donations from the database and record new donations'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportDonationsCsv(filteredDonations, locale)} disabled={filteredDonations.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'রিপোর্ট (CSV)' : 'Report (CSV)'}
          </Button>
          <Button variant="outline" onClick={() => void loadDonations()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
          </Button>
          <Button onClick={() => setShowAddDonationModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'দান যোগ' : 'Add Donation'}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট দান' : 'Total Donations'}</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(totalReceived, locale)}</p>
              </div>
              <Wallet className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'এই মাসে দান' : 'This Month'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(monthReceived, locale)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট এন্ট্রি' : 'Total Entries'}</p>
                <p className="text-2xl font-bold">{donations.length}</p>
              </div>
              <Heart className="h-8 w-8 text-rose-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5" />
            {locale === 'bn' ? 'দান তালিকা' : 'Donations List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn' ? `${filteredDonations.length} টি দান দেখানো হচ্ছে` : `${filteredDonations.length} donations shown`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'দাতা/রশিদ/বিবরণ দিয়ে খুঁজুন...' : 'Search by donor/receipt/description...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : filteredDonations.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              {locale === 'bn' ? 'কোনো দান পাওয়া যায়নি' : 'No donations found'}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDonations.map((donation) => {
                const donorName = (locale === 'bn' ? donation.donorNameBn : donation.donorName) || donation.donorName || donation.donorNameBn || '-';
                return (
                  <div key={donation.id} className="flex flex-col gap-4 p-4 rounded-xl bg-slate-50 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-700">
                        <ArrowDownLeft className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">
                          <p className="font-semibold text-foreground">{donorName}</p>
                          <p className="flex items-center gap-1 mt-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(donation.date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                            {donation.receipt ? ` • ${donation.receipt}` : ''}
                          </p>
                          {donation.description && <p className="text-xs mt-1">{donation.description}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-green-600">+{formatCurrency(donation.amount, locale)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddDonationModal} onOpenChange={setShowAddDonationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'নতুন দান যোগ করুন' : 'Add New Donation'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? 'দানের তথ্য ডাটাবেইসে সংরক্ষণ করা হবে' : 'Donation will be saved directly in the database'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{locale === 'bn' ? 'দাতার নাম' : 'Donor Name'}</Label>
              <Input
                value={newDonation.donorName}
                onChange={(e) => setNewDonation((prev) => ({ ...prev, donorName: e.target.value }))}
                placeholder={locale === 'bn' ? 'দাতার নাম লিখুন' : 'Enter donor name'}
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'পরিমাণ (টাকা)' : 'Amount (BDT)'}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={newDonation.amount}
                onChange={(e) => setNewDonation((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}</Label>
              <Textarea
                value={newDonation.notes}
                onChange={(e) => setNewDonation((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder={locale === 'bn' ? 'অতিরিক্ত তথ্য...' : 'Additional information...'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDonationModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={() => void handleAddDonation()} disabled={isSubmitting}>
              {isSubmitting ? (locale === 'bn' ? 'সংরক্ষণ হচ্ছে...' : 'Saving...') : (locale === 'bn' ? 'দান যোগ করুন' : 'Add Donation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
