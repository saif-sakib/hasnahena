'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Users,
  Search,
  Phone,
  MapPin,
  Calendar,
  Wallet,
  HandCoins,
  Eye,
  MoreHorizontal,
  CheckCircle2,
  Clock,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface Member {
  id: string;
  name: string;
  phone: string;
  email?: string;
  nidNumber: string;
  address: string;
  status: 'ACTIVE' | 'PENDING';
  joinDate: string;
  currentDeposit: number;
  activeLoan: number;
  lastTransaction?: string;
}

export default function WorkerMembersPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const data = await apiGet<Member[]>('/v1/dashboard/worker/members');
        setMembers(
          data.map((member) => ({
            ...member,
            status: member.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
          }))
        );
      } catch {
        setMembers([]);
      }
    };
    loadMembers();
  }, []);


  const getStatusBadge = (status: 'ACTIVE' | 'PENDING') => {
    return status === 'ACTIVE' ? (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'সক্রিয়' : 'Active'}
      </Badge>
    ) : (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
        <Clock className="h-3 w-3 mr-1" />
        {locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}
      </Badge>
    );
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.phone.includes(searchQuery) ||
      member.nidNumber.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Summary stats
  const totalMembers = members.filter((m) => m.status === 'ACTIVE').length;
  const totalDeposits = members.reduce((sum, m) => sum + m.currentDeposit, 0);
  const totalLoans = members.reduce((sum, m) => sum + m.activeLoan, 0);
  const pendingMembers = members.filter((m) => m.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'আমার সদস্যগণ' : 'My Members'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'আপনার এলাকায় নির্ধারিত সদস্যদের তালিকা'
              : 'Members assigned to your area'}
          </p>
        </div>
        <div />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় সদস্য' : 'Active Members'}</p>
                <p className="text-2xl font-bold">{totalMembers}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট জমা' : 'Total Deposits'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposits, locale)}</p>
              </div>
              <Wallet className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loans'}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalLoans, locale)}</p>
              </div>
              <HandCoins className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</p>
                <p className="text-2xl font-bold text-amber-600">{pendingMembers}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'নাম, ফোন বা NID দিয়ে খুঁজুন...' : 'Search by name, phone or NID...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'}</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'}</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'}</SelectItem>
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
                      <p className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {member.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {member.address}
                        </span>
                      </p>
                      <p className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {locale === 'bn' ? 'যোগদান:' : 'Joined:'}{' '}
                        {new Date(member.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {member.status === 'ACTIVE' && (
                    <div className="text-right text-sm">
                      <div>
                        <span className="text-muted-foreground">{locale === 'bn' ? 'জমা:' : 'Deposit:'}</span>{' '}
                        <span className="font-medium text-green-600">{formatCurrency(member.currentDeposit, locale)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{locale === 'bn' ? 'ঋণ:' : 'Loan:'}</span>{' '}
                        <span className="font-medium text-blue-600">{formatCurrency(member.activeLoan, locale)}</span>
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
                      {member.status === 'ACTIVE' && (
                        <DropdownMenuItem>
                          <HandCoins className="h-4 w-4 mr-2" />
                          {locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment'}
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
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                  <p className="font-medium">{selectedMember.phone}</p>
                </div>
                {selectedMember.email && (
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span>
                    <p className="font-medium">{selectedMember.email}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'NID নম্বর' : 'NID Number'}</span>
                  <p className="font-medium">{selectedMember.nidNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ঠিকানা' : 'Address'}</span>
                  <p className="font-medium">{selectedMember.address}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}</span>
                  <p className="font-medium">
                    {new Date(selectedMember.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
                {selectedMember.lastTransaction && (
                  <div>
                    <span className="text-muted-foreground">{locale === 'bn' ? 'সর্বশেষ লেনদেন' : 'Last Transaction'}</span>
                    <p className="font-medium">
                      {new Date(selectedMember.lastTransaction).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বর্তমান জমা' : 'Current Deposit'}</span>
                  <p className="font-medium text-green-600">{formatCurrency(selectedMember.currentDeposit, locale)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</span>
                  <p className="font-medium text-blue-600">{formatCurrency(selectedMember.activeLoan, locale)}</p>
                </div>
              </div>

              {selectedMember.status === 'ACTIVE' && (
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" className="flex-1">
                    <HandCoins className="h-4 w-4 mr-2" />
                    {locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment'}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
