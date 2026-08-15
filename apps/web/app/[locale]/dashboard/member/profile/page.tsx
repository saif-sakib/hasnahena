'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  User,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  UserCheck,
  Edit2,
  Save,
  X,
  Shield,
  Users,
  FileText,
  Download,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AvatarUpload } from '@/components/ui/avatar-upload';
import { apiGet } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PasswordChangeDialog } from '@/components/ui/password-change-dialog';
import { getValidatedClientToken } from '@/lib/client-auth';
import {
  downloadDocumentPDF,
  buildMembershipCertificate,
  buildStatement,
  fetchOrgSettings,
} from '@/lib/documents';

interface UserProfile {
  memberId: string;
  accountNumber: string;
  nameEn: string;
  nameBn: string;
  fatherName: string;
  motherName: string;
  phone: string;
  email?: string;
  nidNumber: string;
  dateOfBirth: string;
  maritalStatus: 'UNMARRIED' | 'MARRIED';
  gender: 'MALE' | 'FEMALE';
  permanentAddress: {
    houseNo: string;
    village: string;
    union: string;
    policeStation: string;
    district: string;
  };
  presentAddress: {
    houseNo: string;
    village: string;
    union: string;
    policeStation: string;
    district: string;
  };
  memberSince: string;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
  avatarUrl?: string;
}

interface Nominee {
  name: string;
  relationship: string;
  nidNumber: string;
  phone?: string;
}

interface MemberTransaction {
  type: string;
  amount: number;
  date: string;
  balanceAfter: number;
  description?: string;
  receiptNumber?: string;
}

export default function ProfilePage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [isEditingNominee, setIsEditingNominee] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const emptyAddress: UserProfile['permanentAddress'] = {
    houseNo: '',
    village: '',
    union: '',
    policeStation: '',
    district: '',
  };

  const emptyProfile: UserProfile = {
    memberId: '',
    accountNumber: '',
    nameEn: '',
    nameBn: '',
    fatherName: '',
    motherName: '',
    phone: '',
    email: undefined,
    nidNumber: '',
    dateOfBirth: '',
    maritalStatus: 'UNMARRIED',
    gender: 'MALE',
    permanentAddress: emptyAddress,
    presentAddress: emptyAddress,
    memberSince: '',
    status: 'PENDING',
    avatarUrl: undefined,
  };

  const emptyNominee: Nominee = {
    name: '',
    relationship: '',
    nidNumber: '',
    phone: undefined,
  };

  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [nominee, setNominee] = useState<Nominee>(emptyNominee);
  const [editedNominee, setEditedNominee] = useState<Nominee>(emptyNominee);
  const [accountSummary, setAccountSummary] = useState({
    currentBalance: 0,
    hasActiveLoan: false,
    isGuarantor: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloadingDocument, setIsDownloadingDocument] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    const token = getValidatedClientToken();
    if (!token) {
      router.push(`/${locale}/login`);
      return;
    }

    setIsLoading(true);
    setActionError(null);
    try {
      const profileData = await apiGet<{
        profile?: UserProfile;
        nominee?: Nominee;
        accountSummary?: {
          currentBalance?: number;
          hasActiveLoan?: boolean;
          isGuarantor?: boolean;
        };
      }>('/v1/dashboard/member/profile');
      const p = profileData?.profile;
      const n = profileData?.nominee;

      setProfile({
        memberId: p?.memberId ?? '',
        accountNumber: p?.accountNumber ?? '',
        nameEn: p?.nameEn ?? '',
        nameBn: p?.nameBn ?? '',
        fatherName: p?.fatherName ?? '',
        motherName: p?.motherName ?? '',
        phone: p?.phone ?? '',
        email: p?.email,
        nidNumber: p?.nidNumber ?? '',
        dateOfBirth: p?.dateOfBirth ?? '',
        maritalStatus: p?.maritalStatus ?? 'UNMARRIED',
        gender: p?.gender === 'FEMALE' ? 'FEMALE' : 'MALE',
        permanentAddress: p?.permanentAddress ?? emptyAddress,
        presentAddress: p?.presentAddress ?? emptyAddress,
        memberSince: p?.memberSince ?? '',
        status: p?.status === 'ACTIVE' ? 'ACTIVE' : p?.status === 'SUSPENDED' ? 'SUSPENDED' : 'PENDING',
        avatarUrl: p?.avatarUrl ?? undefined,
      });

      setNominee({
        name: n?.name ?? '',
        relationship: n?.relationship ?? '',
        nidNumber: n?.nidNumber ?? '',
        phone: n?.phone,
      });
      setEditedNominee({
        name: n?.name ?? '',
        relationship: n?.relationship ?? '',
        nidNumber: n?.nidNumber ?? '',
        phone: n?.phone,
      });

      setAccountSummary({
        currentBalance: profileData?.accountSummary?.currentBalance ?? 0,
        hasActiveLoan: profileData?.accountSummary?.hasActiveLoan ?? false,
        isGuarantor: profileData?.accountSummary?.isGuarantor ?? false,
      });
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);


  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatAddress = (addr: UserProfile['permanentAddress']) => {
    return [addr.houseNo, addr.village, addr.union, addr.policeStation, addr.district]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
  };

  const handleSaveNominee = () => {
    // TODO: Call API to update nominee
    console.log('Saving nominee:', editedNominee);
    setNominee({ ...editedNominee });
    setIsEditingNominee(false);
  };

  const handleCancelNomineeEdit = () => {
    setEditedNominee({ ...nominee });
    setIsEditingNominee(false);
  };

  const handleDownloadStatement = async () => {
    setIsDownloadingDocument(true);
    setActionError(null);
    try {
      const orgSettings = await fetchOrgSettings();
      const transactions = await apiGet<MemberTransaction[]>('/v1/dashboard/member/transactions');
      const statementTransactions = (transactions ?? [])
        .filter((tx) => tx.type === 'DEPOSIT' || tx.type === 'WITHDRAWAL')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const first = statementTransactions[0];
      const openingBalanceBdt = first
        ? (first.type === 'DEPOSIT' ? first.balanceAfter - first.amount : first.balanceAfter + first.amount)
        : accountSummary.currentBalance;

      const totalDepositsBdt = statementTransactions
        .filter((tx) => tx.type === 'DEPOSIT')
        .reduce((sum, tx) => sum + tx.amount, 0);

      const totalWithdrawalsBdt = statementTransactions
        .filter((tx) => tx.type === 'WITHDRAWAL')
        .reduce((sum, tx) => sum + tx.amount, 0);

      const now = new Date().toISOString();
      const statementDoc = buildStatement(
        {
          memberName: profile.nameEn || profile.nameBn,
          memberId: profile.memberId || 'N/A',
          memberPhone: profile.phone || 'N/A',
          periodStart: statementTransactions[0]?.date || now,
          periodEnd: statementTransactions[statementTransactions.length - 1]?.date || now,
          openingBalance: Math.round(openingBalanceBdt ),
          closingBalance: Math.round(accountSummary.currentBalance ),
          totalDeposits: Math.round(totalDepositsBdt ),
          totalWithdrawals: Math.round(totalWithdrawalsBdt ),
          transactions: statementTransactions.map((tx) => ({
            date: tx.date,
            type: tx.type,
            amount: Math.round(tx.amount ),
            balance: Math.round(tx.balanceAfter ),
            description: tx.description,
            receiptNumber: tx.receiptNumber,
          })),
        },
        orgSettings
      );

      await downloadDocumentPDF(statementDoc);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to generate statement');
    } finally {
      setIsDownloadingDocument(false);
    }
  };

  const handleDownloadCertificate = async () => {
    setActionError(null);
    try {
      const orgSettings = await fetchOrgSettings();
      const certificateDoc = buildMembershipCertificate(
        {
          memberName: profile.nameEn || profile.nameBn,
          memberId: profile.memberId || 'N/A',
          accountNumber: profile.accountNumber || undefined,
          memberSince: profile.memberSince || new Date().toISOString(),
          phone: profile.phone || undefined,
          address: formatAddress(profile.permanentAddress),
        },
        orgSettings
      );
      await downloadDocumentPDF(certificateDoc);
    } catch (e: any) {
      setActionError(e?.message ?? 'Failed to generate certificate');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-muted-foreground">{locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Profile Header */}
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-24 w-24 rounded-full bg-white/20 flex items-center justify-center text-white text-4xl font-bold border-4 border-white/30">
              <AvatarUpload
                currentAvatarUrl={profile.avatarUrl}
                userName={locale === 'bn' ? profile.nameBn || profile.nameEn : profile.nameEn || profile.nameBn}
                size="lg"
                editable
                onUploadComplete={(avatarUrl) =>
                  setProfile((prev) => ({ ...prev, avatarUrl: avatarUrl || undefined }))
                }
              />
            </div>
            <div className="text-center sm:text-left text-white flex-1">
              <h2 className="text-2xl font-bold">{locale === 'bn' ? profile.nameBn : profile.nameEn}</h2>
              <p className="opacity-90">{profile.memberId}</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center sm:justify-start">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-white/20">
                  <CreditCard className="h-3 w-3" />
                  {profile.accountNumber}
                </span>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm ${
                  profile.status === 'ACTIVE' ? 'bg-green-500' : 'bg-amber-500'
                }`}>
                  <UserCheck className="h-3 w-3" />
                  {profile.status === 'ACTIVE'
                    ? locale === 'bn' ? 'সক্রিয়' : 'Active'
                    : locale === 'bn' ? 'অপেক্ষমান' : 'Pending'}
                </span>
              </div>
            </div>
            <div className="text-center sm:text-right text-white">
              <Button variant="secondary" size="sm" className="mb-3" onClick={() => setShowPasswordModal(true)}>
                <Lock className="h-4 w-4 mr-2" />
                {locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন' : 'Change Password'}
              </Button>
              <p className="text-sm opacity-80">{t('memberSince')}</p>
              <p className="font-semibold">{formatDate(profile.memberSince)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Personal Information */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-emerald-600" />
            {t('personalInfo')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('fullName')}</p>
              <p className="font-medium">{locale === 'bn' ? profile.nameBn : profile.nameEn}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('fatherName')}</p>
              <p className="font-medium">{profile.fatherName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('motherName')}</p>
              <p className="font-medium">{profile.motherName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('dateOfBirth')}</p>
              <p className="font-medium">{formatDate(profile.dateOfBirth)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('maritalStatus')}</p>
              <p className="font-medium">
                {profile.maritalStatus === 'MARRIED'
                  ? locale === 'bn' ? 'বিবাহিত' : 'Married'
                  : locale === 'bn' ? 'অবিবাহিত' : 'Unmarried'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('nidNumber')}</p>
              <p className="font-medium">{profile.nidNumber}</p>
            </div>
          </div>

          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {locale === 'bn' ? 'যোগাযোগ তথ্য' : 'Contact Information'}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('phone')}</p>
                <p className="font-medium">{profile.phone}</p>
              </div>
              {profile.email && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('email')}</p>
                  <p className="font-medium">{profile.email}</p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {t('address')}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('permanentAddress')}</p>
                <p className="font-medium">{formatAddress(profile.permanentAddress)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('presentAddress')}</p>
                <p className="font-medium">{formatAddress(profile.presentAddress)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Nominee Information */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              {t('nomineeInfo')}
            </CardTitle>
            {!isEditingNominee && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setIsEditingNominee(true)}
              >
                <Edit2 className="h-3 w-3" />
                {locale === 'bn' ? 'সম্পাদনা' : 'Edit'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isEditingNominee ? (
            <form className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nomineeName">{t('nomineeName')}</Label>
                  <Input
                    id="nomineeName"
                    value={editedNominee.name}
                    onChange={(e) => setEditedNominee({ ...editedNominee, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nomineeRelation">{t('nomineeRelation')}</Label>
                  <Input
                    id="nomineeRelation"
                    value={editedNominee.relationship}
                    onChange={(e) => setEditedNominee({ ...editedNominee, relationship: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nomineeNid">{t('nomineeNid')}</Label>
                  <Input
                    id="nomineeNid"
                    value={editedNominee.nidNumber}
                    onChange={(e) => setEditedNominee({ ...editedNominee, nidNumber: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nomineePhone">{t('phone')}</Label>
                  <Input
                    id="nomineePhone"
                    value={editedNominee.phone || ''}
                    onChange={(e) => setEditedNominee({ ...editedNominee, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={handleSaveNominee} className="gap-1">
                  <Save className="h-4 w-4" />
                  {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
                </Button>
                <Button type="button" variant="outline" onClick={handleCancelNomineeEdit}>
                  <X className="h-4 w-4 mr-1" />
                  {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('nomineeName')}</p>
                <p className="font-medium">{nominee.name}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('nomineeRelation')}</p>
                <p className="font-medium">{nominee.relationship}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('nomineeNid')}</p>
                <p className="font-medium">{nominee.nidNumber}</p>
              </div>
              {nominee.phone && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('phone')}</p>
                  <p className="font-medium">{nominee.phone}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account Summary */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-600" />
            {locale === 'bn' ? 'একাউন্ট সারাংশ' : 'Account Summary'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('currentBalance')}</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(accountSummary.currentBalance, locale)}</p>
              </div>
            </div>
            
            {/* Status indicators */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={`flex items-center gap-2 p-3 rounded-lg ${accountSummary.hasActiveLoan ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">
                  {accountSummary.hasActiveLoan
                    ? (locale === 'bn' ? 'সক্রিয় ঋণ আছে' : 'Has Active Loan')
                    : (locale === 'bn' ? 'কোন সক্রিয় ঋণ নেই' : 'No Active Loan')}
                </span>
              </div>
              <div className={`flex items-center gap-2 p-3 rounded-lg ${accountSummary.isGuarantor ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
                <Users className="h-4 w-4" />
                <span className="text-sm">
                  {accountSummary.isGuarantor
                    ? (locale === 'bn' ? 'জামিনদার হিসেবে আছেন' : 'Serving as Guarantor')
                    : (locale === 'bn' ? 'জামিনদার নন' : 'Not a Guarantor')}
                </span>
              </div>
            </div>

            {/* Info Notice */}
            <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-4 text-blue-800">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm">
                  {locale === 'bn'
                    ? 'আমানত জমা বা উত্তোলন করতে চাইলে অফিসে যোগাযোগ করুন অথবা কাস্টমার সাপোর্টে মেসেজ করুন।'
                    : 'To make a deposit or withdrawal, please visit the office or contact customer support.'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            {locale === 'bn' ? 'ডকুমেন্ট' : 'Documents'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void handleDownloadStatement()}
              disabled={isDownloadingDocument}
            >
              <Download className="h-4 w-4" />
              {t('downloadStatement')}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void handleDownloadCertificate()}
              disabled={isDownloadingDocument}
            >
              <Download className="h-4 w-4" />
              {locale === 'bn' ? 'সদস্যপদ সার্টিফিকেট' : 'Membership Certificate'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <PasswordChangeDialog
        locale={locale}
        open={showPasswordModal}
        onOpenChange={setShowPasswordModal}
      />
    </div>
  );
}
