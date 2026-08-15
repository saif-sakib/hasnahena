'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
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
import { clearClientAuthState, getValidatedClientToken } from '@/lib/client-auth';

type VerificationStep = 'current' | 'verify' | 'new';
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081').replace(/\/$/, '').replace(/\/api$/, '');

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
  const router = useRouter();
  const [step, setStep] = useState<VerificationStep>('current');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const resetState = () => {
    setStep('current');
    setShowCurrentPassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setVerificationCode('');
    setIsSendingCode(false);
    setIsVerifyingCode(false);
    setIsChangingPassword(false);
  };

  const close = () => {
    if (forcePasswordChange) return;
    onOpenChange(false);
    resetState();
  };

  const validateNewPassword = () => {
    if (newPassword.length < 8) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description:
          locale === 'bn'
            ? 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে'
            : 'New password must be at least 8 characters',
        variant: 'destructive',
      });
      return false;
    }

    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasDigit = /\d/.test(newPassword);
    if (!hasUpper || !hasLower || !hasDigit) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description:
          locale === 'bn'
            ? 'পাসওয়ার্ডে বড় হাতের, ছোট হাতের অক্ষর ও সংখ্যা থাকতে হবে'
            : 'Password must include uppercase, lowercase, and numbers',
        variant: 'destructive',
      });
      return false;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'নতুন পাসওয়ার্ড মিলছে না' : 'New passwords do not match',
        variant: 'destructive',
      });
      return false;
    }

    if (newPassword === currentPassword) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description:
          locale === 'bn'
            ? 'নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ডের মতো হতে পারবে না'
            : 'New password must be different from current password',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const requestVerificationCode = async (isResend = false) => {
    const trimmedCurrent = currentPassword.trim();
    if (!trimmedCurrent) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? 'বর্তমান পাসওয়ার্ড লিখুন' : 'Please enter your current password',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingCode(true);
    try {
      const token = getValidatedClientToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`${API_BASE_URL}/v1/dashboard/password/change/request-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: trimmedCurrent,
          locale,
        }),
        cache: 'no-store',
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to send verification code');
      }

      if (!isResend) {
        setVerificationCode('');
        setStep('verify');
      }

      toast({
        title: locale === 'bn' ? 'কোড পাঠানো হয়েছে' : 'Code sent',
        description:
          json?.data?.message ||
          (locale === 'bn'
            ? 'আপনার ইমেইলে যাচাইকরণ কোড পাঠানো হয়েছে'
            : 'Verification code sent to your email'),
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

  const verifyCode = async () => {
    const code = verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? '৬ সংখ্যার যাচাইকরণ কোড লিখুন' : 'Enter the 6-digit verification code',
        variant: 'destructive',
      });
      return;
    }

    setIsVerifyingCode(true);
    try {
      const token = getValidatedClientToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`${API_BASE_URL}/v1/dashboard/password/change/verify-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          verificationCode: code,
        }),
        cache: 'no-store',
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Invalid verification code');
      }

      setStep('new');
      toast({
        title: locale === 'bn' ? 'যাচাইকরণ সম্পন্ন' : 'Verification complete',
        description:
          locale === 'bn'
            ? 'এখন নতুন পাসওয়ার্ড সেট করুন'
            : 'Now set your new password',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid verification code';
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const changePassword = async () => {
    if (!validateNewPassword()) {
      return;
    }

    const code = verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
      toast({
        title: locale === 'bn' ? 'ত্রুটি' : 'Error',
        description: locale === 'bn' ? '৬ সংখ্যার যাচাইকরণ কোড লিখুন' : 'Enter the 6-digit verification code',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const token = getValidatedClientToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`${API_BASE_URL}/v1/dashboard/password/change/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: currentPassword.trim(),
          newPassword,
          verificationCode: code,
        }),
        cache: 'no-store',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to change password');
      }

      localStorage.removeItem('hn_force_password_change');
      onPasswordChanged?.();
      onOpenChange(false);
      resetState();

      toast({
        title: locale === 'bn' ? 'সফল' : 'Success',
        description:
          locale === 'bn'
            ? 'পাসওয়ার্ড পরিবর্তন হয়েছে। আবার সাইন ইন করুন।'
            : 'Password changed. Please sign in again.',
        variant: 'success',
      });

      // The API revokes every token for this user on a password change, so the
      // token in this tab is dead the moment the request succeeds — staying on
      // the page would just 401 on the next call. Send the user to login.
      clearClientAuthState();
      router.replace(`/${locale}/login`);
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
            {step === 'verify' &&
              (locale === 'bn'
                ? 'ইমেইলে পাওয়া ৬ সংখ্যার কোড দিন'
                : 'Enter the 6-digit code sent to your email')}
            {step === 'new' &&
              (locale === 'bn'
                ? 'এখন নতুন পাসওয়ার্ড সেট করুন'
                : 'Now set your new password')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 'current' && (
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'বর্তমান পাসওয়ার্ড' : 'Current Password'}</Label>
              <div className="relative">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  data-no-native-password-toggle
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

          {step === 'verify' && (
            <div className="space-y-2">
              <Label>{locale === 'bn' ? 'যাচাইকরণ কোড' : 'Verification Code'}</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                placeholder={locale === 'bn' ? '৬ সংখ্যার কোড' : '6-digit code'}
              />
              <p className="text-xs text-muted-foreground">
                {locale === 'bn'
                  ? 'কোডটি ১০ মিনিট পর্যন্ত কার্যকর থাকবে'
                  : 'The code is valid for 10 minutes'}
              </p>
            </div>
          )}

          {step === 'new' && (
            <>
              <div className="space-y-2">
                <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}</Label>
                <Input
                  type="password"
                  data-no-native-password-toggle
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={locale === 'bn' ? 'নতুন পাসওয়ার্ড লিখুন' : 'Enter new password'}
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'bn' ? 'নতুন পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm New Password'}</Label>
                <Input
                  type="password"
                  data-no-native-password-toggle
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
            <Button variant="outline" onClick={close} disabled={isChangingPassword || isSendingCode || isVerifyingCode}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
          )}

          {step === 'current' && (
            <Button onClick={() => requestVerificationCode(false)} disabled={!currentPassword.trim() || isSendingCode || isVerifyingCode || isChangingPassword}>
              {isSendingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {locale === 'bn' ? 'কোড পাঠান' : 'Send Code'}
            </Button>
          )}

          {step === 'verify' && (
            <>
              <Button variant="outline" onClick={() => setStep('current')} disabled={isSendingCode || isVerifyingCode || isChangingPassword}>
                {locale === 'bn' ? 'পেছনে' : 'Back'}
              </Button>
              <Button variant="outline" onClick={() => requestVerificationCode(true)} disabled={isSendingCode || isVerifyingCode || isChangingPassword}>
                {isSendingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {locale === 'bn' ? 'আবার কোড পাঠান' : 'Resend Code'}
              </Button>
              <Button onClick={verifyCode} disabled={isSendingCode || isVerifyingCode || isChangingPassword || verificationCode.trim().length !== 6}>
                {isVerifyingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {locale === 'bn' ? 'কোড যাচাই করুন' : 'Verify Code'}
              </Button>
            </>
          )}

          {step === 'new' && (
            <>
              <Button variant="outline" onClick={() => setStep('verify')} disabled={isSendingCode || isVerifyingCode || isChangingPassword}>
                {locale === 'bn' ? 'পেছনে' : 'Back'}
              </Button>
              <Button onClick={changePassword} disabled={isSendingCode || isVerifyingCode || isChangingPassword}>
                {isChangingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {locale === 'bn' ? 'পাসওয়ার্ড পরিবর্তন করুন' : 'Change Password'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
