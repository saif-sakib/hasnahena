'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Users,
  Search,
  Eye,
  Ban,
  CheckCircle2,
  Clock,
  XCircle,
  Mail,
  Phone,
  Calendar,
  Download,
  ChevronDown,
  ChevronUp,
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type MemberStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED';

interface Member {
  id: string;
  memberId?: string;
  name: string;
  nameBn?: string;
  email: string;
  phone: string;
  nidNumber: string;
  status: MemberStatus;
  joinDate: string;
  currentDeposit: number;
  activeLoan: number;
  area: string;
  fatherName?: string;
  motherName?: string;
  gender?: string;
  maritalStatus?: string;
  dateOfBirth?: string;
  permanentAddress?: any;
  presentAddress?: any;
  nominee?: any;
  avatarUrl?: string;
}

const INITIAL_DISPLAY_COUNT = 10;

export default function AdminMembersPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMembers = async () => {
      setIsLoading(true);
      try {
        const data = await apiGet<Array<Member & { role?: string }>>('/v1/dashboard/admin/members');
        setMembers(
          data.map((member): Member => {
            const normalized = member.status.toUpperCase();
            return {
              ...member,
              status: normalized === 'ACTIVE'
                ? 'ACTIVE'
                : normalized === 'PENDING'
                  ? 'PENDING'
                  : normalized === 'SUSPENDED'
                    ? 'SUSPENDED'
                    : 'REJECTED',
            };
          }).sort((a, b) => new Date(b.joinDate).getTime() - new Date(a.joinDate).getTime())
        );
      } catch {
        setMembers([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadMembers();
  }, []);

  const getStatusBadge = (status: MemberStatus) => {
    const config = {
      ACTIVE: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: locale === 'bn' ? 'সক্রিয়' : 'Active' },
      PENDING: { color: 'bg-amber-100 text-amber-700', icon: Clock, label: locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending' },
      SUSPENDED: { color: 'bg-red-100 text-red-700', icon: Ban, label: locale === 'bn' ? 'স্থগিত' : 'Suspended' },
      REJECTED: { color: 'bg-gray-100 text-gray-700', icon: XCircle, label: locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected' },
    };
    const { color, icon: Icon, label } = config[status];
    return (
      <Badge className={`${color} hover:${color}`}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
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

  const displayedMembers = filteredMembers.slice(0, displayCount);
  const hasMore = filteredMembers.length > displayCount;

  const statusCounts = {
    all: members.length,
    ACTIVE: members.filter((m) => m.status === 'ACTIVE').length,
    PENDING: members.filter((m) => m.status === 'PENDING').length,
    SUSPENDED: members.filter((m) => m.status === 'SUSPENDED').length,
  };

  const formatAddress = (addr: any) => {
    if (!addr) return '-';
    return [addr.houseNo, addr.roadNo, addr.village, addr.union, addr.policeStation, addr.district]
      .filter(Boolean).join(', ') || '-';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'সদস্য ব্যবস্থাপনা' : 'Member Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn' ? 'সকল সদস্যদের তালিকা দেখুন' : 'View all members'}
          </p>
        </div>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          {locale === 'bn' ? 'এক্সপোর্ট' : 'Export'}
        </Button>
      </div>

      {/* Search */}
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
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setDisplayCount(INITIAL_DISPLAY_COUNT); }}>
              <SelectTrigger className="w-full md:w-52">
                <SelectValue placeholder={locale === 'bn' ? 'স্ট্যাটাস' : 'Status'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'bn' ? 'সব' : 'All'} ({statusCounts.all})</SelectItem>
                <SelectItem value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'} ({statusCounts.ACTIVE})</SelectItem>
                <SelectItem value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'} ({statusCounts.PENDING})</SelectItem>
                <SelectItem value="SUSPENDED">{locale === 'bn' ? 'স্থগিত' : 'Suspended'} ({statusCounts.SUSPENDED})</SelectItem>
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
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </div>
          ) : (
            <div className="space-y-4">
              {displayedMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                  onClick={() => { setSelectedMember(member); setShowDetailModal(true); }}
                >
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">{member.name}</span>
                        {member.memberId && <Badge variant="outline">{member.memberId}</Badge>}
                        {getStatusBadge(member.status)}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {member.email || '-'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {member.phone}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {locale === 'bn' ? 'যোগদান:' : 'Joined:'} {new Date(member.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                        </div>
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
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {filteredMembers.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো সদস্য পাওয়া যায়নি' : 'No members found'}</p>
                </div>
              )}

              {hasMore && (
                <div className="text-center pt-4">
                  <Button variant="outline" onClick={() => setDisplayCount((prev) => prev + 10)}>
                    <ChevronDown className="h-4 w-4 mr-2" />
                    {locale === 'bn' ? `আরও ${filteredMembers.length - displayCount} জন দেখুন` : `Show ${filteredMembers.length - displayCount} more`}
                  </Button>
                </div>
              )}

              {displayCount > INITIAL_DISPLAY_COUNT && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={() => setDisplayCount(INITIAL_DISPLAY_COUNT)}>
                    <ChevronUp className="h-4 w-4 mr-2" />
                    {locale === 'bn' ? 'কম দেখুন' : 'Show less'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Member Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'সদস্য বিস্তারিত' : 'Member Details'}</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-semibold">
                  {selectedMember.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{selectedMember.name}</h3>
                  {selectedMember.nameBn && <p className="text-muted-foreground">{selectedMember.nameBn}</p>}
                  <div className="flex gap-2 mt-2">
                    {selectedMember.memberId && <Badge variant="outline">{selectedMember.memberId}</Badge>}
                    {getStatusBadge(selectedMember.status)}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ইমেইল' : 'Email'}</span>
                  <p className="font-medium">{selectedMember.email || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                  <p className="font-medium">{selectedMember.phone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'NID নম্বর' : 'NID Number'}</span>
                  <p className="font-medium">{selectedMember.nidNumber || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}</span>
                  <p className="font-medium">
                    {new Date(selectedMember.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
              </div>

              {/* Personal Info */}
              <div className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'পিতার নাম' : "Father's Name"}</span>
                  <p className="font-medium">{selectedMember.fatherName || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'মাতার নাম' : "Mother's Name"}</span>
                  <p className="font-medium">{selectedMember.motherName || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'লিঙ্গ' : 'Gender'}</span>
                  <p className="font-medium">{selectedMember.gender || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'বৈবাহিক অবস্থা' : 'Marital Status'}</span>
                  <p className="font-medium">{selectedMember.maritalStatus || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{locale === 'bn' ? 'জন্ম তারিখ' : 'Date of Birth'}</span>
                  <p className="font-medium">
                    {selectedMember.dateOfBirth
                      ? new Date(selectedMember.dateOfBirth).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')
                      : '-'}
                  </p>
                </div>
              </div>

              {/* Addresses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t pt-4">
                <div>
                  <span className="text-muted-foreground font-medium">{locale === 'bn' ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}</span>
                  <p className="mt-1">{formatAddress(selectedMember.permanentAddress)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">{locale === 'bn' ? 'বর্তমান ঠিকানা' : 'Present Address'}</span>
                  <p className="mt-1">{formatAddress(selectedMember.presentAddress)}</p>
                </div>
              </div>

              {/* Nominee */}
              {selectedMember.nominee && (
                <div className="text-sm border-t pt-4">
                  <span className="text-muted-foreground font-medium">{locale === 'bn' ? 'নমিনী' : 'Nominee'}</span>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'নাম' : 'Name'}</span>
                      <p className="font-medium">{selectedMember.nominee.name || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'সম্পর্ক' : 'Relationship'}</span>
                      <p className="font-medium">{selectedMember.nominee.relationship || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'NID' : 'NID'}</span>
                      <p className="font-medium">{selectedMember.nominee.nidNumber || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{locale === 'bn' ? 'ফোন' : 'Phone'}</span>
                      <p className="font-medium">{selectedMember.nominee.phone || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Financial Info */}
              {selectedMember.status === 'ACTIVE' && (
                <div className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
                  <div className="p-4 bg-green-50 rounded-xl">
                    <span className="text-muted-foreground">{locale === 'bn' ? 'বর্তমান জমা' : 'Current Deposit'}</span>
                    <p className="text-xl font-bold text-green-600">{formatCurrency(selectedMember.currentDeposit, locale)}</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <span className="text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loan'}</span>
                    <p className="text-xl font-bold text-blue-600">{formatCurrency(selectedMember.activeLoan, locale)}</p>
                  </div>
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
