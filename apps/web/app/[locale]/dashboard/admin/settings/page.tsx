'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Building2, Wallet, Bell, Shield, Save, RefreshCw, AlertCircle, CheckCircle2, Mail, Phone, MapPin, Clock, Percent, Calendar, Lock, LayoutTemplate, Globe, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { ImageUpload } from '@/components/ui/image-upload';
import { clearOrgSettingsCache } from '@/lib/documents';
import { uploadSettingsImageAction, deleteSettingsImageAction } from '@/app/actions/upload-settings-image';
import { uploadGalleryAction, deleteGalleryAction } from '@/app/actions/upload-gallery';

type SettingImageType =
  | 'branding.logo'
  | 'branding.dashboardLogo'
  | 'branding.favicon'
  | 'hero.backgroundImage'
  | 'hero.partnerLogo1'
  | 'hero.partnerLogo2'
  | 'hero.partnerLogo3';

interface AdminGalleryItem {
  id: string;
  imageUrl: string;
  captionEn: string | null;
  captionBn: string | null;
  date: string;
}

export default function AdminSettingsPage() {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState('organization');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [galleryCaptionEn, setGalleryCaptionEn] = useState('');
  const [galleryCaptionBn, setGalleryCaptionBn] = useState('');
  const [galleryItems, setGalleryItems] = useState<AdminGalleryItem[]>([]);

  // Organization Settings
  const [orgSettings, setOrgSettings] = useState({
    name: 'হাসনাহেনা',
    nameEn: 'Hasnahena',
    email: 'info@hasnahena.org',
    phone: '+880 1712-345678',
    address: 'ভেকুটিয়া, যশোর, বাংলাদেশ',
    website: 'https://hasnahena.org',
    description: 'একটি কর্দ আল-হাসান (সুদমুক্ত ইসলামী অর্থায়ন) সমবায় সংস্থা',
    regNumber: '',
  });

  // Loan Settings
  const [loanSettings, setLoanSettings] = useState({
    maxLoanMultiplier: 5,
    minDepositForLoan: 8000,
    maxInstallmentMonths: 24,
    missedPaymentsForDefault: 3,
    noticePeriodMonths: 3,
    allowActiveLoanWithdrawal: false,
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
  const [supportRetentionDays, setSupportRetentionDays] = useState(10);
  const [appearanceSettings, setAppearanceSettings] = useState({
    defaultLanguage: 'bn',
    theme: 'light',
    dateFormat: 'dd/mm/yyyy',
    currencyFormat: 'bn-BD',
  });

  // Landing Page Settings (Dynamic Content)
  const [landingSettings, setLandingSettings] = useState<Record<string, string>>({
    'hero.tagline': '',
    'navigation.features': '',
    'navigation.donate': '',
    'features.title': '',
    'auth.welcomeBack': '',
    'contact.title': '',
    'donation.title': '',
    'donation.subtitle': '',
    'donation.bkash': '',
    'donation.nagad': '',
    'donation.rocket': '',
    'donation.referenceNote': '',
    'branding.logo': '',
    'branding.dashboardLogo': '',
    'branding.favicon': '',
    'hero.backgroundImage': '',
    'hero.partnerLogo1': '',
    'hero.partnerLogo2': '',
    'hero.partnerLogo3': '',
  });

  useEffect(() => {
    void Promise.all([fetchSettings(), fetchGalleryItems()]);
  }, []);

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

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/v1/settings');
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
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

        // Merge only string-based settings into landing config.
        const stringSettings = Object.fromEntries(
          Object.entries(data).filter(([, value]) => typeof value === 'string')
        ) as Record<string, string>;
        setLandingSettings((prev) => ({ ...prev, ...stringSettings }));
        
        setOrgSettings((prev) => ({
          ...prev,
          name: typeof data['org.name'] === 'string' ? data['org.name'] : prev.name,
          nameEn: typeof data['org.nameEn'] === 'string' ? data['org.nameEn'] : prev.nameEn,
          email: typeof data['org.email'] === 'string' ? data['org.email'] : prev.email,
          phone: typeof data['org.phone'] === 'string' ? data['org.phone'] : prev.phone,
          address: typeof data['org.address'] === 'string' ? data['org.address'] : prev.address,
          website: typeof data['org.website'] === 'string' ? data['org.website'] : prev.website,
          description: typeof data['org.description'] === 'string' ? data['org.description'] : prev.description,
          regNumber: typeof data['org.regNumber'] === 'string' ? data['org.regNumber'] : prev.regNumber,
        }));
        setLoanSettings((prev) => ({
          ...prev,
          maxLoanMultiplier: parseNumberSetting(data['loan.maxLoanMultiplier'], prev.maxLoanMultiplier),
          minDepositForLoan: parseNonNegativeSetting(data['loan.minDepositForLoan'], prev.minDepositForLoan),
          maxInstallmentMonths: parseNumberSetting(data['loan.maxInstallmentMonths'], prev.maxInstallmentMonths),
          missedPaymentsForDefault: parseNumberSetting(data['loan.missedPaymentsForDefault'], prev.missedPaymentsForDefault),
          noticePeriodMonths: parseNumberSetting(data['loan.noticePeriodMonths'], prev.noticePeriodMonths),
          allowActiveLoanWithdrawal: parseBooleanSetting(data['loan.allowActiveLoanWithdrawal'], prev.allowActiveLoanWithdrawal),
        }));

        setNotificationSettings((prev) => ({
          ...prev,
          emailNotifications: parseBooleanSetting(data['notification.emailNotifications'], prev.emailNotifications),
          smsNotifications: parseBooleanSetting(data['notification.smsNotifications'], prev.smsNotifications),
          loanApprovalNotify: parseBooleanSetting(data['notification.loanApprovalNotify'], prev.loanApprovalNotify),
          depositConfirmationNotify: parseBooleanSetting(data['notification.depositConfirmationNotify'], prev.depositConfirmationNotify),
          paymentReminderNotify: parseBooleanSetting(data['notification.paymentReminderNotify'], prev.paymentReminderNotify),
          newMemberNotify: parseBooleanSetting(data['notification.newMemberNotify'], prev.newMemberNotify),
        }));

        setSecuritySettings((prev) => ({
          ...prev,
          twoFactorAuth: parseBooleanSetting(data['security.twoFactorAuth'], prev.twoFactorAuth),
          sessionTimeout: parseNumberSetting(data['security.sessionTimeout'], prev.sessionTimeout),
          passwordExpiry: parseNumberSetting(data['security.passwordExpiry'], prev.passwordExpiry),
          loginAttempts: parseNumberSetting(data['security.loginAttempts'], prev.loginAttempts),
        }));

        setAppearanceSettings((prev) => ({
          ...prev,
          defaultLanguage: typeof data['appearance.defaultLanguage'] === 'string'
            ? data['appearance.defaultLanguage']
            : prev.defaultLanguage,
          theme: typeof data['appearance.theme'] === 'string'
            ? data['appearance.theme']
            : prev.theme,
          dateFormat: typeof data['appearance.dateFormat'] === 'string'
            ? data['appearance.dateFormat']
            : prev.dateFormat,
          currencyFormat: typeof data['appearance.currencyFormat'] === 'string'
            ? data['appearance.currencyFormat']
            : prev.currencyFormat,
        }));

        setSupportRetentionDays((prev) =>
          parseNumberSetting(data['support.chatRetentionDays'], prev)
        );
      }
    } catch (error) {
      console.error('Failed to fetch settings', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGalleryItems = async () => {
    try {
      const response = await fetch('/api/v1/gallery', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to fetch gallery items');
      }

      const data = (await response.json()) as AdminGalleryItem[];
      setGalleryItems(data);
    } catch (error) {
      console.error('Failed to fetch gallery items', error);
      toast({
        title: 'Error',
        description: 'Failed to load gallery items',
        variant: 'destructive',
      });
    }
  };

  const handleSettingsImageUpload = (imageType: SettingImageType) => async (formData: FormData) => {
    const authToken = getAuthToken();
    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    setIsUploadingMedia(true);
    formData.append('authToken', authToken);
    const result = await uploadSettingsImageAction(imageType, formData);
    setIsUploadingMedia(false);

    if (result.success && result.imageUrl) {
      setLandingSettings((prev) => ({ ...prev, [imageType]: result.imageUrl as string }));
      return { success: true, imageUrl: result.imageUrl };
    }

    return { success: false, error: result.error || 'Upload failed' };
  };

  const handleSettingsImageDelete = async (imageType: SettingImageType) => {
    const authToken = getAuthToken();
    const result = await deleteSettingsImageAction(imageType, authToken ?? undefined);
    if (!result.success) {
      toast({
        title: 'Error',
        description: result.error || 'Failed to delete image',
        variant: 'destructive',
      });
      return;
    }

    setLandingSettings((prev) => ({ ...prev, [imageType]: '' }));
    toast({
      title: 'Success',
      description: 'Image removed',
      variant: 'default',
    });
  };

  const handleGalleryUploadFromSettings = async (formData: FormData) => {
    const authToken = getAuthToken();
    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    setIsUploadingMedia(true);
    formData.append('authToken', authToken);
    if (galleryCaptionEn.trim()) formData.append('captionEn', galleryCaptionEn.trim());
    if (galleryCaptionBn.trim()) formData.append('captionBn', galleryCaptionBn.trim());

    const result = await uploadGalleryAction(formData);
    setIsUploadingMedia(false);

    if (result.success && result.galleryItem) {
      setGalleryCaptionEn('');
      setGalleryCaptionBn('');
      await fetchGalleryItems();
      return { success: true, imageUrl: result.galleryItem.imageUrl };
    }

    return { success: false, error: result.error || 'Upload failed' };
  };

  const handleGalleryDeleteFromSettings = async (id: string) => {
    const authToken = getAuthToken();
    const result = await deleteGalleryAction(id, authToken ?? undefined);
    if (!result.success) {
      toast({
        title: 'Error',
        description: result.error || 'Failed to delete gallery item',
        variant: 'destructive',
      });
      return;
    }

    setGalleryItems((prev) => prev.filter((item) => item.id !== id));
    toast({
      title: 'Success',
      description: 'Gallery item deleted',
    });
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
        allowActiveLoanWithdrawal: loanSettings.allowActiveLoanWithdrawal,
      };
      const normalizedSecuritySettings = {
        sessionTimeout: Math.max(1, Math.trunc(securitySettings.sessionTimeout)),
        passwordExpiry: Math.max(1, Math.trunc(securitySettings.passwordExpiry)),
        loginAttempts: Math.max(1, Math.trunc(securitySettings.loginAttempts)),
      };
      const normalizedSupportRetentionDays = Math.max(1, Math.trunc(supportRetentionDays));

      // Flatten settings for saving
      const settingsToSave = {
        ...landingSettings,
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
        'loan.allowActiveLoanWithdrawal': String(normalizedLoanSettings.allowActiveLoanWithdrawal),
        'notification.emailNotifications': String(notificationSettings.emailNotifications),
        'notification.smsNotifications': String(notificationSettings.smsNotifications),
        'notification.loanApprovalNotify': String(notificationSettings.loanApprovalNotify),
        'notification.depositConfirmationNotify': String(notificationSettings.depositConfirmationNotify),
        'notification.paymentReminderNotify': String(notificationSettings.paymentReminderNotify),
        'notification.newMemberNotify': String(notificationSettings.newMemberNotify),
        'security.twoFactorAuth': String(securitySettings.twoFactorAuth),
        'security.sessionTimeout': String(normalizedSecuritySettings.sessionTimeout),
        'security.passwordExpiry': String(normalizedSecuritySettings.passwordExpiry),
        'security.loginAttempts': String(normalizedSecuritySettings.loginAttempts),
        'appearance.defaultLanguage': appearanceSettings.defaultLanguage,
        'appearance.theme': appearanceSettings.theme,
        'appearance.dateFormat': appearanceSettings.dateFormat,
        'appearance.currencyFormat': appearanceSettings.currencyFormat,
        'support.chatRetentionDays': String(normalizedSupportRetentionDays),
      };

      setLoanSettings(normalizedLoanSettings);
      setSecuritySettings((prev) => ({
        ...prev,
        ...normalizedSecuritySettings,
      }));
      setSupportRetentionDays(normalizedSupportRetentionDays);

      const authToken = getAuthToken();
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(settingsToSave),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save settings');
      }

      // Letterhead values are cached for the session, so documents generated
      // after this save would otherwise keep printing the old organisation
      // details until a full reload.
      clearOrgSettingsCache();

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
    { key: 'landing', label: locale === 'bn' ? 'ল্যান্ডিং' : 'Landing' },
    { key: 'loans', label: locale === 'bn' ? 'ঋণ নীতি' : 'Loans' },
    { key: 'notifications', label: locale === 'bn' ? 'বিজ্ঞপ্তি' : 'Notify' },
    { key: 'security', label: locale === 'bn' ? 'নিরাপত্তা' : 'Security' },
    { key: 'appearance', label: locale === 'bn' ? 'ডিজাইন' : 'Appearance' },
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

                <div className="border-t border-gray-200 my-4" />

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
                  <Label>{locale === 'bn' ? 'রেজিস্ট্রেশন নম্বর' : 'Registration Number'}</Label>
                  <Input
                    value={orgSettings.regNumber}
                    onChange={(e) => setOrgSettings({ ...orgSettings, regNumber: e.target.value })}
                    placeholder="e.g. 1234-5678"
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

          {/* Landing Page Settings */}
          <TabsContent value="landing">
            <Card className="rounded-none border-gray-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutTemplate className="h-5 w-5" />
                  {locale === 'bn' ? 'ল্যান্ডিং পেজ কনটেন্ট' : 'Landing Page Content'}
                </CardTitle>
                <CardDescription>
                  {locale === 'bn'
                    ? 'ল্যান্ডিং পেজের টেক্সট এবং কনফিগারেশন পরিবর্তন করুন'
                    : 'Customize landing page text and configuration'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Hero Tagline</Label>
                    <Input
                      value={landingSettings['hero.tagline']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'hero.tagline': e.target.value })}
                      placeholder="e.g. Empowering Community through Islamic Finance"
                    />
                    <p className="text-xs text-muted-foreground">The main headline on the home page.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Navigation Features Label</Label>
                    <Input
                      value={landingSettings['navigation.features']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'navigation.features': e.target.value })}
                      placeholder="e.g. Features"
                    />
                    <p className="text-xs text-muted-foreground">The menu item text for the Features section.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Navigation Donate Label</Label>
                    <Input
                      value={landingSettings['navigation.donate']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'navigation.donate': e.target.value })}
                      placeholder="e.g. Donate"
                    />
                    <p className="text-xs text-muted-foreground">The menu item text for the Donate section.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Features Section Title</Label>
                    <Input
                      value={landingSettings['features.title']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'features.title': e.target.value })}
                      placeholder="e.g. Why Choose Us?"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Contact Section Title</Label>
                    <Input
                      value={landingSettings['contact.title']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'contact.title': e.target.value })}
                      placeholder="e.g. Contact Us"
                    />
                  </div>

                  <div className="border-t border-gray-200 my-4" />

                  <div className="space-y-2">
                    <Label>Donate Section Title</Label>
                    <Input
                      value={landingSettings['donation.title']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.title': e.target.value })}
                      placeholder="e.g. Donate to Support Our Mission"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Donate Section Subtitle</Label>
                    <Input
                      value={landingSettings['donation.subtitle']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.subtitle': e.target.value })}
                      placeholder="e.g. Send your donation through the following channels"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>bKash Number</Label>
                      <Input
                        value={landingSettings['donation.bkash']}
                        onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.bkash': e.target.value })}
                        placeholder="+8801XXXXXXXXX"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Nagad Number</Label>
                      <Input
                        value={landingSettings['donation.nagad']}
                        onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.nagad': e.target.value })}
                        placeholder="+8801XXXXXXXXX"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Rocket Number</Label>
                      <Input
                        value={landingSettings['donation.rocket']}
                        onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.rocket': e.target.value })}
                        placeholder="+8801XXXXXXXXX"
                      />
                    </div>
                  </div>

                    <div className="space-y-2">
                      <Label>Donation Reference Note</Label>
                      <Textarea
                      value={landingSettings['donation.referenceNote']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'donation.referenceNote': e.target.value })}
                      rows={3}
                      placeholder="e.g. Please mention your name, address and mobile number in reference..."
                    />
                  </div>

                  <div className="border-t border-gray-200 my-4" />

                  <div className="space-y-2">
                    <Label>Welcome Back Message (Login Page)</Label>
                    <Input
                      value={landingSettings['auth.welcomeBack']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'auth.welcomeBack': e.target.value })}
                      placeholder="e.g. Welcome Back!"
                    />
                    <p className="text-xs text-muted-foreground">The greeting message shown on the login screen.</p>
                  </div>

                  <div className="border-t border-gray-200 my-4" />

                  <div className="space-y-4">
                    <h4 className="font-medium">
                      {locale === 'bn' ? 'ল্যান্ডিং পেজ ইমেজ' : 'Landing Page Images'}
                    </h4>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{locale === 'bn' ? 'সাইট লোগো' : 'Site Logo'}</Label>
                        <ImageUpload
                          currentImage={landingSettings['branding.logo'] || undefined}
                          onUpload={handleSettingsImageUpload('branding.logo')}
                          onUploadComplete={(url) =>
                            setLandingSettings((prev) => ({ ...prev, 'branding.logo': url }))
                          }
                          onUploadError={(error) =>
                            toast({ title: 'Upload Error', description: error, variant: 'destructive' })
                          }
                          maxSizeMB={5}
                          aspectRatio="aspect-3/1"
                        />
                        {landingSettings['branding.logo'] && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleSettingsImageDelete('branding.logo')}
                            disabled={isUploadingMedia}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            {locale === 'bn' ? 'সরান' : 'Remove'}
                          </Button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{locale === 'bn' ? 'ড্যাশবোর্ড লোগো' : 'Dashboard Logo'}</Label>
                        <ImageUpload
                          currentImage={landingSettings['branding.dashboardLogo'] || undefined}
                          onUpload={handleSettingsImageUpload('branding.dashboardLogo')}
                          onUploadComplete={(url) =>
                            setLandingSettings((prev) => ({ ...prev, 'branding.dashboardLogo': url }))
                          }
                          onUploadError={(error) =>
                            toast({ title: 'Upload Error', description: error, variant: 'destructive' })
                          }
                          maxSizeMB={5}
                          aspectRatio="aspect-3/1"
                        />
                        {landingSettings['branding.dashboardLogo'] && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleSettingsImageDelete('branding.dashboardLogo')}
                            disabled={isUploadingMedia}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            {locale === 'bn' ? 'সরান' : 'Remove'}
                          </Button>
                        )}
                      </div>
                    </div>

                  <div className="border-t border-gray-200 my-4" />

                  <div className="space-y-2">
                    <Label>Support Chat Retention Days</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={supportRetentionDays}
                      onChange={(e) => setSupportRetentionDays(parseIntegerInput(e.target.value, supportRetentionDays))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {locale === 'bn'
                        ? 'এই দিনের বেশি পুরনো সাপোর্ট কথোপকথন স্বয়ংক্রিয়ভাবে মুছে যাবে'
                        : 'Support conversations older than this many days will be removed automatically'}
                    </p>
                  </div>

                    <div className="space-y-2">
                      <Label>{locale === 'bn' ? 'হিরো ব্যাকগ্রাউন্ড ইমেজ' : 'Hero Background Image'}</Label>
                      <ImageUpload
                        currentImage={landingSettings['hero.backgroundImage'] || undefined}
                        onUpload={handleSettingsImageUpload('hero.backgroundImage')}
                        onUploadComplete={(url) =>
                          setLandingSettings((prev) => ({ ...prev, 'hero.backgroundImage': url }))
                        }
                        onUploadError={(error) =>
                          toast({ title: 'Upload Error', description: error, variant: 'destructive' })
                        }
                        maxSizeMB={5}
                        aspectRatio="aspect-video"
                      />
                      {landingSettings['hero.backgroundImage'] && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleSettingsImageDelete('hero.backgroundImage')}
                          disabled={isUploadingMedia}
                          className="gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          {locale === 'bn' ? 'সরান' : 'Remove'}
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {(
                        [
                          ['hero.partnerLogo1', locale === 'bn' ? 'পার্টনার লোগো ১' : 'Partner Logo 1'],
                          ['hero.partnerLogo2', locale === 'bn' ? 'পার্টনার লোগো ২' : 'Partner Logo 2'],
                          ['hero.partnerLogo3', locale === 'bn' ? 'পার্টনার লোগো ৩' : 'Partner Logo 3'],
                        ] as const
                      ).map(([key, title]) => (
                        <div key={key} className="space-y-2">
                          <Label>{title}</Label>
                          <ImageUpload
                            currentImage={landingSettings[key] || undefined}
                            onUpload={handleSettingsImageUpload(key)}
                            onUploadComplete={(url) =>
                              setLandingSettings((prev) => ({ ...prev, [key]: url }))
                            }
                            onUploadError={(error) =>
                              toast({ title: 'Upload Error', description: error, variant: 'destructive' })
                            }
                            maxSizeMB={5}
                            aspectRatio="aspect-4/3"
                          />
                          {landingSettings[key] && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleSettingsImageDelete(key)}
                              disabled={isUploadingMedia}
                              className="gap-2"
                            >
                              <Trash2 className="h-4 w-4" />
                              {locale === 'bn' ? 'সরান' : 'Remove'}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-gray-200 my-4" />

                  <div className="space-y-4">
                    <h4 className="font-medium">
                      {locale === 'bn' ? 'গ্যালারিতে পোস্ট করুন' : 'Post to Gallery'}
                    </h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{locale === 'bn' ? 'ক্যাপশন (ইংরেজি)' : 'Caption (English)'}</Label>
                        <Input
                          value={galleryCaptionEn}
                          onChange={(e) => setGalleryCaptionEn(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{locale === 'bn' ? 'ক্যাপশন (বাংলা)' : 'Caption (Bengali)'}</Label>
                        <Input
                          value={galleryCaptionBn}
                          onChange={(e) => setGalleryCaptionBn(e.target.value)}
                        />
                      </div>
                    </div>
                    <ImageUpload
                      label={locale === 'bn' ? 'গ্যালারি ইমেজ আপলোড' : 'Upload Gallery Image'}
                      onUpload={handleGalleryUploadFromSettings}
                      onUploadComplete={() => {
                        toast({
                          title: 'Success',
                          description: locale === 'bn' ? 'গ্যালারিতে পোস্ট করা হয়েছে' : 'Posted to gallery',
                        });
                      }}
                      onUploadError={(error) =>
                        toast({ title: 'Upload Error', description: error, variant: 'destructive' })
                      }
                      maxSizeMB={10}
                      aspectRatio="aspect-video"
                    />
                  </div>

                  {galleryItems.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-medium">
                        {locale === 'bn' ? 'গ্যালারি পোস্টসমূহ' : 'Gallery Posts'}
                      </h4>
                      <div className="grid gap-3 md:grid-cols-2">
                        {galleryItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 rounded-sm border border-gray-200 p-2"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.imageUrl}
                              alt={item.captionEn || item.captionBn || 'Gallery image'}
                              className="h-14 w-20 rounded object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {item.captionEn || item.captionBn || '-'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(item.date).toLocaleDateString()}
                              </p>
                            </div>
                            <Button
                              variant="destructive"
                              size="icon"
                              onClick={() => void handleGalleryDeleteFromSettings(item.id)}
                              disabled={isUploadingMedia}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

          {/* Notification Settings */}
          <TabsContent value="notifications">
            <Card className="rounded-none border-gray-200 shadow-none">
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
              <CardContent className="space-y-4">
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

                <div className="border-t border-gray-200 my-4" />

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
            <Card className="rounded-none border-gray-200 shadow-none">
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
              <CardContent className="space-y-4">
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

                <div className="border-t border-gray-200 my-4" />

                <div className="grid gap-4 md:grid-cols-2">
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
                          setSecuritySettings({
                            ...securitySettings,
                            sessionTimeout: parseIntegerInput(e.target.value, securitySettings.sessionTimeout),
                          })
                        }
                        min={1}
                        step={1}
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
                          setSecuritySettings({
                            ...securitySettings,
                            passwordExpiry: parseIntegerInput(e.target.value, securitySettings.passwordExpiry),
                          })
                        }
                        min={1}
                        step={1}
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
                          setSecuritySettings({
                            ...securitySettings,
                            loginAttempts: parseIntegerInput(e.target.value, securitySettings.loginAttempts),
                          })
                        }
                        min={1}
                        step={1}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">
                        {locale === 'bn' ? 'বার' : 'attempts'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-green-50">
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
            <Card className="rounded-none border-gray-200 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm font-medium">{locale === 'bn' ? 'ডিজাইন সেটিংস' : 'Appearance Settings'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm">{locale === 'bn' ? 'ডিফল্ট ভাষা' : 'Default Language'}</Label>
                    <select
                      value={appearanceSettings.defaultLanguage}
                      onChange={(e) =>
                        setAppearanceSettings({ ...appearanceSettings, defaultLanguage: e.target.value })
                      }
                      className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500 w-full md:w-64"
                    >
                      <option value="bn">বাংলা</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">{locale === 'bn' ? 'থিম' : 'Theme'}</Label>
                    <select
                      value={appearanceSettings.theme}
                      onChange={(e) =>
                        setAppearanceSettings({ ...appearanceSettings, theme: e.target.value })
                      }
                      className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500 w-full md:w-64"
                    >
                      <option value="light">{locale === 'bn' ? 'লাইট' : 'Light'}</option>
                      <option value="dark">{locale === 'bn' ? 'ডার্ক' : 'Dark'}</option>
                      <option value="system">{locale === 'bn' ? 'সিস্টেম' : 'System'}</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">{locale === 'bn' ? 'তারিখ ফরম্যাট' : 'Date Format'}</Label>
                    <select
                      value={appearanceSettings.dateFormat}
                      onChange={(e) =>
                        setAppearanceSettings({ ...appearanceSettings, dateFormat: e.target.value })
                      }
                      className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500 w-full md:w-64"
                    >
                      <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                      <option value="mm/dd/yyyy">MM/DD/YYYY</option>
                      <option value="yyyy-mm-dd">YYYY-MM-DD</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">{locale === 'bn' ? 'মুদ্রা ফরম্যাট' : 'Currency Format'}</Label>
                    <select
                      value={appearanceSettings.currencyFormat}
                      onChange={(e) =>
                        setAppearanceSettings({ ...appearanceSettings, currencyFormat: e.target.value })
                      }
                      className="h-9 px-3 text-sm border border-gray-200 focus:outline-hidden focus:border-blue-500 w-full md:w-64"
                    >
                      <option value="bn-BD">৳ 1,00,000 (বাংলাদেশি)</option>
                      <option value="en-BD">BDT 100,000 (English)</option>
                    </select>
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
