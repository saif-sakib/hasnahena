'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useLocale } from 'next-intl';
import { Building2, Wallet, Save, RefreshCw, AlertCircle, Mail, Phone, MapPin, Clock, Percent, Calendar, Lock, Globe, Banknote, MessageCircle, Users } from 'lucide-react';
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

/**
 * Settings is the money-and-identity screen.
 *
 * It used to carry a "Landing" tab too — hero image, partner logos, section
 * headings, the login greeting and a gallery uploader, sitting beside the loan
 * multiplier and the bKash number. Publishing the public site and configuring
 * how the foundation's money works are two jobs, and they are two screens now:
 * everything a visitor *reads* moved to Content & Media, next to the gallery it
 * belongs with.
 *
 * What is left is what a wrong value costs real money or real trust: who the
 * organisation is (this prints on every generated document's letterhead), the
 * loan policy, the accounts a donor sends money to, and how long support
 * conversations are kept. `SETTINGS_CONFIG_KEYS` in lib/system-config.ts is the
 * authoritative list, and the two screens' lists are a partition — a unit test
 * refuses a key that lands in both or in neither.
 */

const DEFAULT_ORG_SETTINGS = {
  name: 'হাসনাহেনা',
  nameEn: 'Hasnahena',
  email: 'info@hasnahena.org',
  phone: '+880 1712-345678',
  address: 'ভেকুটিয়া, যশোর, বাংলাদেশ',
  website: 'https://hasnahena.org',
  description: 'একটি কর্দ আল-হাসান (সুদমুক্ত ইসলামী অর্থায়ন) সমবায় সংস্থা',
  regNumber: '',
};

const DEFAULT_LOAN_SETTINGS = {
  maxLoanMultiplier: 5,
  minDepositForLoan: 8000,
  maxInstallmentMonths: 24,
  missedPaymentsForDefault: 3,
  noticePeriodMonths: 3,
  // WO-45. Declared since then and read by the loan application endpoint, but
  // no screen offered it — so the only value it could ever hold was whatever
  // the seed wrote. 0 means every loan needs a guarantor.
  //
  // 20000 rather than 0 because that is what `app/api/v1/loans/applications`
  // falls back to when the row is missing, and what `seed.mjs` writes. A form
  // whose default disagrees with the enforcer shows an admin a policy the
  // system does not apply — the failure ADR-016 was opened for.
  guarantorThresholdAmount: 20000,
  allowActiveLoanWithdrawal: false,
};

const DEFAULT_SUPPORT_RETENTION_DAYS = 10;

/** The donor-facing account details and the support retention policy. */
const DEFAULT_PAYMENT_SETTINGS: Record<string, string> = {
  'donation.bkash': '',
  'donation.nagad': '',
  'donation.rocket': '',
  // WO-67. Seeded EMPTY, deliberately: /donate hides the whole bank card until
  // an admin fills the account number in, because a plausible-looking wrong
  // number is worse than a visible gap when a donor can act on it.
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

  // WO-27 — SWR, not an effect. This screen *edits* what it fetches, so the
  // server value stays derived and only the admin's edits are state; see
  // useDraft in lib/use-api.ts for why that distinction matters here.
  const {
    data: settingsData,
    isLoading,
    mutate: fetchSettings,
  } = useSWR<Record<string, string>>(
    '/api/v1/settings',
    async () => {
      // The admin tier — every declared key, including the ones no member-facing
      // screen may read (WO-77). Without the token this form would load the
      // public subset and then save it back, deleting nothing but showing an
      // admin a settings screen with fields missing.
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
      website: pick('org.website', DEFAULT_ORG_SETTINGS.website),
      description: pick('org.description', DEFAULT_ORG_SETTINGS.description),
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
      noticePeriodMonths: parseNonNegativeSetting(data['loan.noticePeriodMonths'], DEFAULT_LOAN_SETTINGS.noticePeriodMonths),
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

  const serverPaymentSettings = useMemo<Record<string, string>>(() => {
    // Only this screen's own string keys. Reading every string key and posting
    // the lot back is what made the old form a second writer for the landing
    // copy, so a save here could resurrect a value Content & Media had cleared.
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
        noticePeriodMonths: Math.max(1, Math.trunc(loanSettings.noticePeriodMonths)),
        guarantorThresholdAmount: Math.max(0, Math.trunc(loanSettings.guarantorThresholdAmount)),
        allowActiveLoanWithdrawal: loanSettings.allowActiveLoanWithdrawal,
      };
      const normalizedSupportRetentionDays = Math.max(1, Math.trunc(supportRetentionDays));

      // Flatten settings for saving. Only SETTINGS_CONFIG_KEYS — Content & Media
      // owns the rest, and the two lists are a partition, so neither screen can
      // overwrite the other's rows with a copy it read minutes ago.
      const settingsToSave = {
        ...paymentSettings,
        'org.name': orgSettings.name,
        'org.nameEn': orgSettings.nameEn,
        'org.email': orgSettings.email,
        'org.phone': orgSettings.phone,
        'org.address': orgSettings.address,
        'org.website': orgSettings.website,
        'org.description': orgSettings.description,
        'org.regNumber': orgSettings.regNumber,
        'loan.maxLoanMultiplier': String(normalizedLoanSettings.maxLoanMultiplier),
        'loan.minDepositForLoan': String(normalizedLoanSettings.minDepositForLoan),
        'loan.maxInstallmentMonths': String(normalizedLoanSettings.maxInstallmentMonths),
        'loan.missedPaymentsForDefault': String(normalizedLoanSettings.missedPaymentsForDefault),
        'loan.noticePeriodMonths': String(normalizedLoanSettings.noticePeriodMonths),
        'loan.guarantorThresholdAmount': String(normalizedLoanSettings.guarantorThresholdAmount),
        'loan.allowActiveLoanWithdrawal': String(normalizedLoanSettings.allowActiveLoanWithdrawal),
        'support.chatRetentionDays': String(normalizedSupportRetentionDays),

        // The notification.*, security.* and appearance.* keys are deliberately
        // NOT posted. Nothing in either backend reads them, and because this
        // endpoint rejects the entire request on one unrecognised key, sending
        // them made every save 400 — the admin could not change loan policy,
        // organisation details or landing copy either.
        //
        // A read-only "System" tab used to list them here with a note saying
        // where each behaviour is really controlled. It was removed on
        // 2026-08-18 because a settings tab that changes nothing is still a
        // settings tab, and an admin opening it reasonably expects controls.
        // UNIMPLEMENTED_CONFIG_KEYS in lib/system-config.ts carries that
        // mapping now — wire a reader before ever putting one back on screen.
      };

      setLoanSettings(normalizedLoanSettings);
      setSupportRetentionDays(normalizedSupportRetentionDays);

      const authToken = getAuthToken();
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        // Filtered to this screen's own keys rather than posted as assembled.
        // The two admin screens share one key/value table, and each save posts a
        // whole list, so a stray key here would silently revert whatever Content
        // & Media last wrote to it.
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

      // Letterhead values are cached for the session, so documents generated
      // after this save would otherwise keep printing the old organisation
      // details until a full reload.
      clearOrgSettingsCache();

      // Saved, so the drafts hand control back to the server value. Re-reading
      // first means the form now shows what the API actually stored — which is
      // the only way an admin finds out that a value was normalised on the way
      // in rather than accepted as typed.
      await fetchSettings();
      resetOrgDraft();
      resetLoanDraft();
      resetSupportDraft();
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
                    {locale === 'bn' ? 'ঠিকানা' : 'Address'}
                  </Label>
                  <Input id="org-address"
                    value={orgSettings.address}
                    onChange={(e) => setOrgSettings({ ...orgSettings, address: e.target.value })}
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
                  <Label htmlFor="org-description">{locale === 'bn' ? 'বিবরণ' : 'Description'}</Label>
                  <Textarea id="org-description"
                    value={orgSettings.description}
                    onChange={(e) => setOrgSettings({ ...orgSettings, description: e.target.value })}
                    rows={3}
                  />
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
                          setLoanSettings({
                            ...loanSettings,
                            noticePeriodMonths: parseIntegerInput(e.target.value, loanSettings.noticePeriodMonths),
                          })
                        }
                        min={1}
                        step={1}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">{locale === 'bn' ? 'মাস' : 'months'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn'
                        ? 'সদস্য নোটিস দেওয়ার পর এই সময় পার হলেই উত্তোলন করা যাবে। ০ দিলে নোটিস পিরিয়ড থাকবে না।'
                        : 'A withdrawal is paid only after this long has passed since the member gave notice. Set 0 to run no notice period.'}
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
