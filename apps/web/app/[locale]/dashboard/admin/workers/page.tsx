'use client';

import { useMemo, useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Search,
  UserPlus,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Ban,
  CheckCircle2,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useApi } from '@/lib/use-api';
import { toast } from '@/hooks/use-toast';

interface Worker {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'ACTIVE' | 'INACTIVE';
  // WO-72. The branch is a row now. `assignedArea` survives as the *display*
  // string derived from it, so the search box and the table keep working
  // unchanged; `branchId` is what the form posts.
  branchId: string;
  assignedArea: string;
  joinDate: string;
  processedDeposits: number;
  processedLoans: number;
  lastActive: string;
}

interface WorkerApiResponse {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'ACTIVE' | 'INACTIVE';
  branch: { id: string; name: string } | null;
  joinDate: string;
}

interface BranchOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

function normalizeWorker(worker: any): Worker {
  return {
    ...worker,
    status: worker.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    processedDeposits: Number(worker.currentDeposit || worker.processedDeposits || 0),
    processedLoans: Number(worker.activeLoan || worker.processedLoans || 0),
    branchId: worker.branch?.id || '',
    assignedArea: worker.branch ? `${worker.branch.name} (${worker.branch.id})` : '',
    joinDate: worker.joinDate || worker.createdAt || new Date().toISOString(),
    lastActive: worker.lastActive || worker.joinDate || new Date().toISOString(),
  };
}

async function requestWorkersApi<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Request failed');
  }

  return payload.data as T;
}

/**
 * Field-worker accounts.
 *
 * This screen creates and edits **workers**. It does not create admins, and it
 * cannot promote a worker into one: an admin account is made directly in the
 * database, deliberately, because the alternative is that anyone who reaches an
 * admin session can mint another one from a web form and the audit trail records
 * it as ordinary staff administration. `/api/v1/admin/workers` enforces the same
 * rule server-side — role is not a field it accepts on create or on update — so
 * this is a UI that matches the API rather than a UI that hides a capability.
 *
 * Admin accounts are not listed at all. `/v1/dashboard/admin/workers` returns
 * `u.role = 'WORKER'` and nothing else. They used to appear here with every
 * action disabled, which is a row that can only be read — and a screen whose
 * job is create/edit/suspend/delete has no use for one. Nothing else on the
 * screen distinguishes a worker from an admin any more, so the Role column, the
 * role filter and the "Admins" tally are gone with them.
 */
export default function AdminWorkersPage() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const {
    data: workersData,
    error: loadError,
    isLoading,
    refresh: loadWorkers,
  } = useApi<Array<Worker & { currentDeposit?: number; activeLoan?: number }>>(
    '/v1/dashboard/admin/workers',
  );
  const workers = useMemo<Worker[]>(
    () => (workersData ?? []).map((worker) => normalizeWorker(worker)),
    [workersData],
  );

  const [isMutating, setIsMutating] = useState(false);
  // Adding, editing and deleting a worker each fail for their own reasons.
  const [mutationError, setMutationError] = useState<string | null>(null);
  const pageError = mutationError ?? loadError;

  const [newWorker, setNewWorker] = useState({
    name: '',
    email: '',
    phone: '',
    assignedBranchId: '',
  });
  const [editWorker, setEditWorker] = useState({
    name: '',
    phone: '',
    assignedBranchId: '',
  });
  const [branches, setBranches] = useState<BranchOption[]>([]);

  // WO-72. The branch picker's options. Same-origin Next route, so a plain
  // fetch rather than useApi, which resolves against the Go API base.
  useEffect(() => {
    let cancelled = false;
    const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
    fetch('/api/v1/admin/branches', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.ok) return;
        setBranches(payload.data as BranchOption[]);
      })
      .catch(() => {
        // A missing picker is not worth failing the page over — the field is
        // optional, and the server refuses an unknown id anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const filteredWorkers = useMemo(
    () =>
      workers.filter((worker) => {
        const matchesSearch =
          worker.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          worker.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          worker.phone.includes(searchQuery) ||
          worker.assignedArea.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'all' || worker.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [workers, searchQuery, statusFilter]
  );

  const stats = useMemo(
    () => ({
      total: workers.length,
      active: workers.filter((w) => w.status === 'ACTIVE').length,
      inactive: workers.filter((w) => w.status === 'INACTIVE').length,
    }),
    [workers]
  );

  const getStatusBadge = (status: 'ACTIVE' | 'INACTIVE') => (
    <span className={`px-2 py-0.5 text-xs rounded ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      {status === 'ACTIVE' ? (locale === 'bn' ? 'সক্রিয়' : 'Active') : (locale === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive')}
    </span>
  );

  const handleAddWorker = async () => {
    if (!newWorker.name || !newWorker.email || !newWorker.phone) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'নাম, ইমেইল ও ফোন বাধ্যতামূলক' : 'Name, email and phone are required',
        variant: 'destructive',
      });
      return;
    }

    setIsMutating(true);
    setMutationError(null);
    try {
      await requestWorkersApi<WorkerApiResponse>('/api/v1/admin/workers', 'POST', {
        name: newWorker.name,
        email: newWorker.email,
        phone: newWorker.phone,
        assignedBranchId: newWorker.assignedBranchId || null,
        locale,
      });

      await loadWorkers();
      setShowAddModal(false);
      setNewWorker({ name: '', email: '', phone: '', assignedBranchId: '' });
      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description:
          locale === 'bn'
            ? 'স্টাফ অ্যাকাউন্ট তৈরি হয়েছে এবং ইমেইল পাঠানো হয়েছে'
            : 'Staff account created and email sent',
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add staff';
      setMutationError(message);
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsMutating(false);
    }
  };

  const handleStartEdit = (worker: Worker) => {
    setSelectedWorker(worker);
    setEditWorker({
      name: worker.name,
      phone: worker.phone,
      assignedBranchId: worker.branchId,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedWorker) return;
    setIsMutating(true);
    setMutationError(null);
    try {
      await requestWorkersApi<WorkerApiResponse>('/api/v1/admin/workers', 'PUT', {
        id: selectedWorker.id,
        name: editWorker.name,
        phone: editWorker.phone,
        assignedBranchId: editWorker.assignedBranchId || null,
      });

      await loadWorkers();
      setShowEditModal(false);
      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description: locale === 'bn' ? 'কর্মীর তথ্য আপডেট হয়েছে' : 'Worker information updated',
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      setMutationError(message);
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsMutating(false);
    }
  };

  const handleToggleStatus = async (worker: Worker) => {
    setIsMutating(true);
    setMutationError(null);
    const nextStatus = worker.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    try {
      await requestWorkersApi<WorkerApiResponse>('/api/v1/admin/workers', 'PATCH', {
        id: worker.id,
        status: nextStatus,
      });

      await loadWorkers();
      toast({
        title: locale === 'bn' ? 'স্ট্যাটাস আপডেট' : 'Status Updated',
        description:
          nextStatus === 'ACTIVE'
            ? locale === 'bn'
              ? 'কর্মীকে সক্রিয় করা হয়েছে'
              : 'Worker has been activated'
            : locale === 'bn'
              ? 'কর্মীকে নিষ্ক্রিয় করা হয়েছে'
              : 'Worker has been deactivated',
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Status update failed';
      setMutationError(message);
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteWorker = async () => {
    if (!selectedWorker) return;

    setIsMutating(true);
    setMutationError(null);
    try {
      const result = await requestWorkersApi<{ deleted: boolean; archived: boolean }>(
        `/api/v1/admin/workers?id=${encodeURIComponent(selectedWorker.id)}`,
        'DELETE'
      );

      // Deleted or archived, the server decides; re-read rather than guess.
      await loadWorkers();

      setShowDeleteModal(false);
      const description = result.deleted
        ? locale === 'bn'
          ? 'কর্মী অ্যাকাউন্ট মুছে ফেলা হয়েছে'
          : 'Worker account deleted'
        : locale === 'bn'
          ? 'ঐতিহাসিক রেকর্ড থাকায় অ্যাকাউন্ট আর্কাইভ (নিষ্ক্রিয়) করা হয়েছে'
          : 'Account has historical references, so it was archived (set inactive)';
      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description,
        variant: 'success',
      });
      setSelectedWorker(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      setMutationError(message);
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'কর্মী ব্যবস্থাপনা' : 'Worker Management'}
          </h1>
          <p className="text-sm text-gray-500">
            {filteredWorkers.length} {locale === 'bn' ? 'জন প্রদর্শিত' : 'shown'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadWorkers()} disabled={isLoading || isMutating} className="h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="sr-only">{tA11y('refresh')}</span>
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)} className="h-8">
            <UserPlus className="h-3.5 w-3.5 mr-1" />
            {locale === 'bn' ? 'কর্মী যোগ' : 'Add Worker'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-gray-500">{locale === 'bn' ? 'মোট:' : 'Total:'}</span> <span className="font-medium">{stats.total}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span> <span className="font-medium text-green-600">{stats.active}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'নিষ্ক্রিয়:' : 'Inactive:'}</span> <span className="font-medium text-gray-600">{stats.inactive}</span></div>
      </div>

      {pageError && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
          {pageError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={locale === 'bn' ? 'নাম, ইমেইল, ফোন, এলাকা দিয়ে খুঁজুন...' : 'Search by name, email, phone, area...'}
            className="pl-9 h-9"
          />
        </div>
        <select
          aria-label={tA11y('filterByStatus')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ACTIVE' | 'INACTIVE')}
          className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
        >
          <option value="all">{locale === 'bn' ? 'সব স্ট্যাটাস' : 'All Status'}</option>
          <option value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</option>
          <option value="INACTIVE">{locale === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive'}</option>
        </select>
      </div>

      <div className="border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'নাম' : 'Name'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'যোগাযোগ' : 'Contact'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'এলাকা' : 'Area'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : filteredWorkers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো কর্মী পাওয়া যায়নি' : 'No workers found'}
                </td>
              </tr>
            ) : (
              filteredWorkers.map((worker) => (
                <tr key={worker.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{worker.name}</div>
                    <div className="text-xs text-gray-500 sm:hidden">{worker.email}</div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="text-gray-700">{worker.email || '-'}</div>
                    <div className="text-xs text-gray-500">{worker.phone}</div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-600">{worker.assignedArea || '-'}</td>
                  <td className="px-4 py-3">{getStatusBadge(worker.status)}</td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={isMutating}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">{tA11y('rowActions')}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setSelectedWorker(worker); setShowDetailModal(true); }}>
                          <Eye className="h-4 w-4 mr-2" />{locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStartEdit(worker)}>
                          <Edit className="h-4 w-4 mr-2" />{locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleToggleStatus(worker)}>
                          {worker.status === 'ACTIVE' ? (
                            <><Ban className="h-4 w-4 mr-2" />{locale === 'bn' ? 'নিষ্ক্রিয় করুন' : 'Deactivate'}</>
                          ) : (
                            <><CheckCircle2 className="h-4 w-4 mr-2" />{locale === 'bn' ? 'সক্রিয় করুন' : 'Activate'}</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setSelectedWorker(worker); setShowDeleteModal(true); }} className="text-red-600">
                          <Trash2 className="h-4 w-4 mr-2" />{locale === 'bn' ? 'মুছুন' : 'Delete'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী বিস্তারিত' : 'Worker Details'}</DialogTitle>
          </DialogHeader>
          {selectedWorker && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center font-medium">
                  {selectedWorker.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium">{selectedWorker.name}</div>
                  <div className="flex gap-1 mt-1">{getStatusBadge(selectedWorker.status)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span><p>{selectedWorker.email || '-'}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'ফোন' : 'Phone'}</span><p>{selectedWorker.phone}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'শাখা' : 'Branch'}</span><p>{selectedWorker.assignedArea || '-'}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'যোগদান' : 'Joined'}</span><p>{new Date(selectedWorker.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'জমা প্রসেস' : 'Deposits'}</span><p>{selectedWorker.processedDeposits}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'ঋণ প্রসেস' : 'Loans'}</span><p>{selectedWorker.processedLoans}</p></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetailModal(false)}>{locale === 'bn' ? 'বন্ধ' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'নতুন কর্মী যোগ' : 'Add New Worker'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'নাম' : 'Name'}</Label>
              <Input value={newWorker.name} onChange={(e) => setNewWorker({ ...newWorker, name: e.target.value })} placeholder={locale === 'bn' ? 'পুরো নাম' : 'Full name'} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'ইমেইল' : 'Email'}</Label>
              <Input type="email" value={newWorker.email} onChange={(e) => setNewWorker({ ...newWorker, email: e.target.value })} placeholder={locale === 'bn' ? 'ইমেইল' : 'Email'} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'ফোন' : 'Phone'}</Label>
              <Input value={newWorker.phone} onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })} placeholder={locale === 'bn' ? 'ফোন' : 'Phone'} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'শাখা' : 'Branch'}</Label>
              <select
                aria-label={locale === 'bn' ? 'শাখা' : 'Branch'}
                value={newWorker.assignedBranchId}
                onChange={(e) => setNewWorker({ ...newWorker, assignedBranchId: e.target.value })}
                className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
              >
                <option value="">{locale === 'bn' ? 'কোনো শাখা নয়' : 'No branch'}</option>
                {branches
                  .filter((b) => b.isActive || b.id === newWorker.assignedBranchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                      {b.isActive ? '' : locale === 'bn' ? ' — নিষ্ক্রিয়' : ' — inactive'}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)} disabled={isMutating}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={() => void handleAddWorker()} disabled={isMutating}>{isMutating ? '...' : (locale === 'bn' ? 'যোগ করুন' : 'Add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী সম্পাদনা' : 'Edit Worker'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'নাম' : 'Name'}</Label>
              <Input value={editWorker.name} onChange={(e) => setEditWorker((prev) => ({ ...prev, name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'ফোন' : 'Phone'}</Label>
              <Input value={editWorker.phone} onChange={(e) => setEditWorker((prev) => ({ ...prev, phone: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'শাখা' : 'Branch'}</Label>
              <select
                aria-label={locale === 'bn' ? 'শাখা' : 'Branch'}
                value={editWorker.assignedBranchId}
                onChange={(e) => setEditWorker((prev) => ({ ...prev, assignedBranchId: e.target.value }))}
                className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500"
              >
                <option value="">{locale === 'bn' ? 'কোনো শাখা নয়' : 'No branch'}</option>
                {branches
                  .filter((b) => b.isActive || b.id === editWorker.assignedBranchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                      {b.isActive ? '' : locale === 'bn' ? ' — নিষ্ক্রিয়' : ' — inactive'}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowEditModal(false)} disabled={isMutating}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={() => void handleSaveEdit()} disabled={isMutating}>{isMutating ? '...' : (locale === 'bn' ? 'সংরক্ষণ' : 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী মুছুন' : 'Delete Worker'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? `"${selectedWorker?.name}" মুছে ফেলবেন? যদি ইতিহাস থাকে, অ্যাকাউন্ট নিষ্ক্রিয় করা হবে।`
                : `Delete "${selectedWorker?.name}"? If history exists, the account will be archived (inactive).`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)} disabled={isMutating}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button variant="destructive" size="sm" onClick={() => void handleDeleteWorker()} disabled={isMutating}>{isMutating ? '...' : (locale === 'bn' ? 'মুছুন' : 'Delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
