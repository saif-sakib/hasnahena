'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

interface RegistrationRequest {
  id: string;
  name: string;
  nameBn?: string;
  email?: string;
  phone: string;
  nidNumber?: string;
  fatherName?: string;
  motherName?: string;
  gender?: string;
  bloodGroup?: string;
  profession?: string;
  maritalStatus?: string;
  childrenCount?: number;
  dateOfBirth?: string;
  permanentAddress?: {
    houseNo?: string;
    roadNo?: string;
    village?: string;
    union?: string;
    policeStation?: string;
    district?: string;
  };
  presentAddress?: {
    houseNo?: string;
    roadNo?: string;
    village?: string;
    union?: string;
    policeStation?: string;
    district?: string;
  };
  nominee?: {
    name?: string;
    relationship?: string;
    nidNumber?: string;
    phone?: string;
  };
  requestDate: string;
}

function RegistrationRow({
  item,
  locale,
  isActionLoading,
  onApprove,
  onReject,
}: {
  item: RegistrationRequest;
  locale: string;
  isActionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const formatAddress = (addr: RegistrationRequest['permanentAddress']) => {
    if (!addr) return '-';
    return [addr.village, addr.union, addr.policeStation, addr.district]
      .filter(Boolean)
      .join(', ') || '-';
  };

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{item.name}</div>
          <div className="text-xs text-gray-500">{item.nameBn}</div>
        </td>
        <td className="px-4 py-3">{item.phone}</td>
        <td className="px-4 py-3 hidden sm:table-cell">{item.email || '-'}</td>
        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
          {new Date(item.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={isActionLoading}
              onClick={onReject}
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={isActionLoading}
              onClick={onApprove}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div>
                <span className="text-gray-500">NID:</span> {item.nidNumber || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'পিতা:' : 'Father:'}</span> {item.fatherName || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'মাতা:' : 'Mother:'}</span> {item.motherName || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'লিঙ্গ:' : 'Gender:'}</span> {item.gender || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'রক্তের গ্রুপ:' : 'Blood Group:'}</span> {item.bloodGroup || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'পেশা:' : 'Profession:'}</span> {item.profession || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'বৈবাহিক:' : 'Marital:'}</span> {item.maritalStatus || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'সন্তান:' : 'Children:'}</span> {item.childrenCount ?? 0}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'স্থায়ী ঠিকানা:' : 'Permanent:'}</span>
                <span className="text-gray-700">{formatAddress(item.permanentAddress)}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'বর্তমান ঠিকানা:' : 'Present:'}</span>
                <span className="text-gray-700">{formatAddress(item.presentAddress)}</span>
              </div>
            </div>
            {item.nominee && (
              <div className="mt-3 text-sm">
                <span className="text-gray-500">{locale === 'bn' ? 'নমিনী:' : 'Nominee:'}</span>{' '}
                {[item.nominee.name, item.nominee.relationship, item.nominee.phone].filter(Boolean).join(' • ') || '-'}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminApprovalsPage() {
  const locale = useLocale();
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRegistrations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const approvalsData = await apiGet<{ registrationRequests: RegistrationRequest[] }>('/v1/dashboard/admin/approvals');
      setRegistrations(approvalsData.registrationRequests ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load registration approvals');
      setRegistrations([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRegistrations();
  }, []);

  const pendingCount = useMemo(() => registrations.length, [registrations.length]);

  const runAction = async (id: string, action: 'approve' | 'reject') => {
    setIsActionLoading(true);
    setError(null);
    try {
      if (action === 'approve') {
        await apiPost('/v1/dashboard/admin/approvals/registration', { userId: id, notes: '' });
      } else {
        await apiPost('/v1/dashboard/admin/approvals/registration/reject', { userId: id, reason: '' });
      }
      await loadRegistrations();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed');
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'নিবন্ধন অনুমোদন' : 'Registration Approvals'}
          </h1>
          <p className="text-sm text-gray-500">
            {pendingCount} {locale === 'bn' ? 'টি অপেক্ষমাণ' : 'pending'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadRegistrations()}
          disabled={isLoading || isActionLoading}
          className="h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${(isLoading || isActionLoading) ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'নাম' : 'Name'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ফোন' : 'Phone'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'ইমেইল' : 'Email'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : registrations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {locale === 'bn' ? 'কোনো অপেক্ষমাণ নিবন্ধন নেই' : 'No pending registrations'}
                </td>
              </tr>
            ) : (
              registrations.map((item) => (
                <RegistrationRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  isActionLoading={isActionLoading}
                  onApprove={() => void runAction(item.id, 'approve')}
                  onReject={() => void runAction(item.id, 'reject')}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
