'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Edit, Lock, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import { PasswordChangeDialog } from '@/components/ui/password-change-dialog';
import { toast } from '@/hooks/use-toast';
import { apiPut } from '@/lib/api';
import { useApi, useRedirectOnUnauthorized } from '@/lib/use-api';
import { useLocalStorageValue } from '@/lib/use-storage';
import { getStatusStyle, getStatusLabel } from '@/lib/status-styles';

interface ProfileData {
  id: string;
  accountNo: string;
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

interface ProfileEditorProps {
  role: 'admin' | 'worker';
}

export function ProfileEditor({ role }: ProfileEditorProps) {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const apiPath = `/v1/dashboard/${role}/profile`;
  const defaultRole = role.toUpperCase();

  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const { data: profile, error, isLoading, refresh: fetchProfile } = useApi<any>(apiPath);
  useRedirectOnUnauthorized(error);

  const profileData = useMemo<ProfileData | null>(() => {
    if (!profile) return null;
    return {
      id: profile.id,
      accountNo: profile.accountNo || '',
      nameEn: profile.nameEn || '',
      nameBn: profile.nameBn || '',
      email: profile.email || '',
      phone: profile.phone || '',
      role: profile.role || defaultRole,
      status: profile.status || 'ACTIVE',
      address: profile.address || '',
      memberSince: profile.memberSince || profile.joinedAt || '',
      lastUpdated: profile.lastUpdated || profile.joinedAt || '',
      avatarUrl: profile.avatarUrl,
    };
  }, [profile, defaultRole]);

  // The form draft: empty until the reader types, then theirs. Seeding it from
  // the fetch was the second half of the old effect.
  const [edits, setEdits] = useState<Partial<ProfileData>>({});
  const editData = useMemo<Partial<ProfileData>>(
    () => ({
      nameEn: profileData?.nameEn ?? '',
      nameBn: profileData?.nameBn ?? '',
      email: profileData?.email ?? '',
      phone: profileData?.phone ?? '',
      ...edits,
    }),
    [profileData, edits],
  );
  const setEditData = (next: Partial<ProfileData>) => setEdits(next);

  // Derived, not stored. A forced password change is a fact about the URL and
  // localStorage, so it is read rather than copied into state by an effect —
  // which is what the old code did, and which could not un-say it once the
  // query parameter went away.
  //
  // localStorage goes through useLocalStorageValue rather than being read
  // inline: this component is server-rendered for the initial HTML, where there
  // is no localStorage, and a direct read there is a hydration mismatch.
  const forcedFlag = useLocalStorageValue('hn_force_password_change');
  const [passwordChanged, setPasswordChanged] = useState(false);
  const forcePasswordChange =
    !passwordChanged &&
    (searchParams.get('forcePasswordChange') === '1' || forcedFlag === '1');

  const [passwordModalDismissed, setPasswordModalDismissed] = useState(false);
  const [passwordModalOpened, setPasswordModalOpened] = useState(false);
  const showPasswordModal = passwordModalOpened || (forcePasswordChange && !passwordModalDismissed);

  const handleSave = async () => {
    if (!profileData) return;
    setIsSaving(true);
    try {
      await apiPut(apiPath, editData as Record<string, unknown>);
      // Re-read rather than patch locally: lastUpdated is the server's to set,
      // and guessing it here printed a timestamp that did not match the row.
      await fetchProfile();
      setEdits({});
      setIsEditing(false);
      window.dispatchEvent(new Event('auth-change'));
      toast({ title: locale === 'bn' ? 'সফল' : 'Success', description: locale === 'bn' ? 'প্রোফাইল আপডেট হয়েছে' : 'Profile updated', variant: 'success' });
    } catch (err) {
      toast({ title: locale === 'bn' ? 'ত্রুটি' : 'Error', description: err instanceof Error ? err.message : 'Failed to save', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    // Dropping the draft restores the fetched values, which is what "cancel"
    // has always meant here.
    setEdits({});
  };

  const handleAvatarChange = () => {
    // The upload has already written the URL server-side.
    void fetchProfile();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  if (error || !profileData) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-600 mb-2">{error || 'Failed to load profile'}</p>
        <Button variant="outline" size="sm" onClick={() => void fetchProfile()}>{locale === 'bn' ? 'আবার চেষ্টা করুন' : 'Try Again'}</Button>
      </div>
    );
  }

  const formatDate = (iso: string) => iso ? new Date(iso).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB') : '-';

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{locale === 'bn' ? 'প্রোফাইল' : 'Profile'}</h1>
          <p className="text-sm text-gray-500">{locale === 'bn' ? 'আপনার অ্যাকাউন্ট তথ্য' : 'Your account information'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPasswordModalOpened(true)} className="h-8">
            <Lock className="h-3.5 w-3.5 mr-1" />{locale === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
          </Button>
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving} className="h-8">{locale === 'bn' ? 'বাতিল' : 'Cancel'}</Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={isSaving} className="h-8">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setIsEditing(true)} className="h-8">
              <Edit className="h-3.5 w-3.5 mr-1" />{locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
            </Button>
          )}
        </div>
      </div>

      {forcePasswordChange && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-sm text-amber-700">
          {locale === 'bn' ? 'নিরাপত্তার জন্য আপনার পাসওয়ার্ড পরিবর্তন করুন' : 'Please change your password for security'}
        </div>
      )}

      {/* Profile Card */}
      <div className="border border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-200 flex items-center gap-4">
          <AvatarUpload
            currentAvatarUrl={profileData.avatarUrl}
            userName={profileData.nameEn || profileData.nameBn}
            size="lg"
            editable={isEditing}
            onUploadComplete={handleAvatarChange}
          />
          <div>
            <h2 className="text-lg font-medium text-gray-900">{locale === 'bn' ? profileData.nameBn || profileData.nameEn : profileData.nameEn}</h2>
            <p className="text-sm text-gray-500">{locale === 'bn' ? profileData.nameEn : profileData.nameBn}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 text-xs rounded ${getStatusStyle(profileData.role)}`}>{getStatusLabel(profileData.role, locale)}</span>
              <span className={`px-2 py-0.5 text-xs rounded ${getStatusStyle(profileData.status)}`}>{getStatusLabel(profileData.status, locale)}</span>
            </div>
          </div>
        </div>

        <div className="p-4">
          {isEditing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-sm">{locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}</Label>
                <Input value={editData.nameBn || ''} onChange={(e) => setEditData({ ...editData, nameBn: e.target.value })} className="mt-1" placeholder={locale === 'bn' ? 'বাংলায় নাম' : 'Name in Bengali'} />
              </div>
              <div>
                <Label className="text-sm">{locale === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}</Label>
                <Input value={editData.nameEn || ''} onChange={(e) => setEditData({ ...editData, nameEn: e.target.value })} className="mt-1" placeholder={locale === 'bn' ? 'ইংরেজিতে নাম' : 'Name in English'} />
              </div>
              <div>
                <Label className="text-sm">{locale === 'bn' ? 'ইমেইল' : 'Email'}</Label>
                <Input type="email" value={editData.email || ''} onChange={(e) => setEditData({ ...editData, email: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">{locale === 'bn' ? 'ফোন' : 'Phone'}</Label>
                <Input value={editData.phone || ''} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} className="mt-1" />
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500 w-1/3">{locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}</td>
                  <td className="py-2 font-medium">{profileData.nameBn || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}</td>
                  <td className="py-2 font-medium">{profileData.nameEn || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'ইমেইল' : 'Email'}</td>
                  <td className="py-2">{profileData.email || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'ফোন' : 'Phone'}</td>
                  <td className="py-2">{profileData.phone || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'অ্যাকাউন্ট নং' : 'Account No'}</td>
                  <td className="py-2 font-mono text-xs">{profileData.accountNo || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'ঠিকানা' : 'Address'}</td>
                  <td className="py-2">{profileData.address || '-'}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'যোগদানের তারিখ' : 'Member Since'}</td>
                  <td className="py-2">{formatDate(profileData.memberSince)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-500">{locale === 'bn' ? 'সর্বশেষ আপডেট' : 'Last Updated'}</td>
                  <td className="py-2">{formatDate(profileData.lastUpdated)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <PasswordChangeDialog
        locale={locale}
        open={showPasswordModal}
        onOpenChange={(open) => {
          setPasswordModalOpened(open);
          if (!open) setPasswordModalDismissed(true);
        }}
        forcePasswordChange={forcePasswordChange}
        onPasswordChanged={() => {
          localStorage.removeItem('hn_force_password_change');
          setPasswordChanged(true);
          setPasswordModalOpened(false);
        }}
      />
    </div>
  );
}
