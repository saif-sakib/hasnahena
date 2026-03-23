'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Users,
  Search,
  MoreHorizontal,
  Eye,
  Ban,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  Calendar,
  Download,
  UserPlus,
  Shield,
  Edit,
  Trash2,
  MapPin,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet } from '@/lib/api';

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
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Form state for new worker
  const [newWorker, setNewWorker] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'WORKER' as 'WORKER' | 'ADMIN',
    assignedArea: '',
  });

  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    const loadWorkers = async () => {
      try {
        const data = await apiGet<Array<Worker & { currentDeposit?: number; activeLoan?: number }>>('/v1/dashboard/admin/workers');
        setWorkers(
          data.map((worker) => ({
            ...worker,
            role: worker.role === 'ADMIN' ? 'ADMIN' : 'WORKER',
            status: worker.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
            processedDeposits: worker.currentDeposit || 0,
            processedLoans: worker.activeLoan || 0,
          }))
        );
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

  const getStatusBadge = (status: 'ACTIVE' | 'INACTIVE') => {
    return status === 'ACTIVE' ? (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'সক্রিয়' : 'Active'}
      </Badge>
    ) : (
      <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
        <XCircle className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive'}
      </Badge>
    );
  };

  const getRoleBadge = (role: 'WORKER' | 'ADMIN') => {
    return role === 'ADMIN' ? (
      <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">
        <Shield className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'অ্যাডমিন' : 'Admin'}
      </Badge>
    ) : (
      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
        <Users className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'কর্মী' : 'Worker'}
      </Badge>
    );
  };

  const handleAddWorker = () => {
    // In a real app, make API call here
    console.log('Adding worker:', newWorker);
    setShowAddModal(false);
    setNewWorker({ name: '', email: '', phone: '', role: 'WORKER', assignedArea: '' });
  };

  const handleDeleteWorker = () => {
    // In a real app, make API call here
    console.log('Deleting worker:', selectedWorker?.id);
    setShowDeleteModal(false);
    setSelectedWorker(null);
  };

  const handleToggleStatus = (worker: Worker) => {
    // In a real app, make API call here
    console.log('Toggle status for worker:', worker.id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'কর্মী ব্যবস্থাপনা' : 'Worker Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'কর্মী এবং অ্যাডমিনদের পরিচালনা করুন'
              : 'Manage workers and admins'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'এক্সপোর্ট' : 'Export'}
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'কর্মী যোগ' : 'Add Worker'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট কর্মী' : 'Total Workers'}</p>
                <p className="text-2xl font-bold">{workers.length}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</p>
                <p className="text-2xl font-bold text-green-600">
                  {workers.filter((w) => w.status === 'ACTIVE').length}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অ্যাডমিন' : 'Admins'}</p>
                <p className="text-2xl font-bold text-purple-600">
                  {workers.filter((w) => w.role === 'ADMIN').length}
                </p>
              </div>
              <Shield className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive'}</p>
                <p className="text-2xl font-bold text-gray-600">
                  {workers.filter((w) => w.status === 'INACTIVE').length}
                </p>
              </div>
              <Ban className="h-8 w-8 text-gray-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === 'bn' ? 'নাম, ইমেইল, ফোন বা এলাকা দিয়ে খুঁজুন...' : 'Search by name, email, phone or area...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Workers List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {locale === 'bn' ? 'কর্মী তালিকা' : 'Workers List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredWorkers.length} জন কর্মী পাওয়া গেছে`
              : `${filteredWorkers.length} workers found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredWorkers.map((worker) => (
              <div
                key={worker.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {worker.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{worker.name}</span>
                      {getRoleBadge(worker.role)}
                      {getStatusBadge(worker.status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {worker.email}
                        </span>
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {worker.phone}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {worker.assignedArea}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {locale === 'bn' ? 'যোগদান:' : 'Joined:'}{' '}
                          {new Date(worker.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right text-sm">
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'জমা প্রসেস:' : 'Deposits:'}</span>{' '}
                      <span className="font-medium">{worker.processedDeposits}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণ প্রসেস:' : 'Loans:'}</span>{' '}
                      <span className="font-medium">{worker.processedLoans}</span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedWorker(worker);
                          setShowDetailModal(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        {locale === 'bn' ? 'বিস্তারিত দেখুন' : 'View Details'}
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Edit className="h-4 w-4 mr-2" />
                        {locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleStatus(worker)}>
                        {worker.status === 'ACTIVE' ? (
                          <>
                            <Ban className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'নিষ্ক্রিয় করুন' : 'Deactivate'}
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'সক্রিয় করুন' : 'Activate'}
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedWorker(worker);
                          setShowDeleteModal(true);
                        }}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {locale === 'bn' ? 'মুছে ফেলুন' : 'Delete'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {filteredWorkers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{locale === 'bn' ? 'কোনো কর্মী পাওয়া যায়নি' : 'No workers found'}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Worker Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী বিস্তারিত' : 'Worker Details'}</DialogTitle>
          </DialogHeader>
          {selectedWorker && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-semibold">
                  {selectedWorker.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedWorker.name}</h3>
                  <div className="flex gap-2">
                    {getRoleBadge(selectedWorker.role)}
                    {getStatusBadge(selectedWorker.status)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span>
                  <p className="font-medium">{selectedWorker.email}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                  <p className="font-medium">{selectedWorker.phone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'এলাকা' : 'Assigned Area'}</span>
                  <p className="font-medium">{selectedWorker.assignedArea}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}</span>
                  <p className="font-medium">
                    {new Date(selectedWorker.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসকৃত জমা' : 'Processed Deposits'}</span>
                  <p className="font-medium">{selectedWorker.processedDeposits}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'প্রসেসকৃত ঋণ' : 'Processed Loans'}</span>
                  <p className="font-medium">{selectedWorker.processedLoans}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'সর্বশেষ সক্রিয়' : 'Last Active'}</span>
                  <p className="font-medium">
                    {new Date(selectedWorker.lastActive).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Worker Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'নতুন কর্মী যোগ করুন' : 'Add New Worker'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn' ? 'নতুন কর্মীর তথ্য প্রদান করুন' : 'Provide new worker information'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{locale === 'bn' ? 'নাম' : 'Name'}</Label>
              <Input
                value={newWorker.name}
                onChange={(e) => setNewWorker({ ...newWorker, name: e.target.value })}
                placeholder={locale === 'bn' ? 'পুরো নাম লিখুন' : 'Enter full name'}
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'ইমেইল' : 'Email'}</Label>
              <Input
                type="email"
                value={newWorker.email}
                onChange={(e) => setNewWorker({ ...newWorker, email: e.target.value })}
                placeholder={locale === 'bn' ? 'ইমেইল লিখুন' : 'Enter email'}
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'ফোন' : 'Phone'}</Label>
              <Input
                value={newWorker.phone}
                onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })}
                placeholder={locale === 'bn' ? 'ফোন নম্বর লিখুন' : 'Enter phone number'}
              />
            </div>
            <div>
              <Label>{locale === 'bn' ? 'ভূমিকা' : 'Role'}</Label>
              <Select
                value={newWorker.role}
                onValueChange={(value: 'WORKER' | 'ADMIN') =>
                  setNewWorker({ ...newWorker, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WORKER">{locale === 'bn' ? 'কর্মী' : 'Worker'}</SelectItem>
                  <SelectItem value="ADMIN">{locale === 'bn' ? 'অ্যাডমিন' : 'Admin'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{locale === 'bn' ? 'নির্ধারিত এলাকা' : 'Assigned Area'}</Label>
              <Input
                value={newWorker.assignedArea}
                onChange={(e) => setNewWorker({ ...newWorker, assignedArea: e.target.value })}
                placeholder={locale === 'bn' ? 'এলাকা লিখুন' : 'Enter assigned area'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button onClick={handleAddWorker}>
              {locale === 'bn' ? 'যোগ করুন' : 'Add Worker'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'কর্মী মুছে ফেলুন' : 'Delete Worker'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? `আপনি কি নিশ্চিত যে আপনি "${selectedWorker?.name}" কে মুছে ফেলতে চান? এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`
                : `Are you sure you want to delete "${selectedWorker?.name}"? This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={handleDeleteWorker}>
              {locale === 'bn' ? 'মুছে ফেলুন' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
