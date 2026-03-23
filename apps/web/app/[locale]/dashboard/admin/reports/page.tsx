'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  FileText,
  Download,
  Calendar,
  Filter,
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  HandCoins,
  PieChart,
  BarChart3,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ReportType = 'financial' | 'members' | 'loans' | 'donations';
type Period = 'month' | 'quarter' | 'year' | 'all';

interface ReportSummary {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
}

export default function AdminReportsPage() {
  const locale = useLocale();
  const [activeReport, setActiveReport] = useState<ReportType>('financial');
  const [period, setPeriod] = useState<Period>('month');

  // Mock data
  const financialSummary: ReportSummary[] = [
    {
      title: locale === 'bn' ? 'মোট আমানত' : 'Total Deposits',
      value: '৳ 25,00,000',
      change: 12.5,
      changeLabel: locale === 'bn' ? 'গত মাসের তুলনায়' : 'vs last month',
    },
    {
      title: locale === 'bn' ? 'মোট ঋণ বিতরণ' : 'Total Loans Disbursed',
      value: '৳ 18,00,000',
      change: 8.3,
      changeLabel: locale === 'bn' ? 'গত মাসের তুলনায়' : 'vs last month',
    },
    {
      title: locale === 'bn' ? 'পুনরুদ্ধার পরিমাণ' : 'Amount Recovered',
      value: '৳ 5,50,000',
      change: 15.2,
      changeLabel: locale === 'bn' ? 'গত মাসের তুলনায়' : 'vs last month',
    },
    {
      title: locale === 'bn' ? 'দান তহবিল' : 'Donation Funds',
      value: '৳ 12,75,000',
      change: 5.8,
      changeLabel: locale === 'bn' ? 'গত মাসের তুলনায়' : 'vs last month',
    },
  ];

  const memberStats = {
    totalMembers: 125,
    newThisMonth: 8,
    activeMembers: 118,
    pendingApprovals: 3,
  };

  const loanStats = {
    activeLoans: 45,
    completedThisMonth: 5,
    newApplications: 12,
    defaultedLoans: 2,
    recoveryRate: 98.5,
  };

  const donationStats = {
    totalReceived: 500000,
    totalDisbursed: 350000,
    zakatFund: 150000,
    sadaqahFund: 75000,
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const monthlyData = [
    { month: locale === 'bn' ? 'জানু' : 'Jan', deposits: 150000, loans: 120000, recovery: 45000 },
    { month: locale === 'bn' ? 'ফেব্রু' : 'Feb', deposits: 180000, loans: 150000, recovery: 52000 },
    { month: locale === 'bn' ? 'মার্চ' : 'Mar', deposits: 200000, loans: 180000, recovery: 58000 },
    { month: locale === 'bn' ? 'এপ্রি' : 'Apr', deposits: 175000, loans: 140000, recovery: 48000 },
    { month: locale === 'bn' ? 'মে' : 'May', deposits: 220000, loans: 200000, recovery: 65000 },
    { month: locale === 'bn' ? 'জুন' : 'Jun', deposits: 250000, loans: 180000, recovery: 55000 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'রিপোর্ট ও বিশ্লেষণ' : 'Reports & Analytics'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'প্রতিষ্ঠানের সম্পূর্ণ আর্থিক বিশ্লেষণ'
              : 'Complete financial analysis of the organization'}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
            <SelectTrigger className="w-40">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">{locale === 'bn' ? 'এই মাস' : 'This Month'}</SelectItem>
              <SelectItem value="quarter">{locale === 'bn' ? 'এই কোয়ার্টার' : 'This Quarter'}</SelectItem>
              <SelectItem value="year">{locale === 'bn' ? 'এই বছর' : 'This Year'}</SelectItem>
              <SelectItem value="all">{locale === 'bn' ? 'সর্বকালীন' : 'All Time'}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
          </Button>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'এক্সপোর্ট' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Report Type Tabs */}
      <Tabs value={activeReport} onValueChange={(v) => setActiveReport(v as ReportType)}>
        <TabsList className="grid grid-cols-4 w-full md:w-auto">
          <TabsTrigger value="financial" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'আর্থিক' : 'Financial'}</span>
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'সদস্য' : 'Members'}</span>
          </TabsTrigger>
          <TabsTrigger value="loans" className="gap-2">
            <HandCoins className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ঋণ' : 'Loans'}</span>
          </TabsTrigger>
          <TabsTrigger value="donations" className="gap-2">
            <PieChart className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'দান' : 'Donations'}</span>
          </TabsTrigger>
        </TabsList>

        {/* Financial Report */}
        <TabsContent value="financial" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {financialSummary.map((item, index) => (
              <Card key={index} className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{item.title}</p>
                  <p className="text-2xl font-bold mt-1">{item.value}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {item.change > 0 ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <span className={`text-sm ${item.change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.change > 0 ? '+' : ''}
                      {item.change}%
                    </span>
                    <span className="text-xs text-muted-foreground">{item.changeLabel}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Monthly Trend */}
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'মাসিক প্রবণতা' : 'Monthly Trend'}</CardTitle>
              <CardDescription>
                {locale === 'bn' ? 'জমা, ঋণ বিতরণ ও পুনরুদ্ধারের প্রবণতা' : 'Deposits, loans, and recovery trends'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Simple bar representation */}
                {monthlyData.map((data, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{data.month}</span>
                      <span className="text-muted-foreground">
                        {locale === 'bn' ? 'জমা' : 'Deposits'}: {formatCurrency(data.deposits)}
                      </span>
                    </div>
                    <div className="flex gap-1 h-6">
                      <div
                        className="bg-green-500 rounded-l"
                        style={{ width: `${(data.deposits / 250000) * 100}%` }}
                        title={`Deposits: ${formatCurrency(data.deposits)}`}
                      />
                      <div
                        className="bg-blue-500"
                        style={{ width: `${(data.loans / 250000) * 100}%` }}
                        title={`Loans: ${formatCurrency(data.loans)}`}
                      />
                      <div
                        className="bg-amber-500 rounded-r"
                        style={{ width: `${(data.recovery / 250000) * 100}%` }}
                        title={`Recovery: ${formatCurrency(data.recovery)}`}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-sm mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded" />
                    <span>{locale === 'bn' ? 'জমা' : 'Deposits'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded" />
                    <span>{locale === 'bn' ? 'ঋণ' : 'Loans'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-amber-500 rounded" />
                    <span>{locale === 'bn' ? 'পুনরুদ্ধার' : 'Recovery'}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members Report */}
        <TabsContent value="members" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট সদস্য' : 'Total Members'}</p>
                    <p className="text-3xl font-bold">{memberStats.totalMembers}</p>
                  </div>
                  <Users className="h-10 w-10 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'এই মাসে নতুন' : 'New This Month'}</p>
                    <p className="text-3xl font-bold text-green-600">+{memberStats.newThisMonth}</p>
                  </div>
                  <TrendingUp className="h-10 w-10 text-green-600" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় সদস্য' : 'Active Members'}</p>
                    <p className="text-3xl font-bold">{memberStats.activeMembers}</p>
                  </div>
                  <Badge className="bg-green-100 text-green-700">
                    {((memberStats.activeMembers / memberStats.totalMembers) * 100).toFixed(0)}%
                  </Badge>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'অপেক্ষমাণ অনুমোদন' : 'Pending Approvals'}</p>
                    <p className="text-3xl font-bold text-amber-600">{memberStats.pendingApprovals}</p>
                  </div>
                  <Button size="sm" variant="outline">
                    {locale === 'bn' ? 'দেখুন' : 'View'}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'সদস্য বৃদ্ধি' : 'Member Growth'}</CardTitle>
              <CardDescription>
                {locale === 'bn' ? 'মাসিক সদস্য যোগদানের ইতিহাস' : 'Monthly member registration history'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-48 flex items-center justify-center rounded-xl bg-slate-50">
                <div className="text-center text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-2" />
                  <p>{locale === 'bn' ? 'চার্ট শীঘ্রই আসছে' : 'Chart coming soon'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Loans Report */}
        <TabsContent value="loans" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সক্রিয় ঋণ' : 'Active Loans'}</p>
                <p className="text-3xl font-bold">{loanStats.activeLoans}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'এই মাসে সম্পন্ন' : 'Completed This Month'}</p>
                <p className="text-3xl font-bold text-green-600">{loanStats.completedThisMonth}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'নতুন আবেদন' : 'New Applications'}</p>
                <p className="text-3xl font-bold text-blue-600">{loanStats.newApplications}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'খেলাপি' : 'Defaulted'}</p>
                <p className="text-3xl font-bold text-red-600">{loanStats.defaultedLoans}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'পুনরুদ্ধার হার' : 'Recovery Rate'}</p>
                <p className="text-3xl font-bold text-green-600">{loanStats.recoveryRate}%</p>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'ঋণ পোর্টফোলিও বিশ্লেষণ' : 'Loan Portfolio Analysis'}</CardTitle>
              <CardDescription>
                {locale === 'bn' ? 'ঋণ বিতরণ ও পুনরুদ্ধারের বিশ্লেষণ' : 'Loan disbursement and recovery analysis'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 bg-blue-50 rounded-xl">
                  <h4 className="font-medium mb-2">{locale === 'bn' ? 'উদ্দেশ্য অনুযায়ী ঋণ' : 'Loans by Purpose'}</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>{locale === 'bn' ? 'ব্যবসা' : 'Business'}</span>
                      <span className="font-medium">45%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{locale === 'bn' ? 'শিক্ষা' : 'Education'}</span>
                      <span className="font-medium">20%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{locale === 'bn' ? 'চিকিৎসা' : 'Medical'}</span>
                      <span className="font-medium">15%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{locale === 'bn' ? 'গৃহ নির্মাণ' : 'Housing'}</span>
                      <span className="font-medium">12%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{locale === 'bn' ? 'অন্যান্য' : 'Others'}</span>
                      <span className="font-medium">8%</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-green-50 rounded-xl">
                  <h4 className="font-medium mb-2">{locale === 'bn' ? 'পরিমাণ অনুযায়ী ঋণ' : 'Loans by Amount'}</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>৳8,000 - ৳25,000</span>
                      <span className="font-medium">30%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>৳25,000 - ৳50,000</span>
                      <span className="font-medium">35%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>৳50,000 - ৳1,00,000</span>
                      <span className="font-medium">25%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>৳1,00,000+</span>
                      <span className="font-medium">10%</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Donations Report */}
        <TabsContent value="donations" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট প্রাপ্ত' : 'Total Received'}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(donationStats.totalReceived)}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'মোট বিতরণ' : 'Total Disbursed'}</p>
                <p className="text-2xl font-bold text-purple-600">{formatCurrency(donationStats.totalDisbursed)}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'যাকাত তহবিল' : 'Zakat Fund'}</p>
                <p className="text-2xl font-bold">{formatCurrency(donationStats.zakatFund)}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{locale === 'bn' ? 'সাদাকাহ তহবিল' : 'Sadaqah Fund'}</p>
                <p className="text-2xl font-bold">{formatCurrency(donationStats.sadaqahFund)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{locale === 'bn' ? 'দান তহবিল বণ্টন' : 'Donation Fund Distribution'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <h4 className="font-medium">{locale === 'bn' ? 'তহবিল অনুযায়ী' : 'By Fund Type'}</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{locale === 'bn' ? 'পরিচালনা' : 'Operating'}</span>
                        <span>40%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full">
                        <div className="h-2 bg-blue-500 rounded-full" style={{ width: '40%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{locale === 'bn' ? 'ঋণ' : 'Lending'}</span>
                        <span>30%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full">
                        <div className="h-2 bg-green-500 rounded-full" style={{ width: '30%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{locale === 'bn' ? 'যাকাত' : 'Zakat'}</span>
                        <span>20%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full">
                        <div className="h-2 bg-purple-500 rounded-full" style={{ width: '20%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{locale === 'bn' ? 'সাদাকাহ' : 'Sadaqah'}</span>
                        <span>10%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full">
                        <div className="h-2 bg-amber-500 rounded-full" style={{ width: '10%' }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="font-medium">{locale === 'bn' ? 'বিতরণ উদ্দেশ্য' : 'Disbursement Purpose'}</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between p-2 bg-slate-50 rounded">
                      <span>{locale === 'bn' ? 'ঋণ নিষ্পত্তি' : 'Loan Settlement'}</span>
                      <span className="font-medium">35%</span>
                    </div>
                    <div className="flex justify-between p-2 bg-slate-50 rounded">
                      <span>{locale === 'bn' ? 'অফিস পরিচালনা' : 'Office Operations'}</span>
                      <span className="font-medium">25%</span>
                    </div>
                    <div className="flex justify-between p-2 bg-slate-50 rounded">
                      <span>{locale === 'bn' ? 'জরুরি সহায়তা' : 'Emergency Relief'}</span>
                      <span className="font-medium">20%</span>
                    </div>
                    <div className="flex justify-between p-2 bg-slate-50 rounded">
                      <span>{locale === 'bn' ? 'অন্যান্য' : 'Others'}</span>
                      <span className="font-medium">20%</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Actions */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'রিপোর্ট ডাউনলোড' : 'Download Reports'}</CardTitle>
          <CardDescription>
            {locale === 'bn' ? 'PDF বা Excel ফরম্যাটে রিপোর্ট ডাউনলোড করুন' : 'Download reports in PDF or Excel format'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Button variant="outline" className="h-auto py-4 flex-col gap-2">
              <FileText className="h-6 w-6" />
              <span>{locale === 'bn' ? 'মাসিক আর্থিক রিপোর্ট' : 'Monthly Financial Report'}</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2">
              <Users className="h-6 w-6" />
              <span>{locale === 'bn' ? 'সদস্য তালিকা' : 'Member List'}</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2">
              <HandCoins className="h-6 w-6" />
              <span>{locale === 'bn' ? 'ঋণ স্টেটমেন্ট' : 'Loan Statement'}</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2">
              <Wallet className="h-6 w-6" />
              <span>{locale === 'bn' ? 'দান রিপোর্ট' : 'Donation Report'}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
