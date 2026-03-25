'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Users, HandCoins, Wallet, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

type TabKey = 'registrations' | 'loans' | 'withdrawals';

interface RegistrationRequest {
  id: string;
  name: string;
  nameBn?: string;
  phone: string;
  nidNumber?: string;
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

interface AdminTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  status: string;
  member: { name: string; memberId?: string | null };
  processedDate: string;
}

export default function AdminApprovalsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('registrations');
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([]);
  const [loanApprovals, setLoanApprovals] = useState<AdminLoan[]>([]);
  const [withdrawalApprovals, setWithdrawalApprovals] = useState<AdminTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);

  const loadAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [approvalsData, loanData, depositData] = await Promise.all([
        apiGet<{
          registrationRequests: RegistrationRequest[];
          loanRequests: Array<{
            id: string;
            requestedAmount: number;
            purpose: string;
            memberName: string;
            memberId?: string;
            guarantorName?: string;
          }>;
          withdrawalRequests: AdminTransaction[];
        }>('/v1/dashboard/admin/approvals'),
        apiGet<AdminLoan[]>('/v1/dashboard/admin/loans'),
        apiGet<any>('/v1/dashboard/admin/deposits'),
      ]);

      setRegistrations(approvalsData.registrationRequests ?? []);
      setLoanApprovals(
        (loanData ?? []).filter((l) => l.status === 'PENDING_APPROVAL').map((l) => ({
          ...l,
          amount: l.amount ?? (l as any).requestedAmount ?? 0,
        })),
      );
      setWithdrawalApprovals(
        ((depositData?.deposits ?? depositData ?? []) as AdminTransaction[]).filter(
          (t) => t.type === 'WITHDRAWAL' && t.status === 'PENDING',
        ),
      );
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load approvals');
      setRegistrations([]);
      setLoanApprovals([]);
      setWithdrawalApprovals([]);
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
      withdrawals: withdrawalApprovals.length,
    }),
    [registrations.length, loanApprovals.length, withdrawalApprovals.length],
  );

  const runAction = async (kind: 'registration' | 'loan' | 'withdrawal', id: string, action: 'approve' | 'reject') => {
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
      } else if (action === 'approve') {
        await apiPost('/v1/dashboard/admin/approvals/withdrawal', { requestId: id });
      } else {
        await apiPost('/v1/dashboard/admin/approvals/withdrawal/reject', { requestId: id, reason: '' });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{locale === 'bn' ? 'অনুমোদন' : 'Approvals'}</h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'নিবন্ধন, ঋণ এবং উত্তোলন অনুরোধ অনুমোদন করুন'
              : 'Approve registration, loan, and withdrawal requests'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={isLoading || isActionLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${(isLoading || isActionLoading) ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নিবন্ধন' : 'Registrations'}</p><p className="text-2xl font-bold">{counts.registrations}</p></div><Users className="h-8 w-8 text-amber-600" /></CardContent></Card>
        <Card><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{locale === 'bn' ? 'ঋণ' : 'Loans'}</p><p className="text-2xl font-bold">{counts.loans}</p></div><HandCoins className="h-8 w-8 text-blue-600" /></CardContent></Card>
        <Card><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'}</p><p className="text-2xl font-bold">{counts.withdrawals}</p></div><Wallet className="h-8 w-8 text-purple-600" /></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="registrations">{locale === 'bn' ? 'নিবন্ধন' : 'Registrations'}</TabsTrigger>
          <TabsTrigger value="loans">{locale === 'bn' ? 'ঋণ' : 'Loans'}</TabsTrigger>
          <TabsTrigger value="withdrawals">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'}</TabsTrigger>
        </TabsList>

        <TabsContent value="registrations">
          <Card>
            <CardHeader><CardTitle>{locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}</CardTitle><CardDescription>{counts.registrations}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : registrations.map((r) => (
                <div key={r.id} className="rounded-xl bg-slate-50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.name} {r.nameBn ? `(${r.nameBn})` : ''}</p>
                    <p className="text-sm text-muted-foreground">{r.phone} • {r.nidNumber ?? '-'} • {new Date(r.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={() => void runAction('registration', r.id, 'reject')}><XCircle className="h-4 w-4 mr-1" />{locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}</Button>
                    <Button size="sm" disabled={isActionLoading} onClick={() => void runAction('registration', r.id, 'approve')}><CheckCircle2 className="h-4 w-4 mr-1" />{locale === 'bn' ? 'অনুমোদন' : 'Approve'}</Button>
                  </div>
                </div>
              ))}
              {!isLoading && registrations.length === 0 && <div className="py-10 text-center text-muted-foreground">{locale === 'bn' ? 'কোনো অপেক্ষমাণ নিবন্ধন নেই' : 'No pending registrations'}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans">
          <Card>
            <CardHeader><CardTitle>{locale === 'bn' ? 'ঋণ অনুমোদন' : 'Loan Approvals'}</CardTitle><CardDescription>{counts.loans}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : loanApprovals.map((l) => (
                <div key={l.id} className="rounded-xl bg-slate-50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{l.member.name} {l.member.memberId ? <Badge variant="outline" className="ml-1">{l.member.memberId}</Badge> : null}</p>
                    <p className="text-sm text-muted-foreground">{l.loanNumber} • {formatCurrency(l.amount)} • {l.guarantor?.name ?? '-'} • {l.purpose || '-'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={() => void runAction('loan', l.id, 'reject')}><XCircle className="h-4 w-4 mr-1" />{locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}</Button>
                    <Button size="sm" disabled={isActionLoading} onClick={() => void runAction('loan', l.id, 'approve')}><CheckCircle2 className="h-4 w-4 mr-1" />{locale === 'bn' ? 'অনুমোদন' : 'Approve'}</Button>
                  </div>
                </div>
              ))}
              {!isLoading && loanApprovals.length === 0 && <div className="py-10 text-center text-muted-foreground">{locale === 'bn' ? 'কোনো অপেক্ষমাণ ঋণ অনুরোধ নেই' : 'No pending loan approvals'}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="withdrawals">
          <Card>
            <CardHeader><CardTitle>{locale === 'bn' ? 'উত্তোলন অনুমোদন' : 'Withdrawal Approvals'}</CardTitle><CardDescription>{counts.withdrawals}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : withdrawalApprovals.map((w) => (
                <div key={w.id} className="rounded-xl bg-slate-50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{w.member.name} {w.member.memberId ? <Badge variant="outline" className="ml-1">{w.member.memberId}</Badge> : null}</p>
                    <p className="text-sm text-muted-foreground">{formatCurrency(w.amount)} • {new Date(w.processedDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')} • <Clock className="inline h-3 w-3" /> Pending</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={isActionLoading} onClick={() => void runAction('withdrawal', w.id, 'reject')}><XCircle className="h-4 w-4 mr-1" />{locale === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}</Button>
                    <Button size="sm" disabled={isActionLoading} onClick={() => void runAction('withdrawal', w.id, 'approve')}><CheckCircle2 className="h-4 w-4 mr-1" />{locale === 'bn' ? 'অনুমোদন' : 'Approve'}</Button>
                  </div>
                </div>
              ))}
              {!isLoading && withdrawalApprovals.length === 0 && <div className="py-10 text-center text-muted-foreground">{locale === 'bn' ? 'কোনো অপেক্ষমাণ উত্তোলন অনুরোধ নেই' : 'No pending withdrawal requests'}</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
