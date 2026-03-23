'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Settings,
  Building2,
  Users,
  Wallet,
  Bell,
  Shield,
  Globe,
  Palette,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Mail,
  Phone,
  MapPin,
  Clock,
  Percent,
  Calendar,
  Lock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

export default function AdminSettingsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState('organization');
  const [isSaving, setIsSaving] = useState(false);

  // Organization Settings
  const [orgSettings, setOrgSettings] = useState({
    name: 'হাসনাহেনা',
    nameEn: 'Hasnahena',
    email: 'info@hasnahena.org',
    phone: '+880 1712-345678',
    address: 'ঢাকা, বাংলাদেশ',
    website: 'https://hasnahena.org',
    description: 'একটি কর্দ আল-হাসান (সুদমুক্ত ইসলামী অর্থায়ন) সমবায় সংস্থা',
  });

  // Loan Settings
  const [loanSettings, setLoanSettings] = useState({
    maxLoanMultiplier: 5,
    minDepositForLoan: 8000,
    maxInstallmentMonths: 24,
    missedPaymentsForDefault: 3,
    noticePeriodMonths: 3,
  });

  // Notification Settings
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    smsNotifications: true,
    loanApprovalNotify: true,
    depositConfirmationNotify: true,
    paymentReminderNotify: true,
    newMemberNotify: true,
  });

  // Security Settings
  const [securitySettings, setSecuritySettings] = useState({
    twoFactorAuth: false,
    sessionTimeout: 30,
    passwordExpiry: 90,
    loginAttempts: 5,
  });

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
    // Show success message (in a real app, use toast)
    console.log('Settings saved');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'সেটিংস' : 'Settings'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn'
              ? 'সিস্টেম কনফিগারেশন এবং পছন্দ পরিচালনা করুন'
              : 'Manage system configuration and preferences'}
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {locale === 'bn' ? 'সংরক্ষণ করুন' : 'Save Changes'}
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full">
          <TabsTrigger value="organization" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'প্রতিষ্ঠান' : 'Organization'}</span>
          </TabsTrigger>
          <TabsTrigger value="loans" className="gap-2">
            <Wallet className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ঋণ নীতি' : 'Loan Policy'}</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'বিজ্ঞপ্তি' : 'Notifications'}</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'নিরাপত্তা' : 'Security'}</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ডিজাইন' : 'Appearance'}</span>
          </TabsTrigger>
        </TabsList>

        {/* Organization Settings */}
        <TabsContent value="organization">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {locale === 'bn' ? 'প্রতিষ্ঠানের তথ্য' : 'Organization Information'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'প্রতিষ্ঠানের মৌলিক তথ্য আপডেট করুন'
                  : 'Update basic organization information'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'প্রতিষ্ঠানের নাম (বাংলা)' : 'Organization Name (Bengali)'}</Label>
                  <Input
                    value={orgSettings.name}
                    onChange={(e) => setOrgSettings({ ...orgSettings, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'প্রতিষ্ঠানের নাম (ইংরেজি)' : 'Organization Name (English)'}</Label>
                  <Input
                    value={orgSettings.nameEn}
                    onChange={(e) => setOrgSettings({ ...orgSettings, nameEn: e.target.value })}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {locale === 'bn' ? 'ইমেইল' : 'Email'}
                  </Label>
                  <Input
                    type="email"
                    value={orgSettings.email}
                    onChange={(e) => setOrgSettings({ ...orgSettings, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {locale === 'bn' ? 'ফোন' : 'Phone'}
                  </Label>
                  <Input
                    value={orgSettings.phone}
                    onChange={(e) => setOrgSettings({ ...orgSettings, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {locale === 'bn' ? 'ঠিকানা' : 'Address'}
                </Label>
                <Input
                  value={orgSettings.address}
                  onChange={(e) => setOrgSettings({ ...orgSettings, address: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  {locale === 'bn' ? 'ওয়েবসাইট' : 'Website'}
                </Label>
                <Input
                  value={orgSettings.website}
                  onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{locale === 'bn' ? 'বিবরণ' : 'Description'}</Label>
                <Textarea
                  value={orgSettings.description}
                  onChange={(e) => setOrgSettings({ ...orgSettings, description: e.target.value })}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Loan Policy Settings */}
        <TabsContent value="loans">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {locale === 'bn' ? 'ঋণ নীতি সেটিংস' : 'Loan Policy Settings'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'ঋণ সংক্রান্ত নীতি ও সীমা নির্ধারণ করুন'
                  : 'Configure loan policies and limits'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Percent className="h-4 w-4" />
                    {locale === 'bn' ? 'সর্বোচ্চ ঋণ গুণক' : 'Max Loan Multiplier'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={loanSettings.maxLoanMultiplier}
                      onChange={(e) =>
                        setLoanSettings({ ...loanSettings, maxLoanMultiplier: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      × {locale === 'bn' ? 'জমার পরিমাণ' : 'deposit amount'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'সদস্য তার জমার সর্বোচ্চ ৫ গুণ পর্যন্ত ঋণ নিতে পারবেন'
                      : 'Members can borrow up to 5x their deposit'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    {locale === 'bn' ? 'ঋণের জন্য ন্যূনতম জমা' : 'Min Deposit for Loan'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <span>৳</span>
                    <Input
                      type="number"
                      value={loanSettings.minDepositForLoan}
                      onChange={(e) =>
                        setLoanSettings({ ...loanSettings, minDepositForLoan: Number(e.target.value) })
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'ঋণের জন্য ন্যূনতম ৳৮,০০০ জমা থাকতে হবে'
                      : 'Minimum ৳8,000 deposit required for loans'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {locale === 'bn' ? 'সর্বোচ্চ কিস্তি মাস' : 'Max Installment Months'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={loanSettings.maxInstallmentMonths}
                      onChange={(e) =>
                        setLoanSettings({ ...loanSettings, maxInstallmentMonths: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'মাস' : 'months'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {locale === 'bn' ? 'খেলাপির জন্য মিসড পেমেন্ট' : 'Missed Payments for Default'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={loanSettings.missedPaymentsForDefault}
                      onChange={(e) =>
                        setLoanSettings({ ...loanSettings, missedPaymentsForDefault: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      {locale === 'bn' ? 'টি পেমেন্ট' : 'payments'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {locale === 'bn' ? 'উত্তোলনের নোটিস পিরিয়ড' : 'Withdrawal Notice Period'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={loanSettings.noticePeriodMonths}
                      onChange={(e) =>
                        setLoanSettings({ ...loanSettings, noticePeriodMonths: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'মাস' : 'months'}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">
                      {locale === 'bn' ? 'গুরুত্বপূর্ণ নোট' : 'Important Note'}
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      {locale === 'bn'
                        ? 'এই সেটিংস পরিবর্তন করলে নতুন ঋণ আবেদনে প্রযোজ্য হবে। চলমান ঋণে কোনো পরিবর্তন হবে না।'
                        : 'Changes to these settings will apply to new loan applications only. Existing loans will not be affected.'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notification Settings */}
        <TabsContent value="notifications">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                {locale === 'bn' ? 'বিজ্ঞপ্তি সেটিংস' : 'Notification Settings'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'বিজ্ঞপ্তি পছন্দ কনফিগার করুন'
                  : 'Configure notification preferences'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h4 className="font-medium">{locale === 'bn' ? 'বিজ্ঞপ্তি চ্যানেল' : 'Notification Channels'}</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'ইমেইল বিজ্ঞপ্তি' : 'Email Notifications'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'ইমেইলে বিজ্ঞপ্তি পান' : 'Receive notifications via email'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.emailNotifications}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, emailNotifications: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'SMS বিজ্ঞপ্তি' : 'SMS Notifications'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'SMS এ বিজ্ঞপ্তি পান' : 'Receive notifications via SMS'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.smsNotifications}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, smsNotifications: checked })
                      }
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">{locale === 'bn' ? 'বিজ্ঞপ্তি প্রকার' : 'Notification Types'}</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'ঋণ অনুমোদন' : 'Loan Approval'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'ঋণ অনুমোদিত হলে বিজ্ঞপ্তি' : 'Notify when loan is approved'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.loanApprovalNotify}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, loanApprovalNotify: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'জমা নিশ্চিতকরণ' : 'Deposit Confirmation'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'জমা প্রসেস হলে বিজ্ঞপ্তি' : 'Notify when deposit is processed'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.depositConfirmationNotify}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, depositConfirmationNotify: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'পেমেন্ট রিমাইন্ডার' : 'Payment Reminder'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'কিস্তির তারিখের আগে রিমাইন্ডার' : 'Remind before installment due date'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.paymentReminderNotify}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, paymentReminderNotify: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{locale === 'bn' ? 'নতুন সদস্য' : 'New Member'}</Label>
                      <p className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'নতুন সদস্য আবেদন করলে বিজ্ঞপ্তি' : 'Notify when new member registers'}
                      </p>
                    </div>
                    <Switch
                      checked={notificationSettings.newMemberNotify}
                      onCheckedChange={(checked) =>
                        setNotificationSettings({ ...notificationSettings, newMemberNotify: checked })
                      }
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {locale === 'bn' ? 'নিরাপত্তা সেটিংস' : 'Security Settings'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'অ্যাকাউন্ট এবং সিস্টেম নিরাপত্তা কনফিগার করুন'
                  : 'Configure account and system security'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    {locale === 'bn' ? 'দুই-ধাপ যাচাইকরণ' : 'Two-Factor Authentication'}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {locale === 'bn'
                      ? 'অতিরিক্ত নিরাপত্তার জন্য 2FA সক্ষম করুন'
                      : 'Enable 2FA for additional security'}
                  </p>
                </div>
                <Switch
                  checked={securitySettings.twoFactorAuth}
                  onCheckedChange={(checked) =>
                    setSecuritySettings({ ...securitySettings, twoFactorAuth: checked })
                  }
                />
              </div>

              <Separator />

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {locale === 'bn' ? 'সেশন টাইমআউট' : 'Session Timeout'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={securitySettings.sessionTimeout}
                      onChange={(e) =>
                        setSecuritySettings({ ...securitySettings, sessionTimeout: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'মিনিট' : 'minutes'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'পাসওয়ার্ড মেয়াদ' : 'Password Expiry'}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={securitySettings.passwordExpiry}
                      onChange={(e) =>
                        setSecuritySettings({ ...securitySettings, passwordExpiry: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'দিন' : 'days'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'সর্বোচ্চ লগইন চেষ্টা' : 'Max Login Attempts'}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={securitySettings.loginAttempts}
                      onChange={(e) =>
                        setSecuritySettings({ ...securitySettings, loginAttempts: Number(e.target.value) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      {locale === 'bn' ? 'বার' : 'attempts'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-green-50 rounded-xl">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800">
                      {locale === 'bn' ? 'নিরাপত্তা স্ট্যাটাস: সুরক্ষিত' : 'Security Status: Protected'}
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      {locale === 'bn'
                        ? 'আপনার সিস্টেম সর্বোত্তম নিরাপত্তা অনুশীলন অনুসরণ করছে।'
                        : 'Your system is following best security practices.'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Settings */}
        <TabsContent value="appearance">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                {locale === 'bn' ? 'ডিজাইন সেটিংস' : 'Appearance Settings'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'ইন্টারফেস এবং ডিসপ্লে পছন্দ কাস্টমাইজ করুন'
                  : 'Customize interface and display preferences'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'ডিফল্ট ভাষা' : 'Default Language'}</Label>
                  <Select defaultValue="bn">
                    <SelectTrigger className="w-full md:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bn">বাংলা</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'থিম' : 'Theme'}</Label>
                  <Select defaultValue="light">
                    <SelectTrigger className="w-full md:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{locale === 'bn' ? 'লাইট' : 'Light'}</SelectItem>
                      <SelectItem value="dark">{locale === 'bn' ? 'ডার্ক' : 'Dark'}</SelectItem>
                      <SelectItem value="system">{locale === 'bn' ? 'সিস্টেম' : 'System'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'তারিখ ফরম্যাট' : 'Date Format'}</Label>
                  <Select defaultValue="dd/mm/yyyy">
                    <SelectTrigger className="w-full md:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd/mm/yyyy">DD/MM/YYYY</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/DD/YYYY</SelectItem>
                      <SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'bn' ? 'মুদ্রা ফরম্যাট' : 'Currency Format'}</Label>
                  <Select defaultValue="bn-BD">
                    <SelectTrigger className="w-full md:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bn-BD">৳ 1,00,000 (বাংলাদেশি)</SelectItem>
                      <SelectItem value="en-BD">BDT 100,000 (English)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
