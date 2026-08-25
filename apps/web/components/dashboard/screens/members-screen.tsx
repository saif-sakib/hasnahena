'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useDashboardRole } from '@/components/dashboard/role';
import { localePath } from '@/lib/locale-path';

type MemberStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED';

interface Member {
  id: string;
  accountNo: string;
  uid?: string;
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

const INITIAL_DISPLAY_COUNT = 15;

export default function MembersScreen() {
  const locale = useLocale();
  const tA11y = useTranslations('dashboard.a11y');
  const roleSegment = useDashboardRole();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE');
  const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMembers = async () => {
      setIsLoading(true);
      try {
        const data = await apiGet<Array<Member & { role?: string }>>('/v1/dashboard/worker/members');
        setMembers(
          data.map((member): Member => {
            const normalized = member.status.toUpperCase();
            return {
              ...member,
              accountNo: member.accountNo || member.uid || '',
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

  const getStatusStyle = (status: MemberStatus) => {
    const styles = {
      ACTIVE: 'text-green-700 bg-green-50',
      PENDING: 'text-amber-700 bg-amber-50',
      SUSPENDED: 'text-red-700 bg-red-50',
      REJECTED: 'text-gray-700 bg-gray-100',
    };
    return styles[status];
  };

  const getStatusLabel = (status: MemberStatus) => {
    const labels = {
      ACTIVE: locale === 'bn' ? 'সক্রিয়' : 'Active',
      PENDING: locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending',
      SUSPENDED: locale === 'bn' ? 'স্থগিত' : 'Suspended',
      REJECTED: locale === 'bn' ? 'প্রত্যাখ্যাত' : 'Rejected',
    };
    return labels[status];
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.phone.includes(searchQuery) ||
      member.nidNumber.includes(searchQuery) ||
      member.accountNo.toLowerCase().includes(searchQuery.toLowerCase());
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {locale === 'bn' ? 'সদস্য ব্যবস্থাপনা' : 'Member Management'}
        </h1>
        <span className="text-sm text-gray-500">
          {filteredMembers.length} {locale === 'bn' ? 'জন' : 'members'}
        </span>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder={locale === 'bn' ? 'সদস্য ID, নাম, ইমেইল, ফোন...' : 'Search member ID, name, email, phone...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <select aria-label={tA11y('filterByStatus')}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setDisplayCount(INITIAL_DISPLAY_COUNT); }}
          className="h-9 px-3 text-sm border border-gray-200 rounded bg-white"
        >
          <option value="all">{locale === 'bn' ? 'সব' : 'All'} ({statusCounts.all})</option>
          <option value="ACTIVE">{locale === 'bn' ? 'সক্রিয়' : 'Active'} ({statusCounts.ACTIVE})</option>
          <option value="PENDING">{locale === 'bn' ? 'অপেক্ষমাণ' : 'Pending'} ({statusCounts.PENDING})</option>
          <option value="SUSPENDED">{locale === 'bn' ? 'স্থগিত' : 'Suspended'} ({statusCounts.SUSPENDED})</option>
        </select>
      </div>

      {/* Members Table */}
      <div className="border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'সদস্য' : 'Member'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'যোগাযোগ' : 'Contact'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'জমা' : 'Deposit'}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'ঋণ' : 'Loan'}</th>
              <th className="px-4 py-2 text-center font-medium text-gray-600">{locale === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
                </td>
              </tr>
            ) : displayedMembers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো সদস্য পাওয়া যায়নি' : 'No members found'}
                </td>
              </tr>
            ) : (
              displayedMembers.map((member) => (
                <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={localePath(locale, `/dashboard/${roleSegment}/members/${member.id}`)} className="block hover:text-blue-600">
                      <div className="font-medium text-gray-900">{member.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{member.accountNo || '-'}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="text-gray-900">{member.phone}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[180px]">{member.email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    <span className="text-green-600 font-medium">{formatCurrency(member.currentDeposit, locale)}</span>
                  </td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    <span className="text-blue-600 font-medium">{formatCurrency(member.activeLoan, locale)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${getStatusStyle(member.status)}`}>
                      {getStatusLabel(member.status)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Load More / Less */}
        {(hasMore || displayCount > INITIAL_DISPLAY_COUNT) && (
          <div className="px-4 py-3 border-t border-gray-100 flex justify-center gap-4">
            {hasMore && (
              <button
                onClick={() => setDisplayCount((prev) => prev + 15)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <ChevronDown className="h-4 w-4" />
                {locale === 'bn' ? `আরও ${filteredMembers.length - displayCount} জন` : `Show ${filteredMembers.length - displayCount} more`}
              </button>
            )}
            {displayCount > INITIAL_DISPLAY_COUNT && (
              <button
                onClick={() => setDisplayCount(INITIAL_DISPLAY_COUNT)}
                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
              >
                <ChevronUp className="h-4 w-4" />
                {locale === 'bn' ? 'কম দেখুন' : 'Show less'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
