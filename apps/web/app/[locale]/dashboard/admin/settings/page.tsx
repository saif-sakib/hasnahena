'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useLocale } from 'next-intl';
import { Building2, Wallet, Save, RefreshCw, AlertCircle, Mail, Phone, MapPin, Clock, Percent, Calendar, Lock, Globe, Banknote, MessageCircle, ShieldAlert, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { clearOrgSettingsCache } from '@/lib/documents';
import { useDraft } from '@/lib/use-api';
// Aliased: `fetchSettings` is already taken in this file by the SWR mutator below.
import { fetchSettings as readSettings } from '@/lib/settings-client';
import { SETTINGS_CONFIG_KEYS } from '@/lib/system-config';
import {
  DEFAULT_MINIMUM_AGE_YEARS,
  MINIMUM_AGE_LOWER_BOUND,
  MINIMUM_AGE_UPPER_BOUND,
  minimumAgeYears,
} from '@/lib/membership-eligibility';

/**
 * Settings: organisation identity, loan policy, payment channels, retention.
 * Public-site copy is on Content & Media; SETTINGS_CONFIG_KEYS and
 * CONTENT_CONFIG_KEYS partition the keys.
 */

/**
 * What the form shows for a missing `org.*` row. MUST equal the seed defaults —
 * these are written back on save (org-defaults.test.ts).
 */
const DEFAULT_ORG_SETTINGS = {
  name: 'হাসনাহেনা ফাউন্ডেশন',
  nameEn: 'Hasnahena Foundation',
  email: 'info@hasnahenafoundation.com',
  phone: '+880 1712-345678',
  address: 'ভেকুটিয়া, সদর, যশোর',
  addressEn: 'Bhekutia, Sadar, Jashore, Bangladesh',
  website: 'hasnahenafoundation.com',
  description: 'একটি কর্দ আল-হাসান (সুদমুক্ত ইসলামী অর্থায়ন) সমবায় সংস্থা',
  descriptionEn:
    'An interest-free (Qard al-Hasan) cooperative finance society in Jashore, Bangladesh.',
  regNumber: '',
};

const DEFAULT_LOAN_SETTINGS = {
  maxLoanMultiplier: 5,
  minDepositForLoan: 8000,
  maxInstallmentMonths: 24,
  missedPaymentsForDefault: 3,
  // Days, not months (ADR-030). 90 is the three months this replaced.
  noticePeriodDays: 90,
  // Same 20000 fallback as the loan application route and seed.mjs (WO-45).
  guarantorThresholdAmount: 20000,
  allowActiveLoanWithdrawal: false,
};

const DEFAULT_SUPPORT_RETENTION_DAYS = 10;
// Must equal DefaultRejectedRetentionDays in retention_repository.go (ADR-033).
const DEFAULT_REJECTED_RETENTION_DAYS = 365;

/** The donor-facing account details and the support retention policy. */
const DEFAULT_PAYMENT_SETTINGS: Record<string, string> = {
  'donation.bkash': '',
  'donation.nagad': '',
  'donation.rocket': '',
  // Seeded EMPTY: /donate hides the bank card until filled (WO-67).
  'bank.name': '',
  'bank.accountName': '',
  'bank.accountNo': '',
  'bank.branch': '',
};

const parseNumberSetting = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeSetting = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseBooleanSetting = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

export default function AdminSettingsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState('organization');
  const [isSaving, setIsSaving] = useState(false);

  // SWR; only the admin's edits are state (useDraft, WO-27).
  const {
    data: settingsData,
    isLoading,
    mutate: fetchSettings,
  } = useSWR<Record<string, string>>(
    '/api/v1/settings',
    async () => {
      // The admin tier (WO-77) — every declared key.
      const data = await readSettings();
      if (!data) throw new Error('Failed to load settings');
      return data;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );


  const serverOrgSettings = useMemo(() => {
    const data = settingsData ?? {};
    const pick = (key: string, fallback: string) =>
      typeof data[key] === 'string' ? (data[key] as string) : fallback;
    return {
      name: pick('org.name', DEFAULT_ORG_SETTINGS.name),
      nameEn: pick('org.nameEn', DEFAULT_ORG_SETTINGS.nameEn),
      email: pick('org.email', DEFAULT_ORG_SETTINGS.email),
      phone: pick('org.phone', DEFAULT_ORG_SETTINGS.phone),
      address: pick('org.address', DEFAULT_ORG_SETTINGS.address),
      addressEn: pick('org.addressEn', DEFAULT_ORG_SETTINGS.addressEn),
      website: pick('org.website', DEFAULT_ORG_SETTINGS.website),
      description: pick('org.description', DEFAULT_ORG_SETTINGS.description),
      descriptionEn: pick('org.descriptionEn', DEFAULT_ORG_SETTINGS.descriptionEn),
      regNumber: pick('org.regNumber', DEFAULT_ORG_SETTINGS.regNumber),
    };
  }, [settingsData]);

  const serverLoanSettings = useMemo(() => {
    const data = settingsData ?? {};
    return {
      maxLoanMultiplier: parseNumberSetting(data['loan.maxLoanMultiplier'], DEFAULT_LOAN_SETTINGS.maxLoanMultiplier),
      minDepositForLoan: parseNonNegativeSetting(data['loan.minDepositForLoan'], DEFAULT_LOAN_SETTINGS.minDepositForLoan),
      maxInstallmentMonths: parseNumberSetting(data['loan.maxInstallmentMonths'], DEFAULT_LOAN_SETTINGS.maxInstallmentMonths),
      missedPaymentsForDefault: parseNumberSetting(data['loan.missedPaymentsForDefault'], DEFAULT_LOAN_SETTINGS.missedPaymentsForDefault),
      noticePeriodDays: parseNonNegativeSetting(data['loan.noticePeriodDays'], DEFAULT_LOAN_SETTINGS.noticePeriodDays),
      guarantorThresholdAmount: parseNonNegativeSetting(
        data['loan.guarantorThresholdAmount'],
        DEFAULT_LOAN_SETTINGS.guarantorThresholdAmount,
      ),
      allowActiveLoanWithdrawal: parseBooleanSetting(
        data['loan.allowActiveLoanWithdrawal'],
        DEFAULT_LOAN_SETTINGS.allowActiveLoanWithdrawal,
      ),
    };
  }, [settingsData]);

  const serverSupportRetentionDays = useMemo(
    () => parseNumberSetting(settingsData?.['support.chatRetentionDays'], DEFAULT_SUPPORT_RETENTION_DAYS),
    [settingsData],
  );

  const serverRejectedRetentionDays = useMemo(
    () =>
      parseNumberSetting(
        settingsData?.['security.rejectedRetentionDays'],
        DEFAULT_REJECTED_RETENTION_DAYS,
      ),
    [settingsData],
  );

  const serverPaymentSettings = useMemo<Record<string, string>>(() => {
    // Only this screen's own keys, so a save cannot resurrect Content & Media's.
    const stringSettings = Object.fromEntries(
      Object.entries(settingsData ?? {}).filter(
        ([key, value]) => typeof value === 'string' && key in DEFAULT_PAYMENT_SETTINGS,
      ),
    ) as Record<string, string>;
    return { ...DEFAULT_PAYMENT_SETTINGS, ...stringSettings };
  }, [settingsData]);

  const [orgSettings, setOrgSettings, resetOrgDraft] = useDraft(serverOrgSettings);
  const [loanSettings, setLoanSettings, resetLoanDraft] = useDraft(serverLoanSettings);
  const [supportRetentionDays, setSupportRetentionDays, resetSupportDraft] =
    useDraft(serverSupportRetentionDays);
  const [minimumAge, setMinimumAge, resetMinimumAgeDraft] = useDraft(
    minimumAgeYears(settingsData ?? undefined),
  );
  const [rejectedRetentionDays, setRejectedRetentionDays, resetRejectedRetentionDraft] =
    useDraft(serverRejectedRetentionDays);
  const [paymentSettings, setPaymentSettings, resetPaymentDraft] = useDraft(serverPaymentSettings);

  const getAuthToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;

  const parseIntegerInput = (rawValue: string, currentValue: number, min = 1) => {
    const trimmed = rawValue.trim();
    if (trimmed === '') {
      return currentValue;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      return currentValue;
    }
    return Math.max(min, parsed);
  };


  const handleSave = async () => {
    setIsSaving(true);
    try {
      const normalizedLoanSettings = {
        maxLoanMultiplier: Math.max(1, Math.trunc(loanSettings.maxLoanMultiplier)),
        minDepositForLoan: Math.max(0, Math.trunc(loanSettings.minDepositForLoan)),
        maxInstallmentMonths: Math.max(1, Math.trunc(loanSettings.maxInstallmentMonths)),
        missedPaymentsForDefault: Math.max(1, Math.trunc(loanSettings.missedPaymentsForDefault)),
        noticePeriodDays: Math.max(0, Math.trunc(loanSettings.noticePeriodDays)),
        guarantorThresholdAmount: Math.max(0, Math.trunc(loanSettings.guarantorThresholdAmount)),
        allowActiveLoanWithdrawal: loanSettings.allowActiveLoanWithdrawal,
      };
      const normalizedSupportRetentionDays = Math.max(1, Math.trunc(supportRetentionDays));
      const normalizedRejectedRetentionDays = Math.max(1, Math.trunc(rejectedRetentionDays));
      // Clamped: an out-of-bounds value falls back on read.
      const normalizedMinimumAge = Math.min(
        MINIMUM_AGE_UPPER_BOUND,
        Math.max(MINIMUM_AGE_LOWER_BOUND, Math.trunc(minimumAge)),
      );

      // Only SETTINGS_CONFIG_KEYS — Content & Media owns the rest.
      const settingsToSave = {
        ...paymentSettings,
        'org.name': orgSettings.name,
        'org.nameEn': orgSettings.nameEn,
        'org.email': orgSettings.email,
        'org.phone': orgSettings.phone,
        'org.address': orgSettings.address,
        'org.addressEn': orgSettings.addressEn,
        'org.website': orgSettings.website,
        'org.description': orgSettings.description,
        'org.descriptionEn': orgSettings.descriptionEn,
        'org.regNumber': orgSettings.regNumber,
        'loan.maxLoanMultiplier': String(normalizedLoanSettings.maxLoanMultiplier),
        'loan.minDepositForLoan': String(normalizedLoanSettings.minDepositForLoan),
        'loan.maxInstallmentMonths': String(normalizedLoanSettings.maxInstallmentMonths),
        'loan.missedPaymentsForDefault': String(normalizedLoanSettings.missedPaymentsForDefault),
        'loan.noticePeriodDays': String(normalizedLoanSettings.noticePeriodDays),
        'loan.guarantorThresholdAmount': String(normalizedLoanSettings.guarantorThresholdAmount),
        'loan.allowActiveLoanWithdrawal': String(normalizedLoanSettings.allowActiveLoanWithdrawal),
        'support.chatRetentionDays': String(normalizedSupportRetentionDays),
        'security.rejectedRetentionDays': String(normalizedRejectedRetentionDays),
        'membership.minimumAgeYears': String(normalizedMinimumAge),

        // Unimplemented keys (UNIMPLEMENTED_CONFIG_KEYS) are never posted — the
        // endpoint would reject the whole request.
      };

      setLoanSettings(normalizedLoanSettings);
      setSupportRetentionDays(normalizedSupportRetentionDays);
      setRejectedRetentionDays(normalizedRejectedRetentionDays);

      const authToken = getAuthToken();
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        // Filtered to this screen's keys.
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(settingsToSave).filter(([key]) =>
              (SETTINGS_CONFIG_KEYS as readonly string[]).includes(key),
            ),
          ),
        ),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save settings');
      }

      // Letterhead values are cached for the session.
      clearOrgSettingsCache();

      // Re-read so the form shows what was actually stored.
      await fetchSettings();
      resetOrgDraft();
      resetLoanDraft();
      resetSupportDraft();
      resetRejectedRetentionDraft();
      resetMinimumAgeDraft();
      resetPaymentDraft();

      toast({
        title: 'Success',
        description: locale === 'bn' ? 'সেটিংস সংরক্ষিত হয়েছে' : 'Settings saved successfully',
        variant: 'default',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save settings';
      console.error('[Settings Save] Error:', errorMsg);
      toast({
        title: 'Error',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const tabs = [
    { key: 'organization', label: locale === 'bn' ? 'প্রতিষ্ঠান' : 'Organization' },
    { key: 'loans', label: locale === 'bn' ? 'ঋণ নীতি' : 'Loans' },
    { key: 'payments', label: locale === 'bn' ? 'পেমেন্ট ও সাপোর্ট' : 'Payments & Support' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'সেটিংস' : 'Settings'}</h1>
          <p className="text-sm text-gray-500">{locale === 'bn' ? 'সিস্টেম কনফিগারেশন' : 'System configuration'}</p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8">
          {isSaving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${activeTab === tab.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="hidden">
          {tabs.map((tab) => <TabsTrigger key={tab.key} value={tab.key}>{tab.label}</TabsTrigger>)}
        </TabsList>

        <div>
          {/* Organization Settings */}
          <TabsContent value="organization">
            <Card className="rounded-none border-gray-200 shadow-none">
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
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="org-name-bn">{locale === 'bn' ? 'প্রতিষ্ঠানের নাম (বাংলা)' : 'Organization Name (Bengali)'}</Label>
                    <Input id="org-name-bn"
                      value={orgSettings.name}
                      onChange={(e) => setOrgSettings({ ...orgSettings, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-name-en">{locale === 'bn' ? 'প্রতিষ্ঠানের নাম (ইংরেজি)' : 'Organization Name (English)'}</Label>
                    <Input id="org-name-en"
                      value={orgSettings.nameEn}
                      onChange={(e) => setOrgSettings({ ...orgSettings, nameEn: e.target.value })}
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 my-4" />

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="org-email" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {locale === 'bn' ? 'ইমেইল' : 'Email'}
                    </Label>
                    <Input id="org-email"
                      type="email"
                      value={orgSettings.email}
                      onChange={(e) => setOrgSettings({ ...orgSettings, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-phone" className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      {locale === 'bn' ? 'ফোন' : 'Phone'}
                    </Label>
                    <Input id="org-phone"
                      value={orgSettings.phone}
                      onChange={(e) => setOrgSettings({ ...orgSettings, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-address" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'ঠিকানা (বাংলা)' : 'Address (Bengali)'}
                  </Label>
                  <Input id="org-address"
                    value={orgSettings.address}
                    onChange={(e) => setOrgSettings({ ...orgSettings, address: e.target.value })}
                  />
                </div>

                {/* Two address boxes (Bengali + English); the address also prints on English-only documents. */}
                <div className="space-y-2">
                  <Label htmlFor="org-address-en" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'ঠিকানা (ইংরেজি)' : 'Address (English)'}
                  </Label>
                  <Input id="org-address-en"
                    value={orgSettings.addressEn}
                    onChange={(e) => setOrgSettings({ ...orgSettings, addressEn: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-website" className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {locale === 'bn' ? 'ওয়েবসাইট' : 'Website'}
                  </Label>
                  <Input id="org-website"
                    value={orgSettings.website}
                    onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-reg-number">{locale === 'bn' ? 'রেজিস্ট্রেশন নম্বর' : 'Registration Number'}</Label>
                  <Input id="org-reg-number"
                    value={orgSettings.regNumber}
                    onChange={(e) => setOrgSettings({ ...orgSettings, regNumber: e.target.value })}
                    placeholder="e.g. 1234-5678"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-description">
                    {locale === 'bn' ? 'বিবরণ (বাংলা)' : 'Description (Bengali)'}
                  </Label>
                  <Textarea id="org-description"
                    value={orgSettings.description}
                    onChange={(e) => setOrgSettings({ ...orgSettings, description: e.target.value })}
                    rows={3}
                  />
                </div>

                {/* Two description boxes; the English one feeds the JSON-LD. */}
                <div className="space-y-2">
                  <Label htmlFor="org-description-en">
                    {locale === 'bn' ? 'বিবরণ (ইংরেজি)' : 'Description (English)'}
                  </Label>
                  <Textarea id="org-description-en"
                    value={orgSettings.descriptionEn}
                    onChange={(e) => setOrgSettings({ ...orgSettings, descriptionEn: e.target.value })}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'সার্চ ইঞ্জিন ও এআই সহকারী এই ইংরেজি বিবরণটিই পড়ে। খালি রাখলে বাংলা বিবরণটি ব্যবহৃত হবে।'
                      : 'Search engines and AI assistants read this English description. Left empty, the Bengali one is used instead.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payment channels and support retention */}
          <TabsContent value="payments">
            <Card className="rounded-none border-gray-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Banknote className="h-5 w-5" />
                  {locale === 'bn' ? 'পেমেন্ট ও সাপোর্ট' : 'Payments & Support'}
                </CardTitle>
                <CardDescription>
                  {locale === 'bn'
                    ? 'দাতারা যেখানে টাকা পাঠান, এবং সাপোর্ট কথোপকথন কতদিন রাখা হবে'
                    : 'Where donors send money, and how long support conversations are kept'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">
                    {locale === 'bn' ? 'মোবাইল ব্যাংকিং' : 'Mobile banking'}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Printed on the public donate page. The headings and the reference note that
                    surround them are edited on <strong>Content &amp; Media</strong>.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pay-bkash">bKash Number</Label>
                    <Input
                      id="pay-bkash"
                      value={paymentSettings['donation.bkash']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'donation.bkash': e.target.value })
                      }
                      placeholder="+8801XXXXXXXXX"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pay-nagad">Nagad Number</Label>
                    <Input
                      id="pay-nagad"
                      value={paymentSettings['donation.nagad']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'donation.nagad': e.target.value })
                      }
                      placeholder="+8801XXXXXXXXX"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pay-rocket">Rocket Number</Label>
                    <Input
                      id="pay-rocket"
                      value={paymentSettings['donation.rocket']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'donation.rocket': e.target.value })
                      }
                      placeholder="+8801XXXXXXXXX"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 my-4" />

                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">Bank Transfer Details</h4>
                  <p className="text-xs text-muted-foreground">
                    Leave the account number empty to hide the bank card entirely — better a
                    visible gap than a number a donor might send money to by mistake.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="bank-name">Bank Name</Label>
                    <Input
                      id="bank-name"
                      value={paymentSettings['bank.name']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'bank.name': e.target.value })
                      }
                      placeholder="e.g. Islami Bank Bangladesh PLC"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-account-name">Account Name</Label>
                    <Input
                      id="bank-account-name"
                      value={paymentSettings['bank.accountName']}
                      onChange={(e) =>
                        setPaymentSettings({
                          ...paymentSettings,
                          'bank.accountName': e.target.value,
                        })
                      }
                      placeholder="e.g. Hasnahena Foundation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-account-no">Account Number</Label>
                    <Input
                      id="bank-account-no"
                      value={paymentSettings['bank.accountNo']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'bank.accountNo': e.target.value })
                      }
                      placeholder="empty hides the bank card"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-branch">Branch</Label>
                    <Input
                      id="bank-branch"
                      value={paymentSettings['bank.branch']}
                      onChange={(e) =>
                        setPaymentSettings({ ...paymentSettings, 'bank.branch': e.target.value })
                      }
                      placeholder="e.g. Jashore Branch"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 my-4" />

                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="support-retention" className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    {locale === 'bn' ? 'সাপোর্ট চ্যাট রাখার দিন' : 'Support Chat Retention Days'}
                  </Label>
                  <Input
                    id="support-retention"
                    type="number"
                    min={1}
                    step={1}
                    value={supportRetentionDays}
                    onChange={(e) =>
                      setSupportRetentionDays(parseIntegerInput(e.target.value, supportRetentionDays))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'এই দিনের বেশি পুরনো সাপোর্ট কথোপকথন স্বয়ংক্রিয়ভাবে মুছে যাবে'
                      : 'Support conversations older than this many days will be removed automatically'}
                  </p>
                </div>

                {/* ADR-033: the decision is kept forever, identity data is not. */}
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="rejected-retention" className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    {locale === 'bn'
                      ? 'বাতিল আবেদনের তথ্য রাখার দিন'
                      : 'Rejected Application Retention Days'}
                  </Label>
                  <Input
                    id="rejected-retention"
                    type="number"
                    min={1}
                    step={1}
                    value={rejectedRetentionDays}
                    onChange={(e) =>
                      setRejectedRetentionDays(
                        parseIntegerInput(e.target.value, rejectedRetentionDays),
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? 'এই দিন পর বাতিল আবেদনের এন.আই.ডি, ঠিকানা, ই-মেইল ও পিতা-মাতার নাম মুছে যাবে; সিদ্ধান্ত ও অডিট রেকর্ড থেকে যাবে'
                      : "After this many days a rejected application's NID number, addresses, contact details and parents' names are cleared. The decision and its audit record are kept."}
                  </p>
                </div>

                {/* Read by the registration form and the API (T-07). */}
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="minimum-age" className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    {locale === 'bn' ? 'সদস্যপদের ন্যূনতম বয়স' : 'Minimum Age For Membership'}
                  </Label>
                  <Input
                    id="minimum-age"
                    type="number"
                    min={MINIMUM_AGE_LOWER_BOUND}
                    max={MINIMUM_AGE_UPPER_BOUND}
                    step={1}
                    value={minimumAge}
                    onChange={(e) => setMinimumAge(parseIntegerInput(e.target.value, minimumAge))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'bn'
                      ? `এর কম বয়সে নিবন্ধন করা যাবে না। ${MINIMUM_AGE_LOWER_BOUND}–${MINIMUM_AGE_UPPER_BOUND} বছরের মধ্যে রাখুন; এর বাইরে হলে ${DEFAULT_MINIMUM_AGE_YEARS} ধরা হবে।`
                      : `Applications from anyone younger are refused. Keep it between ${MINIMUM_AGE_LOWER_BOUND} and ${MINIMUM_AGE_UPPER_BOUND} — outside that range the system falls back to ${DEFAULT_MINIMUM_AGE_YEARS} rather than refusing everybody.`}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Loan Policy Settings */}
          <TabsContent value="loans">
            <Card className="rounded-none border-gray-200 shadow-none">
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
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
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
                          setLoanSettings({
                            ...loanSettings,
                            maxLoanMultiplier: parseIntegerInput(e.target.value, loanSettings.maxLoanMultiplier),
                          })
                        }
                        min={1}
                        step={1}
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
                          setLoanSettings({
                            ...loanSettings,
                            minDepositForLoan: parseIntegerInput(e.target.value, loanSettings.minDepositForLoan, 0),
                          })
                        }
                        min={0}
                        step={1}
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
                          setLoanSettings({
                            ...loanSettings,
                            maxInstallmentMonths: parseIntegerInput(e.target.value, loanSettings.maxInstallmentMonths),
                          })
                        }
                        min={1}
                        step={1}
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
                          setLoanSettings({
                            ...loanSettings,
                            missedPaymentsForDefault: parseIntegerInput(e.target.value, loanSettings.missedPaymentsForDefault),
                          })
                        }
                        min={1}
                        step={1}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'টি পেমেন্ট' : 'payments'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn'
                        ? 'এই সংখ্যক কিস্তি বকেয়া না হলে ঋণ খেলাপি চিহ্নিত করা যাবে না।'
                        : 'A loan cannot be marked defaulted until this many instalments are overdue.'}
                    </p>
                  </div>

                  {/* ADR-030: informational — what the foundation asks for, not a payout gate. */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {locale === 'bn' ? 'উত্তোলনের নোটিসের সময় (দিন)' : 'Withdrawal Notice Period (days)'}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={loanSettings.noticePeriodDays}
                        onChange={(e) =>
                          setLoanSettings({
                            ...loanSettings,
                            noticePeriodDays: parseIntegerInput(e.target.value, loanSettings.noticePeriodDays),
                          })
                        }
                        min={0}
                        step={1}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'দিন' : 'days'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn'
                        ? 'সদস্যকে উত্তোলনের কত দিন আগে জানাতে বলা হবে। এটি সদস্যের সঞ্চয় পাতায় ও সাধারণ প্রশ্নে দেখানো হয়; এটি উত্তোলন আটকায় না — কর্মী চাইলে যেকোনো সময় পরিশোধ করতে পারেন। ০ দিলে কিছুই দেখানো হবে না।'
                        : 'How many days ahead a member is asked to tell us before withdrawing. It is shown on their savings screen and in the FAQ. It does not block a payout — staff can pay whenever the member asks. Set 0 to show nothing.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {locale === 'bn' ? 'জামিনদার লাগবে না যত টাকা পর্যন্ত' : 'Guarantor-free Loan Limit'}
                    </Label>
                    <div className="flex items-center gap-2">
                      <span>৳</span>
                      <Input
                        type="number"
                        value={loanSettings.guarantorThresholdAmount}
                        onChange={(e) =>
                          setLoanSettings({
                            ...loanSettings,
                            guarantorThresholdAmount: parseIntegerInput(
                              e.target.value,
                              loanSettings.guarantorThresholdAmount,
                              0,
                            ),
                          })
                        }
                        min={0}
                        step={1}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn'
                        ? 'এই পরিমাণ বা তার কম ঋণে জামিনদার লাগবে না। ০ দিলে প্রতিটি ঋণেই জামিনদার লাগবে।'
                        : 'Loans at or below this amount skip the guarantor step. Set 0 to require a guarantor on every loan.'}
                    </p>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-start justify-between gap-4 rounded-sm border border-gray-200 bg-white p-4">
                      <div className="space-y-1">
                        <Label className="flex items-center gap-2">
                          <Lock className="h-4 w-4" />
                          {locale === 'bn'
                            ? 'সক্রিয় ঋণ থাকা সদস্যের উত্তোলন'
                            : 'Withdrawals for members with active loans'}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {locale === 'bn'
                            ? 'চালু করলে সক্রিয় ঋণ থাকা সদস্য নিজের জমা উত্তোলন করতে পারবে। জামিনদার লক থাকলে উত্তোলন এখনও বন্ধ থাকবে।'
                            : 'When enabled, members with active loans may withdraw their own deposits. Guarantor locks will still block withdrawals.'}
                        </p>
                      </div>
                      <Switch
                        checked={loanSettings.allowActiveLoanWithdrawal}
                        onCheckedChange={(checked) =>
                          setLoanSettings({ ...loanSettings, allowActiveLoanWithdrawal: checked })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-amber-50">
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

        </div>
      </Tabs>
    </div>
  );
}
