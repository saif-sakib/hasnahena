'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  Camera,
  Edit,
  Lock,
  Save,
  Eye,
  EyeOff,
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

export default function AdminProfilePage() {
  const locale = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Mock admin data
  const [adminData, setAdminData] = useState({
    name: 'নাজমুল হক',
    nameEn: 'Nazmul Haque',
    email: 'nazmul.admin@hasnahena.org',
    phone: '01733333333',
    role: 'SUPER_ADMIN',
    joinDate: '2023-01-01',
    lastLogin: '2025-01-14T10:30:00',
    address: 'ঢাকা, বাংলাদেশ',
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleSave = () => {
    console.log('Saving admin data:', adminData);
    setIsEditing(false);
  };

  const handlePasswordChange = () => {
    console.log('Changing password');
    setShowPasswordModal(false);
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
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
      default:
        return null;
    }
  };

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
                  {adminData.name.charAt(0)}
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
                <h2 className="text-xl font-semibold">{adminData.name}</h2>
                <p className="text-sm text-muted-foreground">{adminData.nameEn}</p>
                <div className="mt-2">{getRoleBadge(adminData.role)}</div>
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
                      value={adminData.name}
                      onChange={(e) => setAdminData({ ...adminData, name: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{adminData.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {locale === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={adminData.nameEn}
                      onChange={(e) => setAdminData({ ...adminData, nameEn: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{adminData.nameEn}</p>
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
                      value={adminData.email}
                      onChange={(e) => setAdminData({ ...adminData, email: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{adminData.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {locale === 'bn' ? 'ফোন' : 'Phone'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={adminData.phone}
                      onChange={(e) => setAdminData({ ...adminData, phone: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{adminData.phone}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {locale === 'bn' ? 'ঠিকানা' : 'Address'}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={adminData.address}
                      onChange={(e) => setAdminData({ ...adminData, address: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium p-2 bg-slate-50 rounded">{adminData.address}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {locale === 'bn' ? 'যোগদানের তারিখ' : 'Join Date'}
                  </Label>
                  <p className="text-sm font-medium p-2 bg-slate-50 rounded">
                    {new Date(adminData.joinDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-sm text-muted-foreground">
                  {locale === 'bn' ? 'সর্বশেষ লগইন:' : 'Last Login:'}{' '}
                  <span className="font-medium text-foreground">
                    {new Date(adminData.lastLogin).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Summary */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'কার্যক্রম সারসংক্ষেপ' : 'Activity Summary'}</CardTitle>
          <CardDescription>
            {locale === 'bn' ? 'আপনার সাম্প্রতিক কার্যক্রম' : 'Your recent activity'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 bg-blue-50 rounded-xl text-center">
              <p className="text-3xl font-bold text-blue-600">89</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'অনুমোদিত ঋণ' : 'Loans Approved'}
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-xl text-center">
              <p className="text-3xl font-bold text-green-600">156</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'অনুমোদিত সদস্য' : 'Members Approved'}
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-xl text-center">
              <p className="text-3xl font-bold text-purple-600">12</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'নিষ্পত্তিকৃত বিরোধ' : 'Disputes Resolved'}
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
