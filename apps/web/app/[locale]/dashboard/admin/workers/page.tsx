'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search, UserPlus, MoreHorizontal, Eye, Edit, Trash2, Ban, CheckCircle2 } from 'lucide-react';
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
import { apiGet } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

interface Worker {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'WORKER' | 'ADMIN';
  status: 'ACTIVE' | 'INACTIVE';
  assignedArea: string;
  joinDate: string;
  processedDeposits: number;
  processedLoans: number;
  lastActive: string;
}

export default function AdminWorkersPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Form state for new worker
  const [newWorker, setNewWorker] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'WORKER' as 'WORKER' | 'ADMIN',
    assignedArea: '',
  });
  const [editWorker, setEditWorker] = useState({
    name: '',
    phone: '',
    assignedArea: '',
    role: 'WORKER' as 'WORKER' | 'ADMIN',
  });

  const [workers, setWorkers] = useState<Worker[]>([]);

  const normalizeWorker = (worker: any): Worker => ({
    ...worker,
    role: worker.role === 'ADMIN' ? 'ADMIN' : 'WORKER',
    status: worker.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    processedDeposits: worker.currentDeposit || worker.processedDeposits || 0,
    processedLoans: worker.activeLoan || worker.processedLoans || 0,
    assignedArea: worker.assignedArea || '',
    joinDate: worker.joinDate || worker.createdAt || new Date().toISOString(),
    lastActive: worker.lastActive || worker.joinDate || new Date().toISOString(),
  });

  useEffect(() => {
    const loadWorkers = async () => {
      try {
        const data = await apiGet<Array<Worker & { currentDeposit?: number; activeLoan?: number }>>('/v1/dashboard/admin/workers');
        setWorkers(data.map((worker) => normalizeWorker(worker)));
      } catch {
        setWorkers([]);
      }
    };
    loadWorkers();
  }, []);

  const filteredWorkers = workers.filter(
    (worker) =>
      worker.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      worker.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      worker.phone.includes(searchQuery) ||
      worker.assignedArea.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status: 'ACTIVE' | 'INACTIVE') => (
    <span className={`px-2 py-0.5 text-xs rounded ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      {status === 'ACTIVE' ? (locale === 'bn' ? 'সক্রিয়' : 'Active') : (locale === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive')}
    </span>
  );

  const getRoleBadge = (role: 'WORKER' | 'ADMIN') => (
    <span className={`px-2 py-0.5 text-xs rounded ${role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
      {role === 'ADMIN' ? (locale === 'bn' ? 'অ্যাডমিন' : 'Admin') : (locale === 'bn' ? 'কর্মী' : 'Worker')}
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
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      const response = await fetch('/api/v1/admin/workers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: newWorker.name,
          email: newWorker.email,
          phone: newWorker.phone,
          role: newWorker.role,
          assignedArea: newWorker.assignedArea,
          locale,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result?.error || 'Failed to add worker');
      }

      setWorkers((prev) => [normalizeWorker(result.data), ...prev]);
      setShowAddModal(false);
      setNewWorker({ name: '', email: '', phone: '', role: 'WORKER', assignedArea: '' });
      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description: locale === 'bn'
          ? 'স্টাফ অ্যাকাউন্ট তৈরি হয়েছে এবং ইমেইল পাঠানো হয়েছে'
          : 'Staff account created and email sent',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: error instanceof Error ? error.message : (locale === 'bn' ? 'স্টাফ যোগ করা যায়নি' : 'Failed to add staff'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteWorker = () => {
    // In a real app, make API call here
    console.log('Deleting worker:', selectedWorker?.id);
    setShowDeleteModal(false);
    setSelectedWorker(null);
  };

  const handleStartEdit = (worker: Worker) => {
    setSelectedWorker(worker);
    setEditWorker({
      name: worker.name,
      phone: worker.phone,
      assignedArea: worker.assignedArea,
      role: worker.role,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedWorker) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      const response = await fetch('/api/v1/admin/workers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: selectedWorker.id,
          name: editWorker.name,
          phone: editWorker.phone,
          role: editWorker.role,
          assignedArea: editWorker.assignedArea,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result?.error || 'Failed to update worker');
      }
      setWorkers((prev) => prev.map((w) => (w.id === selectedWorker.id ? normalizeWorker(result.data) : w)));
      setShowEditModal(false);
      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description: locale === 'bn' ? 'কর্মীর তথ্য আপডেট হয়েছে' : 'Worker information updated',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: error instanceof Error ? error.message : (locale === 'bn' ? 'আপডেট ব্যর্থ হয়েছে' : 'Update failed'),
        variant: 'destructive',
      });
    }
  };

  const handleToggleStatus = (worker: Worker) => {
    // In a real app, make API call here
    console.log('Toggle status for worker:', worker.id);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'কর্মী ব্যবস্থাপনা' : 'Worker Management'}
          </h1>
          <p className="text-sm text-gray-500">{workers.length} {locale === 'bn' ? 'জন' : 'total'}</p>
        </div>
        <Button size="sm" onClick={() => setShowAddModal(true)} className="h-8">
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          {locale === 'bn' ? 'কর্মী যোগ' : 'Add Worker'}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div><span className="text-gray-500">{locale === 'bn' ? 'সক্রিয়:' : 'Active:'}</span> <span className="font-medium text-green-600">{workers.filter(w => w.status === 'ACTIVE').length}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'অ্যাডমিন:' : 'Admins:'}</span> <span className="font-medium text-purple-600">{workers.filter(w => w.role === 'ADMIN').length}</span></div>
        <div><span className="text-gray-500">{locale === 'bn' ? 'নিষ্ক্রিয়:' : 'Inactive:'}</span> <span className="font-medium text-gray-600">{workers.filter(w => w.status === 'INACTIVE').length}</span></div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder={locale === 'bn' ? 'নাম, ইমেইল, ফোন বা এলাকা দিয়ে খুঁজুন...' : 'Search by name, email, phone or area...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Workers Table */}
      <div className="border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'নাম' : 'Name'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'যোগাযোগ' : 'Contact'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'এলাকা' : 'Area'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ভূমিকা' : 'Role'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {filteredWorkers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{locale === 'bn' ? 'কোনো কর্মী পাওয়া যায়নি' : 'No workers found'}</td></tr>
            ) : filteredWorkers.map((worker) => (
              <tr key={worker.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{worker.name}</div>
                  <div className="text-xs text-gray-500 sm:hidden">{worker.email}</div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="text-gray-700">{worker.email}</div>
                  <div className="text-xs text-gray-500">{worker.phone}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-600">{worker.assignedArea || '-'}</td>
                <td className="px-4 py-3">{getRoleBadge(worker.role)}</td>
                <td className="px-4 py-3">{getStatusBadge(worker.status)}</td>
                <td className="px-4 py-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setSelectedWorker(worker); setShowDetailModal(true); }}>
                        <Eye className="h-4 w-4 mr-2" />{locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleStartEdit(worker)}>
                        <Edit className="h-4 w-4 mr-2" />{locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleStatus(worker)}>
                        {worker.status === 'ACTIVE' ? (
                          <><Ban className="h-4 w-4 mr-2" />{locale === 'bn' ? 'নিষ্ক্রিয়' : 'Deactivate'}</>
                        ) : (
                          <><CheckCircle2 className="h-4 w-4 mr-2" />{locale === 'bn' ? 'সক্রিয়' : 'Activate'}</>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setSelectedWorker(worker); setShowDeleteModal(true); }} className="text-red-600">
                        <Trash2 className="h-4 w-4 mr-2" />{locale === 'bn' ? 'মুছুন' : 'Delete'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Worker Detail Modal */}
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
                  <div className="flex gap-1 mt-1">{getRoleBadge(selectedWorker.role)} {getStatusBadge(selectedWorker.status)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span><p>{selectedWorker.email}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'ফোন' : 'Phone'}</span><p>{selectedWorker.phone}</p></div>
                <div><span className="text-gray-500">{locale === 'bn' ? 'এলাকা' : 'Area'}</span><p>{selectedWorker.assignedArea || '-'}</p></div>
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

      {/* Add Worker Modal */}
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
              <Label className="text-sm">{locale === 'bn' ? 'ভূমিকা' : 'Role'}</Label>
              <select value={newWorker.role} onChange={(e) => setNewWorker({ ...newWorker, role: e.target.value as 'WORKER' | 'ADMIN' })} className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 focus:outline-none focus:border-blue-500">
                <option value="WORKER">{locale === 'bn' ? 'কর্মী' : 'Worker'}</option>
                <option value="ADMIN">{locale === 'bn' ? 'অ্যাডমিন' : 'Admin'}</option>
              </select>
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'এলাকা' : 'Area'}</Label>
              <Input value={newWorker.assignedArea} onChange={(e) => setNewWorker({ ...newWorker, assignedArea: e.target.value })} placeholder={locale === 'bn' ? 'এলাকা' : 'Area'} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={handleAddWorker}>{locale === 'bn' ? 'যোগ করুন' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Worker Modal */}
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
              <Label className="text-sm">{locale === 'bn' ? 'এলাকা' : 'Area'}</Label>
              <Input value={editWorker.assignedArea} onChange={(e) => setEditWorker((prev) => ({ ...prev, assignedArea: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">{locale === 'bn' ? 'ভূমিকা' : 'Role'}</Label>
              <select value={editWorker.role} onChange={(e) => setEditWorker((prev) => ({ ...prev, role: e.target.value as 'WORKER' | 'ADMIN' }))} className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 focus:outline-none focus:border-blue-500">
                <option value="WORKER">{locale === 'bn' ? 'কর্মী' : 'Worker'}</option>
                <option value="ADMIN">{locale === 'bn' ? 'অ্যাডমিন' : 'Admin'}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowEditModal(false)}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button size="sm" onClick={handleSaveEdit}>{locale === 'bn' ? 'সংরক্ষণ' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী মুছুন' : 'Delete Worker'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? `"${selectedWorker?.name}" মুছে ফেলবেন?` : `Delete "${selectedWorker?.name}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)}>{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteWorker}>{locale === 'bn' ? 'মুছুন' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
