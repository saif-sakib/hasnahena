'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import {
  Search,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Check,
  Download,
} from 'lucide-react';
import {
  buildReceipt,
  downloadDocumentPDF,
  fetchOrgSettings,
} from '@/lib/documents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { apiGet, apiPost } from '@/lib/api';

type FormTransactionType = 'DEPOSIT' | 'WITHDRAWAL';
type TransactionType = FormTransactionType | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | string;

interface Transaction {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: TransactionType;
  amount: number;
  date: string;
  balanceAfter: number;
  notes?: string;
  status?: string;
}

interface Member {
  id: string;
  name: string;
  phone: string;
  balance: number;
}

export default function WorkerDepositsPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<FormTransactionType>('DEPOSIT');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadTransactions();
    loadMembers();
  }, []);

  const loadTransactions = async () => {
    try {
      const data = await apiGet<any[]>('/v1/dashboard/worker/transactions');
      const items = (data ?? []).map((item) => ({
        id: String(item.id ?? ''),
        memberId: String(item.memberId ?? ''),
        memberName: String(item.memberName ?? ''),
        memberPhone: String(item.memberPhone ?? ''),
        type: String(item.type ?? '').toUpperCase() as TransactionType,
        amount: Number(item.amount ?? 0),
        date: String(item.date ?? new Date().toISOString()),
        balanceAfter: Number(item.balanceAfter ?? 0),
        notes: item.description ? String(item.description) : undefined,
        status: item.status ? String(item.status) : undefined,
      }));
      setTransactions(items.filter((item) => item.type === 'DEPOSIT' || item.type === 'WITHDRAWAL'));
    } catch {
      setTransactions([]);
    }
  };

  const handleDownloadReceipt = async (t: Transaction) => {
    try {
      const orgSettings = await fetchOrgSettings();
      const receiptDoc = buildReceipt({
        receiptNumber: t.id,
        type: t.type,
        amount: t.amount,
        date: t.date,
        memberName: t.memberName,
        memberId: t.memberId,
        memberPhone: t.memberPhone,
        balanceAfter: t.balanceAfter,
        notes: t.notes,
      }, orgSettings);
      await downloadDocumentPDF(receiptDoc);
    } catch (error) {
      console.error('Failed to download receipt:', error);
    }
  };

  const loadMembers = async () => {
    try {
      const data = await apiGet<any[]>('/v1/dashboard/worker/members');
      const items = (data ?? []).map((member) => ({
        id: String(member.id ?? ''),
        name: String(member.name ?? ''),
        phone: String(member.phone ?? ''),
        balance: Number(member.currentDeposit ?? 0),
      }));
      setMembers(items);
    } catch {
      setMembers([]);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  const filteredTransactions = transactions.filter(
    (t) =>
      t.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.memberPhone.includes(searchQuery)
  );

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.phone.includes(memberSearch)
  );

  const openForm = (type: FormTransactionType) => {
    setFormType(type);
    setShowForm(true);
    setSelectedMember(null);
    setAmount('');
    setNotes('');
    setMemberSearch('');
    setFormError(null);
  };

  const handleSubmit = async () => {
    const parsedAmount = Number.parseFloat(amount);
    if (!selectedMember || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(locale === 'bn' ? 'সঠিক পরিমাণ দিন' : 'Enter a valid amount');
      return;
    }
    if (formType === 'WITHDRAWAL' && parsedAmount > selectedMember.balance) {
      setFormError(locale === 'bn' ? 'পর্যাপ্ত ব্যালেন্স নেই' : 'Insufficient balance');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const amountVal = Math.round(parsedAmount );
      const endpoint =
        formType === 'DEPOSIT'
          ? `/v1/dashboard/worker/members/${selectedMember.id}/deposit`
          : `/v1/dashboard/worker/members/${selectedMember.id}/withdrawal`;

      await apiPost(endpoint, {
        amount: amountVal,
        notes: notes.trim(),
      });
      setShowForm(false);
      await Promise.all([loadTransactions(), loadMembers()]);
    } catch (error: any) {
      setFormError(error?.message || (locale === 'bn' ? 'অনুরোধ ব্যর্থ হয়েছে' : 'Request failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Summary stats
  const todayDeposits = transactions
    .filter((t) => t.type === 'DEPOSIT')
    .reduce((sum, t) => sum + t.amount, 0);
  const todayWithdrawals = transactions
    .filter((t) => t.type === 'WITHDRAWAL')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'জমা ও উত্তোলন' : 'Deposits & Withdrawals'}
          </h1>
          <p className="text-sm text-gray-500">
            {locale === 'bn' ? 'সদস্যদের লেনদেন রেকর্ড করুন' : 'Record member transactions'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => openForm('DEPOSIT')}
            className="h-8 bg-green-600 hover:bg-green-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            {locale === 'bn' ? 'জমা' : 'Deposit'}
          </Button>
          <Button
            size="sm"
            onClick={() => openForm('WITHDRAWAL')}
            className="h-8 bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            {locale === 'bn' ? 'উত্তোলন' : 'Withdraw'}
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-6 text-sm py-3 px-4 bg-white border border-gray-200">
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'আজকের জমা:' : "Today's Deposits:"}</span>{' '}
          <span className="font-semibold text-green-600">{formatCurrency(todayDeposits, locale)}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'আজকের উত্তোলন:' : "Today's Withdrawals:"}</span>{' '}
          <span className="font-semibold text-blue-600">{formatCurrency(todayWithdrawals, locale)}</span>
        </div>
        <div>
          <span className="text-gray-500">{locale === 'bn' ? 'নেট:' : 'Net:'}</span>{' '}
          <span className={`font-semibold ${todayDeposits - todayWithdrawals >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(todayDeposits - todayWithdrawals, locale)}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder={locale === 'bn' ? 'সদস্য খুঁজুন...' : 'Search member...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-10 pr-3 text-sm border border-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Transaction Table */}
      <div className="border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-2 px-3 font-medium text-gray-700">
                {locale === 'bn' ? 'সদস্য' : 'Member'}
              </th>
              <th className="text-left py-2 px-3 font-medium text-gray-700">
                {locale === 'bn' ? 'প্রকার' : 'Type'}
              </th>
              <th className="text-right py-2 px-3 font-medium text-gray-700">
                {locale === 'bn' ? 'পরিমাণ' : 'Amount'}
              </th>
              <th className="text-right py-2 px-3 font-medium text-gray-700">
                {locale === 'bn' ? 'ব্যালেন্স' : 'Balance'}
              </th>
              <th className="text-right py-2 px-3 font-medium text-gray-700">
                {locale === 'bn' ? 'তারিখ' : 'Date'}
              </th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3">
                  <div>
                    <p className="font-medium">{t.memberName}</p>
                    <p className="text-xs text-gray-500">{t.memberPhone}</p>
                  </div>
                </td>
                <td className="py-2 px-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
                      t.type === 'DEPOSIT'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {t.type === 'DEPOSIT' ? (
                      <ArrowDownLeft className="h-3 w-3" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3" />
                    )}
                    {t.type === 'DEPOSIT'
                      ? locale === 'bn'
                        ? 'জমা'
                        : 'Deposit'
                      : locale === 'bn'
                        ? 'উত্তোলন'
                        : 'Withdrawal'}
                  </span>
                </td>
                <td
                  className={`py-2 px-3 text-right font-medium ${
                    t.type === 'DEPOSIT' ? 'text-green-600' : 'text-blue-600'
                  }`}
                >
                  {t.type === 'DEPOSIT' ? '+' : '-'}
                  {formatCurrency(t.amount, locale)}
                </td>
                <td className="py-2 px-3 text-right text-gray-600">
                  {formatCurrency(t.balanceAfter, locale)}
                </td>
                <td className="py-2 px-3 text-right text-gray-500 text-xs">
                  {formatTime(t.date)}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => void handleDownloadReceipt(t)}
                    className="text-blue-600 hover:text-blue-800 inline-flex items-center justify-center p-1"
                    title={locale === 'bn' ? 'রশিদ ডাউনলোড' : 'Download Receipt'}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো লেনদেন পাওয়া যায়নি' : 'No transactions found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Entry Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md mx-4 border border-gray-200 shadow-lg">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-semibold">
                {formType === 'DEPOSIT'
                  ? locale === 'bn'
                    ? 'জমা করুন'
                    : 'New Deposit'
                  : locale === 'bn'
                    ? 'উত্তোলন করুন'
                    : 'New Withdrawal'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Member Selection */}
              <div>
                {formError && (
                  <div className="mb-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {formError}
                  </div>
                )}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {locale === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Select Member'}
                </label>
                {selectedMember ? (
                  <div className="flex items-center justify-between p-3 border border-gray-200 bg-gray-50">
                    <div>
                      <p className="font-medium">{selectedMember.name}</p>
                      <p className="text-xs text-gray-500">
                        {selectedMember.phone} • {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'}{' '}
                        {formatCurrency(selectedMember.balance, locale)}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedMember(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="border border-gray-200">
                    <div className="p-2 border-b border-gray-200">
                      <Input
                        placeholder={locale === 'bn' ? 'নাম বা ফোন দিয়ে খুঁজুন...' : 'Search by name or phone...'}
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        className="h-8 border-0 focus-visible:ring-0 shadow-none"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {filteredMembers.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedMember(m)}
                          className="w-full flex items-center justify-between p-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 text-left"
                        >
                          <div>
                            <p className="text-sm font-medium">{m.name}</p>
                            <p className="text-xs text-gray-500">{m.phone}</p>
                          </div>
                          <span className="text-xs text-gray-500">
                            {formatCurrency(m.balance, locale)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {locale === 'bn' ? 'পরিমাণ (৳)' : 'Amount (৳)'}
                </label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
                {selectedMember && formType === 'WITHDRAWAL' && parseFloat(amount) > selectedMember.balance && (
                  <p className="text-xs text-red-600 mt-1">
                    {locale === 'bn' ? 'পর্যাপ্ত ব্যালেন্স নেই' : 'Insufficient balance'}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {locale === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Notes (optional)'}
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={locale === 'bn' ? 'যেকোনো মন্তব্য...' : 'Any comments...'}
                  className="h-9"
                />
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-9">
                {locale === 'bn' ? 'বাতিল' : 'Cancel'}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  !selectedMember ||
                  !amount ||
                  isSubmitting ||
                  (formType === 'WITHDRAWAL' && parseFloat(amount) > (selectedMember?.balance || 0))
                }
                className={`flex-1 h-9 ${
                  formType === 'DEPOSIT' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Check className="h-4 w-4 mr-1" />
                {isSubmitting
                  ? locale === 'bn'
                    ? 'প্রক্রিয়াকরণ...'
                    : 'Processing...'
                  : locale === 'bn'
                    ? 'নিশ্চিত করুন'
                    : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
