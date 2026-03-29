'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  ArrowUpRight,
  Download,
  Info,
  MessageCircle,
  Printer,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { generateStatementHTML, openPrintWindow, generateReceiptHTML } from '@/lib/documents/receipt-generator';

type DepositStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';

interface Deposit {
  id: string;
  amount: number;
  date: string;
  receiptNumber: string;
  status: DepositStatus;
  processedBy?: string;
  balanceAfter?: number;
}

interface MemberProfile {
  name?: string;
  userId?: string;
  phone?: string;
  accountSummary?: {
    currentBalance?: number;
  };
}

export default function DepositsPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = localStorage.getItem('hn_access_token');
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const [depositsData, profileData] = await Promise.all([
        apiGet<{
          deposits: Deposit[];
          currentBalance: number;
        }>('/v1/dashboard/member/deposits'),
        apiGet<MemberProfile>('/v1/dashboard/member/profile'),
      ]);
      setDeposits(depositsData?.deposits ?? []);
      setMemberProfile(profileData);
      setCurrentBalance(profileData?.accountSummary?.currentBalance ?? depositsData?.currentBalance ?? 0);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const totalDeposited = deposits.reduce((sum, d) => sum + d.amount, 0);


  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Download deposit statement
  const handleDownloadStatement = () => {
    if (!memberProfile || deposits.length === 0) return;

    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    const statementHtml = generateStatementHTML({
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      periodStart: oneYearAgo.toISOString(),
      periodEnd: now.toISOString(),
      openingBalance: 0,
      closingBalance: currentBalance * 100, // Convert to paisa for display formatting
      totalDeposits: totalDeposited * 100,
      totalWithdrawals: 0,
      transactions: deposits.map(d => ({
        date: d.date,
        type: 'DEPOSIT',
        amount: d.amount * 100, // Convert to paisa
        balance: (d.balanceAfter || 0) * 100,
        description: locale === 'bn' ? 'আমানত' : 'Deposit',
        receiptNumber: d.receiptNumber,
      })),
    }, locale);
    
    openPrintWindow(statementHtml, locale === 'bn' ? 'আমানত বিবরণী' : 'Deposit Statement');
  };

  // Print individual receipt
  const handlePrintReceipt = (deposit: Deposit) => {
    if (!memberProfile) return;
    
    const receiptHtml = generateReceiptHTML({
      receiptNumber: deposit.receiptNumber,
      type: 'DEPOSIT',
      amount: deposit.amount * 100, // Convert to paisa
      date: deposit.date,
      memberName: memberProfile.name || 'N/A',
      memberId: memberProfile.userId?.slice(0, 8).toUpperCase() || 'N/A',
      memberPhone: memberProfile.phone || 'N/A',
      balanceAfter: (deposit.balanceAfter || 0) * 100,
      processedBy: deposit.processedBy,
    }, locale);
    
    openPrintWindow(receiptHtml, locale === 'bn' ? 'রসিদ' : 'Receipt');
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {t('myDeposits')}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'আপনার আমানতের ইতিহাস ও ব্যালেন্স দেখুন'
              : 'View your deposit history and balance'}
          </p>
        </div>
      </div>

      {/* Info Notice */}
      <Card className="rounded-2xl border-blue-200 bg-blue-50/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-blue-800 font-medium">
                {locale === 'bn'
                  ? 'আমানত জমা দিতে চাইলে অফিসে যোগাযোগ করুন অথবা কাস্টমার সাপোর্টে মেসেজ করুন।'
                  : 'To make a deposit, please visit the office or contact customer support.'}
              </p>
              <Link href={`/${locale}/dashboard/member/support`}>
                <Button variant="link" className="h-auto p-0 mt-2 text-blue-700 hover:text-blue-900 gap-1">
                  <MessageCircle className="h-4 w-4" />
                  {locale === 'bn' ? 'সাপোর্টে যোগাযোগ করুন' : 'Contact Support'}
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('totalDeposited')}</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposited, locale)}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'মোট আমানত' : 'Total deposits'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('currentBalance')}</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(currentBalance, locale)}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'bn' ? 'সঞ্চয় স্থিতি' : 'Savings balance'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Deposits List */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{t('depositHistory')}</CardTitle>
          <CardDescription>
            {locale === 'bn'
              ? 'আপনার সকল আমানত লেনদেন'
              : 'All your deposit transactions'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
              </div>
            ) : deposits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {locale === 'bn' ? 'কোন আমানত পাওয়া যায়নি' : 'No deposits found'}
              </div>
            ) : (
              deposits.map((deposit) => {
                return (
                  <div
                    key={deposit.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                        <ArrowUpRight className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-lg">
                          {formatCurrency(deposit.amount, locale)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {deposit.receiptNumber} • {formatDate(deposit.date)}
                        </p>
                        {deposit.balanceAfter !== undefined && (
                          <p className="text-xs text-muted-foreground">
                            {locale === 'bn' ? 'ব্যালেন্স:' : 'Balance:'} {formatCurrency(deposit.balanceAfter, locale)}
                          </p>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePrintReceipt(deposit)}
                      className="gap-1"
                    >
                      <Printer className="h-4 w-4" />
                      {locale === 'bn' ? 'রসিদ' : 'Receipt'}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Download Statement */}
      <div className="flex justify-end">
        <Button 
          variant="outline" 
          className="gap-2"
          onClick={handleDownloadStatement}
          disabled={deposits.length === 0}
        >
          <Download className="h-4 w-4" />
          {t('downloadStatement')}
        </Button>
      </div>
    </div>
  );
}
