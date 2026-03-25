'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { ClipboardList, Search, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type RequestType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_PAYMENT';

interface PendingRequest {
  id: string;
  type: RequestType;
  memberName: string;
  memberPhone: string;
  amount: number;
  requestDate: string;
  notes?: string;
}

export default function WorkerRequestsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<RequestType | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await apiGet<any>('/v1/dashboard/worker');
        const items = (data?.pendingRequests ?? []).map((r: any) => ({
          id: String(r.id),
          type: String(r.type).toUpperCase() as RequestType,
          memberName: r.member ?? '-',
          memberPhone: '-',
          amount: Number(r.amount ?? 0),
          requestDate: r.time ?? new Date().toISOString(),
        })) as PendingRequest[];
        setRequests(items.filter((r) => r.type !== 'LOAN_PAYMENT' || r.amount > 0));
      } catch {
        setRequests([]);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const filtered = useMemo(
    () => requests.filter((r) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = r.memberName.toLowerCase().includes(q) || r.memberPhone.includes(searchQuery);
      const matchesType = activeTab === 'ALL' || r.type === activeTab;
      return matchesSearch && matchesType;
    }),
    [requests, searchQuery, activeTab],
  );

  const countBy = {
    ALL: requests.length,
    DEPOSIT: requests.filter((r) => r.type === 'DEPOSIT').length,
    WITHDRAWAL: requests.filter((r) => r.type === 'WITHDRAWAL').length,
    LOAN_PAYMENT: requests.filter((r) => r.type === 'LOAN_PAYMENT').length,
  };

  const typeLabel = (type: RequestType) => {
    if (type === 'DEPOSIT') return locale === 'bn' ? 'জমা' : 'Deposit';
    if (type === 'WITHDRAWAL') return locale === 'bn' ? 'উত্তোলন' : 'Withdrawal';
    return locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">{locale === 'bn' ? 'অপেক্ষমান অনুরোধ' : 'Pending Requests'}</h1>
        <p className="text-muted-foreground">
          {locale === 'bn' ? 'সদস্যের অনুরোধগুলো শুধু দেখুন' : 'View member requests only'}
        </p>
      </div>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === 'bn' ? 'সদস্যের নাম দিয়ে খুঁজুন...' : 'Search by member name...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as RequestType | 'ALL')}>
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="ALL">{locale === 'bn' ? 'সব' : 'All'} ({countBy.ALL})</TabsTrigger>
          <TabsTrigger value="DEPOSIT">{locale === 'bn' ? 'জমা' : 'Deposits'} ({countBy.DEPOSIT})</TabsTrigger>
          <TabsTrigger value="WITHDRAWAL">{locale === 'bn' ? 'উত্তোলন' : 'Withdrawals'} ({countBy.WITHDRAWAL})</TabsTrigger>
          <TabsTrigger value="LOAN_PAYMENT">{locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payments'} ({countBy.LOAN_PAYMENT})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                {locale === 'bn' ? 'অনুরোধ তালিকা' : 'Request List'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn' ? `${filtered.length} টি অনুরোধ` : `${filtered.length} requests`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">{locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}</div>
              ) : (
                <div className="space-y-4">
                  {filtered.map((request) => (
                    <div key={request.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{request.memberName}</span>
                          <Badge variant="outline">{typeLabel(request.type)}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(request.requestDate).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-primary">{formatCurrency(request.amount, locale)}</span>
                        <Badge className="bg-slate-100 text-slate-700">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {locale === 'bn' ? 'শুধু দেখুন' : 'View only'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>{locale === 'bn' ? 'কোনো অপেক্ষমান অনুরোধ নেই' : 'No pending requests'}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
