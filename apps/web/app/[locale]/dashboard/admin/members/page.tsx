'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
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
  ChevronDown,
  ChevronUp,
  Hash,
  ExternalLink,
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
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type MemberStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED';

interface Member {
  id: string;
  uid: string;
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
}

const INITIAL_DISPLAY_COUNT = 10;

export default function AdminMembersPage() {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE');
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
              uid: member.uid || member.id.slice(0, 8).toUpperCase(),
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
      member.nidNumber.includes(searchQuery) ||
      member.uid.toLowerCase().includes(searchQuery.toLowerCase());
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
      </div>

      {/* Search */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={locale === 'bn' ? 'UID, নাম, ইমেইল, ফোন বা NID দিয়ে খুঁজুন...' : 'Search by UID, name, email, phone or NID...'}
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
                <Link
                  key={member.id}
                  href={`/${locale}/dashboard/admin/members/${member.id}`}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">{member.name}</span>
                        <Badge variant="secondary" className="font-mono text-xs">
                          <Hash className="h-3 w-3 mr-1" />
                          {member.uid}
                        </Badge>
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
                    <Button variant="ghost" size="sm" asChild>
                      <span>
                        <ExternalLink className="h-4 w-4" />
                      </span>
                    </Button>
                  </div>
                </Link>
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
    </div>
  );
}
