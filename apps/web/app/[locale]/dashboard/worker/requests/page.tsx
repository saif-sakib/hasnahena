'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import {
  ClipboardList,
  Wallet,
  HandCoins,
  ArrowUpRight,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Search,
  Filter,
  Calendar,
  Phone,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type RequestType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_PAYMENT' | 'REGISTRATION';
type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface PendingRequest {
  id: string;
  type: RequestType;
  memberId: string;
  memberName: string;
  memberPhone: string;
  amount: number;
  requestDate: string;
  notes?: string;
  // For registration
  nidNumber?: string;
  address?: string;
  // For loan payment
  loanId?: string;
  installmentNumber?: number;
  totalInstallments?: number;
}

export default function WorkerRequestsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<RequestType | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<PendingRequest | null>(null);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [processAction, setProcessAction] = useState<'approve' | 'reject'>('approve');
  const [processNotes, setProcessNotes] = useState('');
  const [processAmount, setProcessAmount] = useState('');

  // Mock data
  const requests: PendingRequest[] = [
    {
      id: '1',
      type: 'DEPOSIT',
      memberId: 'm1',
      memberName: 'আব্দুল করিম',
      memberPhone: '01712345678',
      amount: 5000,
      requestDate: '2025-01-14T10:30:00',
      notes: 'মাসিক জমা',
    },
    {
      id: '2',
      type: 'DEPOSIT',
      memberId: 'm2',
      memberName: 'ফাতেমা বেগম',
      memberPhone: '01812345678',
      amount: 10000,
      requestDate: '2025-01-14T09:15:00',
    },
    {
      id: '3',
      type: 'WITHDRAWAL',
      memberId: 'm3',
      memberName: 'রহিম উদ্দিন',
      memberPhone: '01912345678',
      amount: 15000,
      requestDate: '2025-01-14T08:45:00',
      notes: 'জরুরি প্রয়োজন',
    },
    {
      id: '4',
      type: 'LOAN_PAYMENT',
      memberId: 'm4',
      memberName: 'সাদিয়া আক্তার',
      memberPhone: '01612345678',
      amount: 5000,
      requestDate: '2025-01-14T11:00:00',
      loanId: 'L001',
      installmentNumber: 5,
      totalInstallments: 20,
    },
    {
      id: '5',
      type: 'REGISTRATION',
      memberId: 'm5',
      memberName: 'নূর হোসেন',
      memberPhone: '01512345678',
      amount: 100,
      requestDate: '2025-01-14T07:30:00',
      nidNumber: '1234567890123',
      address: 'সিলেট',
      notes: 'প্রাথমিক জমা',
    },
    {
      id: '6',
      type: 'LOAN_PAYMENT',
      memberId: 'm6',
      memberName: 'জাকির হোসেন',
      memberPhone: '01412345678',
      amount: 4000,
      requestDate: '2025-01-14T10:00:00',
      loanId: 'L002',
      installmentNumber: 8,
      totalInstallments: 15,
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 60) {
      return locale === 'bn' ? `${diffMins} মিনিট আগে` : `${diffMins} mins ago`;
    } else if (diffHours < 24) {
      return locale === 'bn' ? `${diffHours} ঘণ্টা আগে` : `${diffHours} hours ago`;
    } else {
      return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB');
    }
  };

  const getTypeBadge = (type: RequestType) => {
    const config = {
      DEPOSIT: {
        label: locale === 'bn' ? 'জমা' : 'Deposit',
        color: 'bg-green-100 text-green-700',
        icon: Wallet,
      },
      WITHDRAWAL: {
        label: locale === 'bn' ? 'উত্তোলন' : 'Withdrawal',
        color: 'bg-purple-100 text-purple-700',
        icon: ArrowUpRight,
      },
      LOAN_PAYMENT: {
        label: locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payment',
        color: 'bg-blue-100 text-blue-700',
        icon: HandCoins,
      },
      REGISTRATION: {
        label: locale === 'bn' ? 'নিবন্ধন' : 'Registration',
        color: 'bg-amber-100 text-amber-700',
        icon: Users,
      },
    };

    const { label, color, icon: Icon } = config[type];
    return (
      <Badge className={`${color} hover:${color}`}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  };

  const filteredRequests = requests.filter((req) => {
    const matchesSearch =
      req.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.memberPhone.includes(searchQuery);
    const matchesType = activeTab === 'ALL' || req.type === activeTab;
    return matchesSearch && matchesType;
  });

  const requestCounts = {
    ALL: requests.length,
    DEPOSIT: requests.filter((r) => r.type === 'DEPOSIT').length,
    WITHDRAWAL: requests.filter((r) => r.type === 'WITHDRAWAL').length,
    LOAN_PAYMENT: requests.filter((r) => r.type === 'LOAN_PAYMENT').length,
    REGISTRATION: requests.filter((r) => r.type === 'REGISTRATION').length,
  };

  const handleProcess = (request: PendingRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setProcessAction(action);
    setProcessAmount(request.amount.toString());
    setProcessNotes('');
    setShowProcessModal(true);
  };

  const confirmProcess = () => {
    console.log('Processing:', {
      requestId: selectedRequest?.id,
      action: processAction,
      amount: processAmount,
      notes: processNotes,
    });
    setShowProcessModal(false);
    setSelectedRequest(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {locale === 'bn' ? 'অপেক্ষমান অনুরোধ' : 'Pending Requests'}
        </h1>
        <p className="text-muted-foreground">
          {locale === 'bn'
            ? 'শুধু সদস্য-উদ্যোগে করা অনুরোধগুলো রিভিউ করুন'
            : 'Review only member-initiated requests'}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { key: 'ALL', label: locale === 'bn' ? 'সব' : 'All', color: 'bg-slate-100 text-slate-700' },
          { key: 'DEPOSIT', label: locale === 'bn' ? 'জমা' : 'Deposits', color: 'bg-green-100 text-green-700' },
          { key: 'WITHDRAWAL', label: locale === 'bn' ? 'উত্তোলন' : 'Withdrawals', color: 'bg-purple-100 text-purple-700' },
          { key: 'LOAN_PAYMENT', label: locale === 'bn' ? 'ঋণ কিস্তি' : 'Loan Payments', color: 'bg-blue-100 text-blue-700' },
          { key: 'REGISTRATION', label: locale === 'bn' ? 'নিবন্ধন' : 'Registrations', color: 'bg-amber-100 text-amber-700' },
        ].map((item) => (
          <Card
            key={item.key}
            className={`cursor-pointer transition-all ${activeTab === item.key ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setActiveTab(item.key as RequestType | 'ALL')}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{item.label}</span>
                <Badge className={item.color}>
                  {requestCounts[item.key as keyof typeof requestCounts]}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === 'bn' ? 'সদস্যের নাম বা ফোন দিয়ে খুঁজুন...' : 'Search by member name or phone...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {locale === 'bn' ? 'অনুরোধ তালিকা' : 'Request List'}
          </CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? `${filteredRequests.length} টি অনুরোধ প্রক্রিয়াকরণের অপেক্ষায়`
              : `${filteredRequests.length} requests pending processing`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {request.memberName.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{request.memberName}</span>
                      {getTypeBadge(request.type)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p className="flex items-center gap-2">
                        <Phone className="h-3 w-3" /> {request.memberPhone}
                        <span className="mx-2">•</span>
                        <Clock className="h-3 w-3" /> {formatTime(request.requestDate)}
                      </p>
                      {request.type === 'LOAN_PAYMENT' && (
                        <p>
                          {locale === 'bn' ? 'কিস্তি:' : 'Installment:'} {request.installmentNumber}/{request.totalInstallments}
                        </p>
                      )}
                      {request.type === 'REGISTRATION' && (
                        <p>NID: {request.nidNumber} • {request.address}</p>
                      )}
                      {request.notes && (
                        <p className="text-xs italic">{request.notes}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xl font-bold text-primary">
                      {formatCurrency(request.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {request.type === 'DEPOSIT'
                        ? locale === 'bn'
                          ? 'জমা পরিমাণ'
                          : 'Deposit Amount'
                        : request.type === 'WITHDRAWAL'
                          ? locale === 'bn'
                            ? 'উত্তোলন পরিমাণ'
                            : 'Withdrawal Amount'
                          : request.type === 'LOAN_PAYMENT'
                            ? locale === 'bn'
                              ? 'কিস্তি পরিমাণ'
                              : 'Installment Amount'
                            : locale === 'bn'
                              ? 'প্রাথমিক জমা'
                              : 'Initial Deposit'}
                    </p>
                  </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleProcess(request, 'reject')}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleProcess(request, 'approve')}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        {locale === 'bn' ? 'রিভিউ' : 'Review'}
                      </Button>
                    </div>
                </div>
              </div>
            ))}

            {filteredRequests.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50 text-green-500" />
                <p>{locale === 'bn' ? 'কোনো অপেক্ষমান অনুরোধ নেই' : 'No pending requests'}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Process Modal */}
      <Dialog open={showProcessModal} onOpenChange={setShowProcessModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {processAction === 'approve'
                ? locale === 'bn'
                  ? 'অনুরোধ প্রসেস করুন'
                  : 'Process Request'
                : locale === 'bn'
                  ? 'অনুরোধ প্রত্যাখ্যান করুন'
                  : 'Reject Request'}
            </DialogTitle>
            <DialogDescription>
              {selectedRequest?.memberName} - {getTypeBadge(selectedRequest?.type || 'DEPOSIT')}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{locale === 'bn' ? 'অনুরোধিত পরিমাণ' : 'Requested Amount'}</span>
                  <span className="text-xl font-bold">{formatCurrency(selectedRequest.amount)}</span>
                </div>
              </div>

              {processAction === 'approve' && selectedRequest.type !== 'REGISTRATION' && (
                <div>
                  <Label>{locale === 'bn' ? 'প্রকৃত পরিমাণ' : 'Actual Amount'}</Label>
                  <Input
                    type="number"
                    value={processAmount}
                    onChange={(e) => setProcessAmount(e.target.value)}
                    className="mt-1"
                  />
                  {processAmount !== selectedRequest.amount.toString() && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {locale === 'bn'
                        ? 'পরিমাণ অনুরোধের চেয়ে ভিন্ন'
                        : 'Amount differs from request'}
                    </p>
                  )}
                </div>
              )}

              <div>
                <Label>
                  {processAction === 'reject'
                    ? locale === 'bn'
                      ? 'প্রত্যাখ্যানের কারণ *'
                      : 'Rejection Reason *'
                    : locale === 'bn'
                      ? 'নোট (ঐচ্ছিক)'
                      : 'Notes (optional)'}
                </Label>
                <Textarea
                  value={processNotes}
                  onChange={(e) => setProcessNotes(e.target.value)}
                  placeholder={
                    processAction === 'reject'
                      ? locale === 'bn'
                        ? 'প্রত্যাখ্যানের কারণ লিখুন...'
                        : 'Enter rejection reason...'
                      : locale === 'bn'
                        ? 'অতিরিক্ত নোট...'
                        : 'Additional notes...'
                  }
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProcessModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              onClick={confirmProcess}
              variant={processAction === 'reject' ? 'destructive' : 'default'}
              disabled={processAction === 'reject' && !processNotes.trim()}
            >
              {processAction === 'approve'
                ? locale === 'bn'
                  ? 'নিশ্চিত করুন'
                  : 'Confirm'
                : locale === 'bn'
                  ? 'প্রত্যাখ্যান করুন'
                  : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
