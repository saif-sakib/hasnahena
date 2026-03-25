'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  Edit,
  Lock,
  Save,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { apiGet, apiPut } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface ProfileData {
  id: string;
  memberId: string;
  nameEn: string;
  nameBn: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  address: string;
  memberSince: string;
  lastUpdated: string;
  avatarUrl: string | null;
}

export default function AdminProfilePage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [editData, setEditData] = useState<Partial<ProfileData>>({});

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!getToken()) {
        router.replace(`/${locale}/login`);
        return;
      }

      const profile = await apiGet<any>('/v1/dashboard/admin/profile');
      setProfileData({
        id: profile.id,
        memberId: profile.memberId || '',
        nameEn: profile.nameEn || '',
        nameBn: profile.nameBn || '',
        email: profile.email || '',
        phone: profile.phone || '',
        role: profile.role || 'ADMIN',
        status: profile.status || 'ACTIVE',
        address: profile.address || '',
        memberSince: profile.memberSince || profile.joinedAt || '',
        lastUpdated: profile.lastUpdated || profile.joinedAt || '',
        avatarUrl: profile.avatarUrl,
      });
      setEditData({
        nameEn: profile.nameEn || '',
        nameBn: profile.nameBn || '',
        email: profile.email || '',
        phone: profile.phone || '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      setError(message);
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    const forceByQuery = searchParams.get('forcePasswordChange') === '1';
    const forceByStorage = typeof window !== 'undefined' && localStorage.getItem('hn_force_password_change') === '1';
    if (forceByQuery || forceByStorage) {
      setForcePasswordChange(true);
      setShowPasswordModal(true);
    }
  }, [searchParams]);

  const handleSave = async () => {
    if (!profileData) return;

    setIsSaving(true);
    try {
      if (!getToken()) throw new Error('Not authenticated');
      await apiPut('/v1/dashboard/admin/profile', editData as Record<string, unknown>);

      // Update local state with new data
      setProfileData(prev => prev ? {
        ...prev,
        ...editData,
        lastUpdated: new Date().toISOString(),
      } : null);

      setIsEditing(false);

      // Dispatch event to update header
      window.dispatchEvent(new Event('auth-change'));

      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description: locale === 'bn' ? 'প্রোফাইল আপডেট হয়েছে' : 'Profile updated successfully',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save profile';
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    // Reset edit data to current profile data
    if (profileData) {
      setEditData({
        nameEn: profileData.nameEn,
        nameBn: profileData.nameBn,
        email: profileData.email,
        phone: profileData.phone,
      });
    }
  };

  const handlePasswordChange = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'নতুন পাসওয়ার্ড মিলছে না' : 'New passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      if (!getToken()) throw new Error('Not authenticated');
      await apiPut('/v1/dashboard/password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });

      setShowPasswordModal(false);
      localStorage.removeItem('hn_force_password_change');
      setForcePasswordChange(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });

      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description: locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন হয়েছে' : 'Password changed successfully',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleAvatarChange = (newUrl: string) => {
    setProfileData(prev => prev ? { ...prev, avatarUrl: newUrl || null } : null);
    // Cache will be cleared on auth-change event from AvatarUpload
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return (
          <Badge className="bg-purple-100 text-purple-700">
            <Shield className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'সুপার অ্যাডমিন' : 'Super Admin'}
          </Badge>
        );
      case 'ADMIN':
        return (
          <Badge className="bg-blue-100 text-blue-700">
            <Shield className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'অ্যাডমিন' : 'Admin'}
          </Badge>
        );
      case 'WORKER':
        return (
          <Badge className="bg-green-100 text-green-700">
            <Shield className="h-3 w-3 mr-1" />
            {locale === 'bn' ? 'কর্মী' : 'Worker'}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-100 text-slate-700">
            <Shield className="h-3 w-3 mr-1" />
            {role}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
          <p className="mt-2 text-muted-foreground">
            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  if (error || !profileData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {locale === 'bn' ? 'প্রোফাইল লোড করতে ব্যর্থ' : 'Failed to load profile'}
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchProfile}>
            {locale === 'bn' ? 'আবার চেষ্টা করুন' : 'Try Again'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'প্রোফাইল' : 'Profile'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'bn' ? 'আপনার অ্যাকাউন্ট তথ্য পরিচালনা করুন' : 'Manage your account information'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPasswordModal(true)}>
            <Lock className="h-4 w-4 mr-2" />
            {locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন' : 'Change Password'}
          </Button>
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
                {locale === 'bn' ? 'বাতিল' : 'Cancel'}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setIsEditing(true)}>
              <Edit className="h-4 w-4 mr-2" />
              {locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
            </Button>
          )}
        </div>
      </div>

      {/* Profile Card */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <div className="flex flex-col items-center">
              <div className="relative">
                <AvatarUpload
                  currentAvatarUrl={profileData.avatarUrl}
                  userName={profileData.nameEn || profileData.nameBn}
                  size="xl"
                  editable={isEditing}
                  onUploadComplete={handleAvatarChange}
                />
              </div>
              <div className="mt-4 text-center">
                <h2 className="text-xl font-semibold">
                  {locale === 'bn' ? profileData.nameBn || profileData.nameEn : profileData.nameEn}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? profileData.nameEn : profileData.nameBn}
                </p>
                <div className="mt-2">{getRoleBadge(profileData.role)}</div>
              </div>
            </div>

            {/* Details */}
            <div className="flex-1 space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.nameBn || ''}
                      onChange={(e) => setEditData({ ...editData, nameBn: e.target.value })}
                      placeholder={locale === 'bn' ? 'বাংলায় নাম লিখুন' : 'Enter name in Bengali'}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                      {profileData.nameBn || '-'}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {locale === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.nameEn || ''}
                      onChange={(e) => setEditData({ ...editData, nameEn: e.target.value })}
                      placeholder={locale === 'bn' ? 'ইংরেজিতে নাম লিখুন' : 'Enter name in English'}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                      {profileData.nameEn || '-'}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {locale === 'bn' ? 'ইমেইল' : 'Email'}
                  </Label>
                  {isEditing ? (
                    <Input
                      type="email"
                      value={editData.email || ''}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      placeholder={locale === 'bn' ? 'ইমেইল লিখুন' : 'Enter email'}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                      {profileData.email || '-'}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {locale === 'bn' ? 'ফোন' : 'Phone'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.phone || ''}
                      onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                      placeholder={locale === 'bn' ? 'ফোন নম্বর লিখুন' : 'Enter phone number'}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                      {profileData.phone || '-'}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'ঠিকানা' : 'Address'}
                  </Label>
                  <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                    {profileData.address || (locale === 'bn' ? 'দেওয়া হয়নি' : 'Not provided')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}
                  </Label>
                  <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                    {profileData.memberSince
                      ? new Date(profileData.memberSince).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')
                      : '-'}
                  </p>
                </div>
              </div>

              {profileData.lastUpdated && (
                <div className="p-4 bg-slate-50 rounded-xl">
                  <p className="text-sm text-muted-foreground">
                    {locale === 'bn' ? 'সর্বশেষ আপডেট:' : 'Last Updated:'}{' '}
                    <span className="font-medium text-foreground">
                      {new Date(profileData.lastUpdated).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Status Card */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'অ্যাকাউন্ট স্থিতি' : 'Account Status'}</CardTitle>
          <CardDescription>
            {locale === 'bn' ? 'আপনার অ্যাকাউন্টের বর্তমান অবস্থা' : 'Your current account status'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 bg-emerald-50 rounded-xl text-center">
              <p className="text-sm text-muted-foreground mb-1">
                {locale === 'bn' ? 'অ্যাকাউন্ট স্ট্যাটাস' : 'Account Status'}
              </p>
              <Badge className={
                profileData.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                profileData.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }>
                {profileData.status === 'ACTIVE' ? (locale === 'bn' ? 'সক্রিয়' : 'Active') :
                 profileData.status === 'PENDING' ? (locale === 'bn' ? 'অপেক্ষমান' : 'Pending') :
                 profileData.status}
              </Badge>
            </div>
            <div className="p-4 bg-blue-50 rounded-xl text-center">
              <p className="text-sm text-muted-foreground mb-1">
                {locale === 'bn' ? 'ভূমিকা' : 'Role'}
              </p>
              {getRoleBadge(profileData.role)}
            </div>
            <div className="p-4 bg-purple-50 rounded-xl text-center">
              <p className="text-sm text-muted-foreground mb-1">
                {locale === 'bn' ? 'সদস্য আইডি' : 'Member ID'}
              </p>
              <p className="text-lg font-semibold text-purple-700">
                {profileData.memberId || '-'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Modal */}
      <Dialog
        open={showPasswordModal}
        onOpenChange={(open) => {
          if (forcePasswordChange && !open) return;
          setShowPasswordModal(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন' : 'Change Password'}</DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? 'আপনার নতুন পাসওয়ার্ড সেট করুন'
                : 'Set your new password'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'বর্তমান পাসওয়ার্ড' : 'Current Password'}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordData.currentPassword}
                  onChange={(e) =>
                    setPasswordData({ ...passwordData, currentPassword: e.target.value })
                  }
                  placeholder={locale === 'bn' ? 'বর্তমান পাসওয়ার্ড লিখুন' : 'Enter current password'}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}</Label>
              <Input
                type="password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                placeholder={locale === 'bn' ? 'নতুন পাসওয়ার্ড লিখুন' : 'Enter new password'}
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm New Password'}</Label>
              <Input
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) =>
                  setPasswordData({ ...passwordData, confirmPassword: e.target.value })
                }
                placeholder={locale === 'bn' ? 'নতুন পাসওয়ার্ড আবার লিখুন' : 'Confirm new password'}
              />
            </div>
          </div>
          <DialogFooter>
            {!forcePasswordChange && (
              <Button
                variant="outline"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                }}
                disabled={isChangingPassword}
              >
                {locale === 'bn' ? 'বাতিল' : 'Cancel'}
              </Button>
            )}
            <Button
              onClick={handlePasswordChange}
              disabled={
                isChangingPassword ||
                !passwordData.currentPassword ||
                !passwordData.newPassword ||
                passwordData.newPassword !== passwordData.confirmPassword ||
                passwordData.newPassword.length < 6
              }
            >
              {isChangingPassword ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {locale === 'bn' ? 'পরিবর্তন করুন' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
