'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Users, HandCoins, CheckCircle2, XCircle, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type TabKey = 'registrations' | 'loans';

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

interface AdminLoan {
  id: string;
  loanNumber: string;
  status: string;
  amount: number;
  purpose: string;
  member: { name: string; memberId?: string | null };
  guarantor?: { name: string } | null;
}

function RegistrationCard({
  r,
  locale,
  isActionLoading,
  onApprove,
  onReject,
}: {
  r: RegistrationRequest;
  locale: string;
  isActionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const formatAddress = (addr: any) => {
    if (!addr) return '-';
    return [addr.houseNo, addr.roadNo, addr.village, addr.union, addr.policeStation, addr.district]
      .filter(Boolean).join(', ') || '-';
  };

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      {/* Basic Info - Always Visible */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
            {r.name.charAt(0)}
          </div>
          <div>
            <p className="font-semibold">{r.name} {r.nameBn ? `(${r.nameBn})` : ''}</p>
            <p className="text-sm text-muted-foreground">{r.phone} • {r.email || '-'}</p>
            <p className="text-xs text-muted-foreground">{new Date(r.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="ml-1">{expanded ? (locale === 'bn' ? 'সংক্ষিপ্ত' : 'Less') : (locale === 'bn' ? 'বিস্তারিত' : 'Details')}</span>
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t space-y-4">
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'NID:' : 'NID:'}</span> {r.nidNumber || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'পিতা:' : 'Father:'}</span> {r.fatherName || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'মাতা:' : 'Mother:'}</span> {r.motherName || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'লিঙ্গ:' : 'Gender:'}</span> {r.gender || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'বৈবাহিক:' : 'Marital:'}</span> {r.maritalStatus || '-'}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'সন্তান:' : 'Children:'}</span> {r.childrenCount ?? 0}</p>
            <p><span className="text-muted-foreground">{locale === 'bn' ? 'জন্ম:' : 'DOB:'}</span> {r.dateOfBirth ? new Date(r.dateOfBirth).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB') : '-'}</p>
          </div>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="p-3 bg-white rounded-lg">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}</p>
              <p>{formatAddress(r.permanentAddress)}</p>
            </div>
            <div className="p-3 bg-white rounded-lg">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'বর্তমান ঠিকানা' : 'Present Address'}</p>
              <p>{formatAddress(r.presentAddress)}</p>
            </div>
          </div>

          {r.nominee && (
            <div className="p-3 bg-white rounded-lg text-sm">
              <p className="font-medium text-muted-foreground mb-1">{locale === 'bn' ? 'নমিনী' : 'Nominee'}</p>
              <p>{[r.nominee.name, r.nominee.relationship, r.nominee.nidNumber, r.nominee.phone].filter(Boolean).join(' • ') || '-'}</p>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t">
        <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={onReject}>
          <XCircle className="h-4 w-4 mr-1" />{locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
        </Button>
        <Button size="sm" disabled={isActionLoading} onClick={onApprove}>
          <CheckCircle2 className="h-4 w-4 mr-1" />{locale === 'bn' ? 'অনুমোদন' : 'Approve'}
        </Button>
      </div>
    </div>
  );
}

export default function AdminApprovalsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('registrations');
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([]);
  const [loanApprovals, setLoanApprovals] = useState<AdminLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [approvalsData, loanData] = await Promise.all([
        apiGet<{
          registrationRequests: RegistrationRequest[];
        }>('/v1/dashboard/admin/approvals'),
        apiGet<AdminLoan[]>('/v1/dashboard/admin/loans'),
      ]);

      setRegistrations(approvalsData.registrationRequests ?? []);
      setLoanApprovals(
        (loanData ?? []).filter((l) => l.status === 'PENDING_APPROVAL').map((l) => ({
          ...l,
          amount: l.amount ?? (l as any).requestedAmount ?? 0,
        })),
      );
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load approvals');
      setRegistrations([]);
      setLoanApprovals([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const counts = useMemo(
    () => ({
      registrations: registrations.length,
      loans: loanApprovals.length,
    }),
    [registrations.length, loanApprovals.length],
  );

  const runAction = async (kind: 'registration' | 'loan', id: string, action: 'approve' | 'reject') => {
    setIsActionLoading(true);
    setError(null);
    try {
      if (kind === 'registration') {
        if (action === 'approve') {
          const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
          const response = await fetch('/api/v1/admin/approvals/registration', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ userId: id, locale }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || 'Failed to approve registration');
          }
        } else {
          await apiPost('/v1/dashboard/admin/approvals/registration/reject', { userId: id, reason: '' });
        }
      } else if (kind === 'loan') {
        if (action === 'approve') {
          await apiPost('/v1/dashboard/admin/approvals/loan', { loanId: id });
        } else {
          await apiPost('/v1/dashboard/admin/approvals/loan/reject', { loanId: id, reason: '' });
        }
      }
      await loadAll();
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
          <h1 className="text-2xl md:text-3xl font-bold">{locale === 'bn' ? 'অনুমোদন' : 'Approvals'}</h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'নিবন্ধন এবং ঋণ অনুরোধ অনুমোদন করুন'
              : 'Approve registration and loan requests'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={isLoading || isActionLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${(isLoading || isActionLoading) ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নিবন্ধন' : 'Registrations'}</p><p className="text-2xl font-bold">{counts.registrations}</p></div><Users className="h-8 w-8 text-amber-600" /></CardContent></Card>
        <Card><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ঋণ' : 'Loans'}</p><p className="text-2xl font-bold">{counts.loans}</p></div><HandCoins className="h-8 w-8 text-blue-600" /></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="registrations">{locale === 'bn' ? 'নিবন্ধন' : 'Registrations'} ({counts.registrations})</TabsTrigger>
          <TabsTrigger value="loans">{locale === 'bn' ? 'ঋণ' : 'Loans'} ({counts.loans})</TabsTrigger>
        </TabsList>

        <TabsContent value="registrations">
          <Card>
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}</CardTitle>
              <CardDescription>{locale === 'bn' ? `${counts.registrations} টি অপেক্ষমাণ` : `${counts.registrations} pending`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : registrations.map((r) => (
                <RegistrationCard
                  key={r.id}
                  r={r}
                  locale={locale}
                  isActionLoading={isActionLoading}
                  onApprove={() => void runAction('registration', r.id, 'approve')}
                  onReject={() => void runAction('registration', r.id, 'reject')}
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
        </TabsContent>

        <TabsContent value="loans">
          <Card>
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'ঋণ অনুমোদন' : 'Loan Approvals'}</CardTitle>
              <CardDescription>{locale === 'bn' ? `${counts.loans} টি অপেক্ষমাণ` : `${counts.loans} pending`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : loanApprovals.map((l) => (
                <div key={l.id} className="rounded-xl bg-slate-50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{l.member.name} {l.member.memberId ? <Badge variant="outline" className="ml-1">{l.member.memberId}</Badge> : null}</p>
                    <p className="text-sm text-muted-foreground">{l.loanNumber} • {formatCurrency(l.amount, locale)} • {l.guarantor?.name ?? '-'} • {l.purpose || '-'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={() => void runAction('loan', l.id, 'reject')}><XCircle className="h-4 w-4 mr-1" />{locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}</Button>
                    <Button size="sm" disabled={isActionLoading} onClick={() => void runAction('loan', l.id, 'approve')}><CheckCircle2 className="h-4 w-4 mr-1" />{locale === 'bn' ? 'অনুমোদন' : 'Approve'}</Button>
                  </div>
                </div>
              ))}
              {!isLoading && loanApprovals.length === 0 && (
                <div className="py-10 text-center text-muted-foreground">
                  <HandCoins className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{locale === 'bn' ? 'কোনো অপেক্ষমাণ ঋণ অনুরোধ নেই' : 'No pending loan approvals'}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
