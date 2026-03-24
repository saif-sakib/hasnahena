'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import {
  Building2,
  Wallet,
  Bell,
  Shield,
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
  LayoutTemplate,
  Globe,
  Trash2,
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
import { toast } from '@/hooks/use-toast';
import { ImageUpload } from '@/components/ui/image-upload';
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

  // Landing Page Settings (Dynamic Content)
  const [landingSettings, setLandingSettings] = useState<Record<string, string>>({
    'hero.tagline': '',
    'navigation.features': '',
    'features.title': '',
    'auth.welcomeBack': '',
    'contact.title': '',
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

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/v1/settings');
      if (response.ok) {
        const data = await response.json();
        // Merge with existing settings
        setLandingSettings(prev => ({ ...prev, ...data }));
        
        // Populate Org Settings if present
        if (data['org.name']) {
          setOrgSettings({
            name: data['org.name'] || '',
            nameEn: data['org.nameEn'] || '',
            email: data['org.email'] || '',
            phone: data['org.phone'] || '',
            address: data['org.address'] || '',
            website: data['org.website'] || '',
            description: data['org.description'] || '',
          });
        }
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
      };

      // Save to API
      const authToken = getAuthToken();
      const response = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(settingsToSave),
      });

      if (!response.ok) throw new Error('Failed to save');

      toast({
        title: 'Success',
        description: locale === 'bn' ? 'সেটিংস সংরক্ষিত হয়েছে' : 'Settings saved successfully',
        variant: 'default',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

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
        <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full h-auto gap-2 bg-transparent p-0 mb-6">
          <TabsTrigger value="organization" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <Building2 className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'প্রতিষ্ঠান' : 'Organization'}</span>
          </TabsTrigger>
          <TabsTrigger value="landing" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <LayoutTemplate className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ল্যান্ডিং পেজ' : 'Landing Page'}</span>
          </TabsTrigger>
          <TabsTrigger value="loans" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <Wallet className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ঋণ নীতি' : 'Loan Policy'}</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <Bell className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'বিজ্ঞপ্তি' : 'Notifications'}</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <Shield className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'নিরাপত্তা' : 'Security'}</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-slate-200">
            <Palette className="h-4 w-4" />
            <span className="hidden md:inline">{locale === 'bn' ? 'ডিজাইন' : 'Appearance'}</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
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

          {/* Landing Page Settings */}
          <TabsContent value="landing">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
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
              <CardContent className="space-y-6">
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

                  <Separator />

                  <div className="space-y-2">
                    <Label>Welcome Back Message (Login Page)</Label>
                    <Input
                      value={landingSettings['auth.welcomeBack']}
                      onChange={(e) => setLandingSettings({ ...landingSettings, 'auth.welcomeBack': e.target.value })}
                      placeholder="e.g. Welcome Back!"
                    />
                    <p className="text-xs text-muted-foreground">The greeting message shown on the login screen.</p>
                  </div>

                  <Separator />

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
                          aspectRatio="aspect-[3/1]"
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
                          aspectRatio="aspect-[3/1]"
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
                            aspectRatio="aspect-[4/3]"
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

                  <Separator />

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
                            className="flex items-center gap-3 rounded-lg border border-slate-200 p-2"
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
        </div>
      </Tabs>
    </div>
  );
}
