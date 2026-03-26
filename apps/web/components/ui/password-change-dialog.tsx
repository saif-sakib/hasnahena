'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { getValidatedClientToken } from '@/lib/client-auth';

type Step = 'current' | 'code' | 'new';

interface PasswordChangeDialogProps {
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forcePasswordChange?: boolean;
  onPasswordChanged?: () => void;
}

export function PasswordChangeDialog({
  locale,
  open,
  onOpenChange,
  forcePasswordChange = false,
  onPasswordChanged,
}: PasswordChangeDialogProps) {
  const [step, setStep] = useState<Step>('current');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const resetState = () => {
    setStep('current');
    setShowCurrentPassword(false);
    setCurrentPassword('');
    setVerificationCode('');
    setNewPassword('');
    setConfirmPassword('');
    setIsSendingCode(false);
    setIsChangingPassword(false);
  };

  const close = () => {
    if (forcePasswordChange) return;
    onOpenChange(false);
    resetState();
  };

  const requestCode = async () => {
    setIsSendingCode(true);
    try {
      const token = getValidatedClientToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/v1/auth/password-change/request-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          locale,
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to send verification code');
      }

      setStep('code');
      toast({
        title: locale === 'bn' ? 'কোড পাঠানো হয়েছে' : 'Code sent',
        description:
          locale === 'bn'
            ? 'আপনার ইমেইলে যাচাইকরণ কোড পাঠানো হয়েছে'
            : 'A verification code has been sent to your email',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send verification code';
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSendingCode(false);
    }
  };

  const verifyCode = () => {
    if (verificationCode.trim().length !== 6) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description:
          locale === 'bn' ? '৬ সংখ্যার কোড লিখুন' : 'Please enter the 6-digit verification code',
        variant: 'destructive',
      });
      return;
    }
    setStep('new');
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description:
          locale === 'bn'
            ? 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে'
            : 'New password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'নতুন পাসওয়ার্ড মিলছে না' : 'New passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const token = getValidatedClientToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/v1/auth/password-change/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: verificationCode.trim(),
          newPassword,
          locale,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to change password');
      }

      localStorage.removeItem('hn_force_password_change');
      onPasswordChanged?.();
      onOpenChange(false);
      resetState();

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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && forcePasswordChange) return;
        onOpenChange(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন' : 'Change Password'}</DialogTitle>
          <DialogDescription>
            {step === 'current' &&
              (locale === 'bn'
                ? 'প্রথমে বর্তমান পাসওয়ার্ড যাচাই করুন'
                : 'First verify your current password')}
            {step === 'code' &&
              (locale === 'bn'
                ? 'এখন ইমেইলে পাঠানো যাচাইকরণ কোড লিখুন'
                : 'Now enter the verification code sent to your email')}
            {step === 'new' &&
              (locale === 'bn'
                ? 'শেষ ধাপে নতুন পাসওয়ার্ড সেট করুন'
                : 'Finally set your new password')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 'current' && (
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'বর্তমান পাসওয়ার্ড' : 'Current Password'}</Label>
              <div className="relative">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={locale === 'bn' ? 'বর্তমান পাসওয়ার্ড লিখুন' : 'Enter current password'}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowCurrentPassword((prev) => !prev)}
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'যাচাইকরণ কোড' : 'Verification Code'}</Label>
              <Input
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={locale === 'bn' ? '৬ সংখ্যার কোড লিখুন' : 'Enter 6-digit code'}
              />
              <div className="text-xs text-muted-foreground">
                {locale === 'bn'
                  ? 'কোড আপনার ইমেইলে পাঠানো হয়েছে'
                  : 'The code has been sent to your email'}
              </div>
            </div>
          )}

          {step === 'new' && (
            <>
              <div className="space-y-2">
                <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={locale === 'bn' ? 'নতুন পাসওয়ার্ড লিখুন' : 'Enter new password'}
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm New Password'}</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={locale === 'bn' ? 'নতুন পাসওয়ার্ড আবার লিখুন' : 'Confirm new password'}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          {!forcePasswordChange && (
            <Button variant="outline" onClick={close} disabled={isSendingCode || isChangingPassword}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
          )}

          {step === 'current' && (
            <Button onClick={requestCode} disabled={isSendingCode || !currentPassword}>
              {isSendingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
              {locale === 'bn' ? 'কোড পাঠান' : 'Send code'}
            </Button>
          )}

          {step === 'code' && (
            <>
              <Button variant="outline" onClick={requestCode} disabled={isSendingCode}>
                {isSendingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                {locale === 'bn' ? 'আবার কোড পাঠান' : 'Resend code'}
              </Button>
              <Button onClick={verifyCode}>{locale === 'bn' ? 'কোড যাচাই করুন' : 'Verify code'}</Button>
            </>
          )}

          {step === 'new' && (
            <Button onClick={changePassword} disabled={isChangingPassword}>
              {isChangingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {locale === 'bn' ? 'পরিবর্তন করুন' : 'Change Password'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
