'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Camera,
  Edit,
  Lock,
  Save,
  Eye,
  EyeOff,
  Briefcase,
  Users,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function WorkerProfilePage() {
  const locale = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Mock worker data
  const [workerData, setWorkerData] = useState({
    name: 'রফিকুল ইসলাম',
    nameEn: 'Rafiqul Islam',
    email: 'rafiqul.worker@hasnahena.org',
    phone: '01711111111',
    assignedArea: 'ঢাকা উত্তর',
    joinDate: '2023-06-15',
    lastActive: '2025-01-14T10:30:00',
    address: 'মিরপুর, ঢাকা',
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Activity stats
  const stats = {
    totalMembers: 45,
    processedDeposits: 156,
    processedLoans: 45,
    thisMonthTransactions: 89,
  };

  const handleSave = () => {
    console.log('Saving worker data:', workerData);
    setIsEditing(false);
  };

  const handlePasswordChange = () => {
    console.log('Changing password');
    setShowPasswordModal(false);
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {locale === 'bn' ? 'আমার প্রোফাইল' : 'My Profile'}
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
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              {locale === 'bn' ? 'সংরক্ষণ' : 'Save'}
            </Button>
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
                <div className="h-32 w-32 rounded-full bg-primary/10 flex items-center justify-center text-primary text-4xl font-semibold">
                  {workerData.name.charAt(0)}
                </div>
                {isEditing && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute bottom-0 right-0 rounded-full"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="mt-4 text-center">
                <h2 className="text-xl font-semibold">{workerData.name}</h2>
                <p className="text-sm text-muted-foreground">{workerData.nameEn}</p>
                <Badge className="mt-2 bg-blue-100 text-blue-700">
                  <Briefcase className="h-3 w-3 mr-1" />
                  {locale === 'bn' ? 'কর্মী' : 'Worker'}
                </Badge>
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
                      value={workerData.name}
                      onChange={(e) => setWorkerData({ ...workerData, name: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {locale === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={workerData.nameEn}
                      onChange={(e) => setWorkerData({ ...workerData, nameEn: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.nameEn}</p>
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
                      value={workerData.email}
                      onChange={(e) => setWorkerData({ ...workerData, email: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {locale === 'bn' ? 'ফোন' : 'Phone'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={workerData.phone}
                      onChange={(e) => setWorkerData({ ...workerData, phone: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.phone}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'নির্ধারিত এলাকা' : 'Assigned Area'}
                  </Label>
                  <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.assignedArea}</p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'ঠিকানা' : 'Address'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={workerData.address}
                      onChange={(e) => setWorkerData({ ...workerData, address: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{workerData.address}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}
                  </Label>
                  <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                    {new Date(workerData.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'সর্বশেষ সক্রিয়:' : 'Last Active:'}{' '}
                  <span className="font-medium text-foreground">
                    {new Date(workerData.lastActive).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Stats */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'কার্যক্রম সারসংক্ষেপ' : 'Activity Summary'}</CardTitle>
          <CardDescription>
            {locale === 'bn' ? 'আপনার কর্মদক্ষতার পরিসংখ্যান' : 'Your performance statistics'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-4 bg-blue-50 rounded-xl text-center">
              <Users className="h-8 w-8 mx-auto text-blue-600 mb-2" />
              <p className="text-3xl font-bold text-blue-600">{stats.totalMembers}</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'নির্ধারিত সদস্য' : 'Assigned Members'}
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-xl text-center">
              <TrendingUp className="h-8 w-8 mx-auto text-green-600 mb-2" />
              <p className="text-3xl font-bold text-green-600">{stats.processedDeposits}</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'প্রসেসকৃত জমা' : 'Processed Deposits'}
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-xl text-center">
              <Receipt className="h-8 w-8 mx-auto text-purple-600 mb-2" />
              <p className="text-3xl font-bold text-purple-600">{stats.processedLoans}</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'প্রসেসকৃত ঋণ কিস্তি' : 'Loan Payments'}
              </p>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl text-center">
              <Receipt className="h-8 w-8 mx-auto text-amber-600 mb-2" />
              <p className="text-3xl font-bold text-amber-600">{stats.thisMonthTransactions}</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'এই মাসের লেনদেন' : 'This Month'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Modal */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              onClick={handlePasswordChange}
              disabled={
                !passwordData.currentPassword ||
                !passwordData.newPassword ||
                passwordData.newPassword !== passwordData.confirmPassword
              }
            >
              {locale === 'bn' ? 'পরিবর্তন করুন' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
