'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useLocale } from 'next-intl';
import { Building2, Plus, Edit2, Power, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

/**
 * Branch management (WO-72). The "Code" column is branch.id (ADR-041). Codes do
 * NOT drive account numbers (fixed ACC-KH-33 prefix, ADR-008).
 */

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
  staffCount: number;
  createdAt: string;
}

type FormState = { id?: string; name: string; code: string; address: string; phone: string };

const EMPTY_FORM: FormState = { name: '', code: '', address: '', phone: '' };

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || 'Request failed');
  return payload as T;
}

export default function BranchesPage() {
  const locale = useLocale();
  const bn = locale === 'bn';

  const {
    data: branches,
    error: loadError,
    isLoading,
    mutate: reload,
  } = useSWR<Branch[], Error>('/api/v1/admin/branches', async (url: string) => {
    const payload = await request<{ data: Branch[] }>(url, 'GET');
    return payload.data;
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => branches ?? [], [branches]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (branch: Branch) => {
    setForm({
      id: branch.id,
      name: branch.name,
      code: branch.id,
      address: branch.address,
      phone: branch.phone,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (form.name.trim().length < 2 || form.code.trim().length < 1) {
      toast({
        title: bn ? 'নাম এবং কোড আবশ্যক' : 'Name and code are required',
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        address: form.address.trim(),
        phone: form.phone.trim(),
      };
      await request('/api/v1/admin/branches', form.id ? 'PUT' : 'POST', body);
      toast({ title: bn ? 'সংরক্ষিত হয়েছে' : 'Saved' });
      setShowForm(false);
      await reload();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : bn ? 'ব্যর্থ হয়েছে' : 'Failed',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (branch: Branch) => {
    setBusy(true);
    try {
      await request('/api/v1/admin/branches', 'PUT', { id: branch.id, isActive: !branch.isActive });
      await reload();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (branch: Branch) => {
    setBusy(true);
    try {
      // The endpoint deactivates instead of deleting when people are attached.
      const payload = await request<{ deactivated: boolean; message?: string }>(
        `/api/v1/admin/branches?id=${encodeURIComponent(branch.id)}`,
        'DELETE',
      );
      toast({
        title: payload.deactivated
          ? payload.message || (bn ? 'নিষ্ক্রিয় করা হয়েছে' : 'Deactivated')
          : bn
            ? 'মুছে ফেলা হয়েছে'
            : 'Deleted',
      });
      await reload();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {bn ? 'শাখাসমূহ' : 'Branches'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {bn
              ? 'কর্মীদের যে অফিসে নিয়োগ দেওয়া হয়। অ্যাকাউন্ট নম্বরের গঠন এখান থেকে পরিবর্তিত হয় না।'
              : 'The offices staff are assigned to. Account numbers are not derived from these.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={isLoading || busy}
            className="h-8"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {bn ? 'রিফ্রেশ' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={openCreate} disabled={busy} className="h-8">
            <Plus className="w-4 h-4 mr-1" />
            {bn ? 'নতুন শাখা' : 'New branch'}
          </Button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="text-sm text-red-600">
          {bn ? 'শাখা লোড করা যায়নি।' : 'Could not load branches.'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {bn ? 'লোড হচ্ছে…' : 'Loading…'}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {bn ? 'কোনো শাখা নেই।' : 'No branches yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 dark:border-zinc-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-900 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">{bn ? 'নাম' : 'Name'}</th>
                <th scope="col" className="px-4 py-3 font-medium">{bn ? 'কোড' : 'Code'}</th>
                <th scope="col" className="px-4 py-3 font-medium hidden md:table-cell">{bn ? 'ঠিকানা' : 'Address'}</th>
                <th scope="col" className="px-4 py-3 font-medium">{bn ? 'কর্মী' : 'Staff'}</th>
                <th scope="col" className="px-4 py-3 font-medium">{bn ? 'অবস্থা' : 'Status'}</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">{bn ? 'কার্যক্রম' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((branch) => (
                <tr key={branch.id} className="border-t border-gray-100 dark:border-zinc-800">
                  <td className="px-4 py-3 font-medium">{branch.name}</td>
                  <td className="px-4 py-3 font-mono">{branch.id}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-zinc-400">
                    {branch.address || '-'}
                  </td>
                  <td className="px-4 py-3">{branch.staffCount}</td>
                  <td className="px-4 py-3">
                    {branch.isActive ? (
                      <span className="text-emerald-600">{bn ? 'সক্রিয়' : 'Active'}</span>
                    ) : (
                      <span className="text-zinc-500">{bn ? 'নিষ্ক্রিয়' : 'Inactive'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(branch)}
                        disabled={busy}
                        title={bn ? 'সম্পাদনা' : 'Edit'}
                        aria-label={`${bn ? 'সম্পাদনা' : 'Edit'} ${branch.name}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void toggleActive(branch)}
                        disabled={busy}
                        title={branch.isActive ? (bn ? 'নিষ্ক্রিয় করুন' : 'Deactivate') : (bn ? 'সক্রিয় করুন' : 'Activate')}
                        aria-label={`${branch.isActive ? (bn ? 'নিষ্ক্রিয় করুন' : 'Deactivate') : (bn ? 'সক্রিয় করুন' : 'Activate')} ${branch.name}`}
                      >
                        <Power className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(branch)}
                        disabled={busy}
                        title={bn ? 'মুছুন' : 'Delete'}
                        aria-label={`${bn ? 'মুছুন' : 'Delete'} ${branch.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.id ? (bn ? 'শাখা সম্পাদনা' : 'Edit branch') : bn ? 'নতুন শাখা' : 'New branch'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="branch-name" className="text-sm">{bn ? 'নাম' : 'Name'}</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="branch-code" className="text-sm">{bn ? 'কোড' : 'Code'}</Label>
              <Input
                id="branch-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="KH"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="branch-address" className="text-sm">{bn ? 'ঠিকানা' : 'Address'}</Label>
              <Input
                id="branch-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="branch-phone" className="text-sm">{bn ? 'ফোন' : 'Phone'}</Label>
              <Input
                id="branch-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={busy}>
              {bn ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {bn ? 'সংরক্ষণ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
