'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
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
  Check,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet } from '@/lib/api';

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

export default function ProfilePage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [isEditingNominee, setIsEditingNominee] = useState(false);
  const [showWithdrawalForm, setShowWithdrawalForm] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');

  const [profile, setProfile] = useState<UserProfile>({
    memberId: '',
    accountNumber: '',
    nameEn: '',
    nameBn: '',
    fatherName: '',
    motherName: '',
    phone: '',
    email: '',
    nidNumber: '',
    dateOfBirth: '',
    maritalStatus: 'UNMARRIED',
    gender: 'MALE',
    permanentAddress: {
      houseNo: '',
      village: '',
      union: '',
      policeStation: '',
      district: '',
    },
    presentAddress: {
      houseNo: '',
      village: '',
      union: '',
      policeStation: '',
      district: '',
    },
    memberSince: '',
    status: 'PENDING',
  });

  const [nominee, setNominee] = useState<Nominee>({
    name: '',
    relationship: '',
    nidNumber: '',
    phone: '',
  });

  const [editedNominee, setEditedNominee] = useState<Nominee>({ ...nominee });

  const [accountSummary, setAccountSummary] = useState({
    currentBalance: 0,
    hasActiveLoan: false,
    isGuarantor: false,
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await apiGet<{
          profile: UserProfile;
          nominee: Nominee;
          accountSummary: {
            currentBalance: number;
            hasActiveLoan: boolean;
            isGuarantor: boolean;
          };
        }>('/v1/dashboard/member/profile');
        setProfile(data.profile);
        setNominee(data.nominee);
        setEditedNominee(data.nominee);
        setAccountSummary(data.accountSummary);
      } catch {
        setProfile((prev) => ({ ...prev }));
      }
    };
    loadProfile();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatAddress = (addr: UserProfile['permanentAddress']) => {
    return `${addr.houseNo}, ${addr.village}, ${addr.union}, ${addr.policeStation}, ${addr.district}`;
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

  const handleWithdrawalRequest = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Call API to submit withdrawal request
    console.log('Withdrawal request:', withdrawalAmount);
    setShowWithdrawalForm(false);
    setWithdrawalAmount('');
  };

  const canWithdraw = !accountSummary.hasActiveLoan && !accountSummary.isGuarantor;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Profile Header */}
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-24 w-24 rounded-full bg-white/20 flex items-center justify-center text-white text-4xl font-bold border-4 border-white/30">
              {profile.nameBn.charAt(0)}
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

      {/* Withdrawal Request */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-600" />
            {t('requestWithdrawal')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!canWithdraw ? (
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-amber-800">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{t('withdrawalBlocked')}</p>
                <p className="text-sm mt-1">
                  {accountSummary.hasActiveLoan &&
                    (locale === 'bn'
                      ? 'আপনার সক্রিয় ঋণ থাকায় উত্তোলন সম্ভব নয়।'
                      : 'You have an active loan that prevents withdrawal.')}
                  {accountSummary.isGuarantor &&
                    (locale === 'bn'
                      ? 'আপনি অন্য সদস্যের জামিনদার হওয়ায় উত্তোলন সম্ভব নয়।'
                      : 'You are a guarantor for another member.')}
                </p>
              </div>
            </div>
          ) : showWithdrawalForm ? (
            <form onSubmit={handleWithdrawalRequest} className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-50 text-blue-800 text-sm">
                <p className="font-medium">{t('withdrawalNotice')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="withdrawalAmount">{t('withdrawalAmount')}</Label>
                <Input
                  id="withdrawalAmount"
                  type="number"
                  placeholder={t('enterAmount')}
                  value={withdrawalAmount}
                  onChange={(e) => setWithdrawalAmount(e.target.value)}
                  max={accountSummary.currentBalance}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {locale === 'bn' ? 'উপলব্ধ:' : 'Available:'} {formatCurrency(accountSummary.currentBalance)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="gap-1">
                  <Check className="h-4 w-4" />
                  {t('submitRequest')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowWithdrawalForm(false)}>
                  {locale === 'bn' ? 'বাতিল' : 'Cancel'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('currentBalance')}</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(accountSummary.currentBalance)}</p>
              </div>
              <Button onClick={() => setShowWithdrawalForm(true)}>
                {t('requestWithdrawal')}
              </Button>
            </div>
          )}
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
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              {t('downloadStatement')}
            </Button>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              {locale === 'bn' ? 'সদস্যপদ সার্টিফিকেট' : 'Membership Certificate'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
