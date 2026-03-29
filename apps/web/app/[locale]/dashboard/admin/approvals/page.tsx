'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Users, CheckCircle2, XCircle, ChevronUp, Eye } from 'lucide-react';
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

function RegistrationCard({
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
    return [addr.houseNo, addr.roadNo, addr.village, addr.union, addr.policeStation, addr.district]
      .filter(Boolean)
      .join(', ') || '-';
  };

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
            {item.name.charAt(0)}
          </div>
          <div>
            <p className="font-semibold">
              {item.name} {item.nameBn ? `(${item.nameBn})` : ''}
            </p>
            <p className="text-sm text-muted-foreground">{item.phone} • {item.email || '-'}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(item.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
            </p>
          </div>
        </div>

        <Button size="sm" variant="ghost" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span className="ml-1">{expanded ? (locale === 'bn' ? 'সংক্ষিপ্ত' : 'Less') : (locale === 'bn' ? 'বিস্তারিত' : 'Details')}</span>
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t space-y-4">
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <p><span className="text-muted-foreground">NID:</span> {item.nidNumber || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'পিতা:' : 'Father:'}</span> {item.fatherName || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'মাতা:' : 'Mother:'}</span> {item.motherName || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'লিঙ্গ:' : 'Gender:'}</span> {item.gender || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'বৈবাহিক:' : 'Marital:'}</span> {item.maritalStatus || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'সন্তান:' : 'Children:'}</span> {item.childrenCount ?? 0}</p>
          </div>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="p-3 bg-white rounded-lg">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}</p>
              <p>{formatAddress(item.permanentAddress)}</p>
            </div>
            <div className="p-3 bg-white rounded-lg">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'বর্তমান ঠিকানা' : 'Present Address'}</p>
              <p>{formatAddress(item.presentAddress)}</p>
            </div>
          </div>

          {item.nominee && (
            <div className="p-3 bg-white rounded-lg text-sm">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'নমিনী' : 'Nominee'}</p>
              <p>{[item.nominee.name, item.nominee.relationship, item.nominee.nidNumber, item.nominee.phone].filter(Boolean).join(' • ') || '-'}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-4 pt-4 border-t sm:flex-row">
        <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={onReject}>
          <XCircle className="h-4 w-4 mr-1" />
          {locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
        </Button>
        <Button size="sm" disabled={isActionLoading} onClick={onApprove}>
          <CheckCircle2 className="h-4 w-4 mr-1" />
          {locale === 'bn' ? 'অনুমোদন' : 'Approve'}
        </Button>
      </div>
    </div>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{locale === 'bn' ? 'নিবন্ধন অনুমোদন' : 'Registration Approvals'}</h1>
          <p className="text-muted-foreground">
            {locale === 'bn' ? 'শুধু সদস্য নিবন্ধন অনুরোধ এখানে ব্যবস্থাপনা করুন' : 'Manage member registration requests here'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadRegistrations()} disabled={isLoading || isActionLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${(isLoading || isActionLoading) ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <CardContent className="p-4 flex justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অপেক্ষমাণ নিবন্ধন' : 'Pending Registrations'}</p>
            <p className="text-2xl font-bold">{pendingCount}</p>
          </div>
          <Users className="h-8 w-8 text-amber-600" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}</CardTitle>
          <CardDescription>{locale === 'bn' ? `${pendingCount} টি অপেক্ষমাণ` : `${pendingCount} pending`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : registrations.map((item) => (
            <RegistrationCard
              key={item.id}
              item={item}
              locale={locale}
              isActionLoading={isActionLoading}
              onApprove={() => void runAction(item.id, 'approve')}
              onReject={() => void runAction(item.id, 'reject')}
            />
          ))}

          {!isLoading && registrations.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{locale === 'bn' ? 'কোনো অপেক্ষমাণ নিবন্ধন নেই' : 'No pending registrations'}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
