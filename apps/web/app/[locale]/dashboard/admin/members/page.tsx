'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Users,
  Search,
  Filter,
  MoreHorizontal,
  Eye,
  Ban,
  CheckCircle2,
  Clock,
  XCircle,
  Mail,
  Phone,
  Calendar,
  ChevronDown,
  Download,
  UserPlus,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';

type MemberStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED';

interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  nidNumber: string;
  status: MemberStatus;
  joinDate: string;
  currentDeposit: number;
  activeLoan: number;
  area: string;
}

export default function AdminMembersPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'suspend' | 'activate' | null>(null);
  const [actionReason, setActionReason] = useState('');

  // Mock data
  const members: Member[] = [
    {
      id: '1',
      name: 'আব্দুল করিম',
      email: 'abdul.karim@email.com',
      phone: '01712345678',
      nidNumber: '1234567890123',
      status: 'ACTIVE',
      joinDate: '2024-01-15',
      currentDeposit: 85000,
      activeLoan: 50000,
      area: 'ঢাকা',
    },
    {
      id: '2',
      name: 'ফাতেমা বেগম',
      email: 'fatema.begum@email.com',
      phone: '01812345678',
      nidNumber: '2345678901234',
      status: 'ACTIVE',
      joinDate: '2024-02-20',
      currentDeposit: 120000,
      activeLoan: 0,
      area: 'চট্টগ্রাম',
    },
    {
      id: '3',
      name: 'নূর হোসেন',
      email: 'nur.hossain@email.com',
      phone: '01912345678',
      nidNumber: '3456789012345',
      status: 'PENDING',
      joinDate: '2025-01-10',
      currentDeposit: 0,
      activeLoan: 0,
      area: 'সিলেট',
    },
    {
      id: '4',
      name: 'রফিকুল ইসলাম',
      email: 'rafiqul@email.com',
      phone: '01612345678',
      nidNumber: '4567890123456',
      status: 'SUSPENDED',
      joinDate: '2023-06-01',
      currentDeposit: 45000,
      activeLoan: 30000,
      area: 'রাজশাহী',
    },
    {
      id: '5',
      name: 'সালমা আক্তার',
      email: 'salma.akter@email.com',
      phone: '01512345678',
      nidNumber: '5678901234567',
      status: 'REJECTED',
      joinDate: '2025-01-05',
      currentDeposit: 0,
      activeLoan: 0,
      area: 'খুলনা',
    },
    {
      id: '6',
      name: 'মোহাম্মদ আলী',
      email: 'mohammad.ali@email.com',
      phone: '01412345678',
      nidNumber: '6789012345678',
      status: 'PENDING',
      joinDate: '2025-01-12',
      currentDeposit: 0,
      activeLoan: 0,
      area: 'বরিশাল',
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: MemberStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সক্রিয়' : 'Active'}
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
          </Badge>
        );
      case 'SUSPENDED':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <Ban className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'স্থগিত' : 'Suspended'}
          </Badge>
        );
      case 'REJECTED':
        return (
          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
            <XCircle className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}
          </Badge>
        );
    }
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.phone.includes(searchQuery) ||
      member.nidNumber.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: members.length,
    ACTIVE: members.filter((m) => m.status === 'ACTIVE').length,
    PENDING: members.filter((m) => m.status === 'PENDING').length,
    SUSPENDED: members.filter((m) => m.status === 'SUSPENDED').length,
    REJECTED: members.filter((m) => m.status === 'REJECTED').length,
  };

  const handleAction = (member: Member, type: 'approve' | 'reject' | 'suspend' | 'activate') => {
    setSelectedMember(member);
    setActionType(type);
    setActionReason('');
    setShowActionModal(true);
  };

  const confirmAction = () => {
    // In a real app, make API call here
    console.log(`Action: ${actionType} for member: ${selectedMember?.id}, reason: ${actionReason}`);
    setShowActionModal(false);
    setSelectedMember(null);
    setActionType(null);
    setActionReason('');
  };

  const getActionTitle = () => {
    switch (actionType) {
      case 'approve':
        return locale === 'bn' ? 'সদস্য অনুমোদন' : 'Approve Member';
      case 'reject':
        return locale === 'bn' ? 'আবেদন প্রত্যাখ্যান' : 'Reject Application';
      case 'suspend':
        return locale === 'bn' ? 'সদস্যপদ স্থগিত' : 'Suspend Membership';
      case 'activate':
        return locale === 'bn' ? 'সদস্যপদ সক্রিয়' : 'Activate Membership';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'সদস্য ব্যবস্থাপনা' : 'Member Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'সকল সদস্যদের তালিকা দেখুন এবং পরিচালনা করুন'
              : 'View and manage all members'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'এক্সপোর্ট' : 'Export'}
          </Button>
          <Button>
            <UserPlus className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'সদস্য যোগ' : 'Add Member'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { key: 'all', label: locale === 'bn' ? 'মোট' : 'Total', color: 'bg-slate-100 text-slate-700' },
          { key: 'ACTIVE', label: locale === 'bn' ? 'সক্রিয়' : 'Active', color: 'bg-green-100 text-green-700' },
          { key: 'PENDING', label: locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending', color: 'bg-amber-100 text-amber-700' },
          { key: 'SUSPENDED', label: locale === 'bn' ? 'স্থগিত' : 'Suspended', color: 'bg-red-100 text-red-700' },
          { key: 'REJECTED', label: locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected', color: 'bg-gray-100 text-gray-700' },
        ].map((item) => (
          <Card
            key={item.key}
            className={`cursor-pointer transition-all ${statusFilter === item.key ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setStatusFilter(item.key)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{item.label}</span>
                <Badge className={item.color}>
                  {statusCounts[item.key as keyof typeof statusCounts]}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filter */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'নাম, ইমেইল, ফোন বা NID দিয়ে খুঁজুন...' : 'Search by name, email, phone or NID...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
                <SelectItem value="SUSPENDED">{locale === 'bn' ? 'স্থগিত' : 'Suspended'}</SelectItem>
                <SelectItem value="REJECTED">{locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Members List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {locale === 'bn' ? 'সদস্য তালিকা' : 'Members List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredMembers.length} জন সদস্য পাওয়া গেছে`
              : `${filteredMembers.length} members found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{member.name}</span>
                      {getStatusBadge(member.status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {member.email}
                        </span>
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {member.phone}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {locale === 'bn' ? 'যোগদান:' : 'Joined:'} {new Date(member.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                        </span>
                        <span>{locale === 'bn' ? 'এলাকা:' : 'Area:'} {member.area}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {member.status === 'ACTIVE' && (
                    <div className="text-right text-sm">
                      <div>
                        <span className="text-muted-foreground">{locale === 'bn' ? 'জমা:' : 'Deposit:'}</span>{' '}
                        <span className="font-medium text-green-600">{formatCurrency(member.currentDeposit)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণ:' : 'Loan:'}</span>{' '}
                        <span className="font-medium text-blue-600">{formatCurrency(member.activeLoan)}</span>
                      </div>
                    </div>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedMember(member);
                          setShowDetailModal(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        {locale === 'bn' ? 'বিস্তারিত দেখুন' : 'View Details'}
                      </DropdownMenuItem>
                      {member.status === 'PENDING' && (
                        <>
                          <DropdownMenuItem
                            onClick={() => handleAction(member, 'approve')}
                            className="text-green-600"
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'অনুমোদন করুন' : 'Approve'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleAction(member, 'reject')}
                            className="text-red-600"
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            {locale === 'bn' ? 'প্রত্যাখ্যান করুন' : 'Reject'}
                          </DropdownMenuItem>
                        </>
                      )}
                      {member.status === 'ACTIVE' && (
                        <DropdownMenuItem
                          onClick={() => handleAction(member, 'suspend')}
                          className="text-red-600"
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          {locale === 'bn' ? 'স্থগিত করুন' : 'Suspend'}
                        </DropdownMenuItem>
                      )}
                      {member.status === 'SUSPENDED' && (
                        <DropdownMenuItem
                          onClick={() => handleAction(member, 'activate')}
                          className="text-green-600"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          {locale === 'bn' ? 'সক্রিয় করুন' : 'Activate'}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {filteredMembers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{locale === 'bn' ? 'কোনো সদস্য পাওয়া যায়নি' : 'No members found'}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Member Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'সদস্য বিস্তারিত' : 'Member Details'}</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-semibold">
                  {selectedMember.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedMember.name}</h3>
                  {getStatusBadge(selectedMember.status)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span>
                  <p className="font-medium">{selectedMember.email}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                  <p className="font-medium">{selectedMember.phone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'NID নম্বর' : 'NID Number'}</span>
                  <p className="font-medium">{selectedMember.nidNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'এলাকা' : 'Area'}</span>
                  <p className="font-medium">{selectedMember.area}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}</span>
                  <p className="font-medium">
                    {new Date(selectedMember.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বর্তমান জমা' : 'Current Deposit'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedMember.currentDeposit)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedMember.activeLoan)}</p>
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

      {/* Action Confirmation Modal */}
      <Dialog open={showActionModal} onOpenChange={setShowActionModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{getActionTitle()}</DialogTitle>
            <DialogDescription>
              {selectedMember?.name} - {locale === 'bn' ? 'এই কাজটি নিশ্চিত করুন' : 'Confirm this action'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {locale === 'bn' ? 'কারণ (ঐচ্ছিক)' : 'Reason (optional)'}
              </label>
              <Textarea
                placeholder={locale === 'bn' ? 'কারণ লিখুন...' : 'Enter reason...'}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActionModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              onClick={confirmAction}
              variant={actionType === 'reject' || actionType === 'suspend' ? 'destructive' : 'default'}
            >
              {locale === 'bn' ? 'নিশ্চিত করুন' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
