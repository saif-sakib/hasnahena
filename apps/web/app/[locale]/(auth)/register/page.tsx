'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, Check, User, MapPin, Users, FileText, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import {
  bdPhoneRegex,
  getRegistrationFieldLabel,
  registerSchema,
  type RegisterFormData,
} from '@/lib/validation/registration';
import { validateImageFile, UPLOAD_TYPES } from '@/lib/image-utils';

const steps = [
  { id: 'personal', icon: User },
  { id: 'address', icon: MapPin },
  { id: 'nominee', icon: Users },
  { id: 'documents', icon: FileText },
];

const emailSchema = z.string().email();
type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type RegisterFieldName = FieldPath<RegisterFormData>;

const REGISTRATION_DRAFT_KEY_PREFIX = 'hn_registration_draft_v1';

const FORM_DEFAULT_VALUES: Partial<RegisterFormData> = {
  maritalStatus: 'UNMARRIED',
  gender: 'MALE',
  bloodGroup: 'A+',
  childrenCount: 0,
  sameAsPermanent: true,
};

type RequiredDocumentKey =
  | 'nidFrontImage'
  | 'nidBackImage'
  | 'memberPhotoImage'
  | 'signatureImage';

const REQUIRED_DOCUMENT_KEYS: RequiredDocumentKey[] = [
  'nidFrontImage',
  'nidBackImage',
  'memberPhotoImage',
  'signatureImage',
];

const REGISTRATION_MAX_FILE_SIZE_MB = 10;
const REGISTRATION_MAX_TOTAL_UPLOAD_BYTES = 40 * 1024 * 1024;

export default function RegisterPage() {
  const locale = useLocale();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState<'idle' | 'uploading' | 'finishing'>('idle');
  const [emailAvailability, setEmailAvailability] = useState<AvailabilityState>('idle');
  const [phoneAvailability, setPhoneAvailability] = useState<AvailabilityState>('idle');
  const [documentFiles, setDocumentFiles] = useState<Record<RequiredDocumentKey, File | null>>({
    nidFrontImage: null,
    nidBackImage: null,
    memberPhotoImage: null,
    signatureImage: null,
  });
  const [documentErrors, setDocumentErrors] = useState<Partial<Record<RequiredDocumentKey, string>>>({});
  const draftStorageKey = useMemo(() => `${REGISTRATION_DRAFT_KEY_PREFIX}:${locale}`, [locale]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    getValues,
    trigger,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: FORM_DEFAULT_VALUES,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const sameAsPermanent = watch('sameAsPermanent') ?? true;
  const watchedEmail = watch('email');
  const watchedPhone = watch('phone');

  useEffect(() => {
    const email = (watchedEmail || '').trim().toLowerCase();
    if (email === '') {
      setEmailAvailability('idle');
      if (errors.email?.type === 'manual') {
        clearErrors('email');
      }
      return;
    }
    if (!emailSchema.safeParse(email).success) {
      setEmailAvailability('idle');
      if (errors.email?.type === 'manual') {
        clearErrors('email');
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setEmailAvailability('checking');
      try {
        const response = await fetch(`/api/v1/registrations?email=${encodeURIComponent(email)}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => ({}))) as { emailExists?: boolean };
        if (!response.ok) {
          throw new Error('Failed to validate email availability');
        }

        if (json.emailExists) {
          setEmailAvailability('taken');
          setError('email', {
            type: 'manual',
            message: locale === 'bn' ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
          });
        } else {
          setEmailAvailability('available');
          if (errors.email?.type === 'manual') {
            clearErrors('email');
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setEmailAvailability('error');
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [watchedEmail, setError, clearErrors, errors.email?.type, locale]);

  useEffect(() => {
    const phone = (watchedPhone || '').trim();
    if (phone === '') {
      setPhoneAvailability('idle');
      if (errors.phone?.type === 'manual') {
        clearErrors('phone');
      }
      return;
    }
    if (!bdPhoneRegex.test(phone)) {
      setPhoneAvailability('idle');
      if (errors.phone?.type === 'manual') {
        clearErrors('phone');
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setPhoneAvailability('checking');
      try {
        const response = await fetch(`/api/v1/registrations?phone=${encodeURIComponent(phone)}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => ({}))) as { phoneExists?: boolean };
        if (!response.ok) {
          throw new Error('Failed to validate phone availability');
        }

        if (json.phoneExists) {
          setPhoneAvailability('taken');
          setError('phone', {
            type: 'manual',
            message: locale === 'bn' ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত' : 'This phone number is already registered',
          });
        } else {
          setPhoneAvailability('available');
          if (errors.phone?.type === 'manual') {
            clearErrors('phone');
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setPhoneAvailability('error');
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [watchedPhone, setError, clearErrors, errors.phone?.type, locale]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        data?: Partial<RegisterFormData>;
        currentStep?: number;
      };
      const restoredValues: Partial<RegisterFormData> = {
        ...FORM_DEFAULT_VALUES,
        ...(parsed.data || {}),
      };
      reset(restoredValues);

      if (typeof parsed.currentStep === 'number' && Number.isFinite(parsed.currentStep)) {
        const clampedStep = Math.min(Math.max(parsed.currentStep, 0), steps.length - 1);
        setCurrentStep(clampedStep);
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey, reset]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const subscription = watch((value: Partial<RegisterFormData>) => {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          data: value,
          currentStep,
          savedAt: Date.now(),
        }),
      );
    });

    return () => subscription.unsubscribe();
  }, [watch, currentStep, draftStorageKey]);

  // Fields to validate per step
  const conditionalAddressFields: RegisterFieldName[] = [
    'presentHouseNo',
    'presentVillage',
    'presentUnion',
    'presentPoliceStation',
    'presentDistrict',
  ];

  const stepFields: RegisterFieldName[][] = [
    // Step 0: Personal Info
    ['nameEn', 'fatherName', 'motherName', 'phone', 'email', 'nidNumber', 'gender', 'bloodGroup', 'profession', 'maritalStatus', 'dateOfBirth'],
    // Step 1: Address
    ['permanentHouseNo', 'permanentVillage', 'permanentUnion', 'permanentPoliceStation', 'permanentDistrict', 'sameAsPermanent', 'presentHouseNo', 'presentVillage', 'presentUnion', 'presentPoliceStation', 'presentDistrict'],
    // Step 2: Nominee
    ['nomineeName', 'nomineeRelationship', 'nomineeNid', 'nomineePhone'],
    // Step 3: Documents & Agreement
    ['agreeToTerms'],
  ];

  const checkContactAvailability = async (emailValue: string, phoneValue: string): Promise<'available' | 'taken' | 'error'> => {
    const email = emailValue.trim().toLowerCase();
    const phone = phoneValue.trim();

    setEmailAvailability(email ? 'checking' : 'idle');
    setPhoneAvailability(phone ? 'checking' : 'idle');

    try {
      const params = new URLSearchParams();
      if (email) {
        params.set('email', email);
      }
      if (phone) {
        params.set('phone', phone);
      }

      const response = await fetch(`/api/v1/registrations?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const json = (await response.json().catch(() => ({}))) as {
        emailExists?: boolean;
        phoneExists?: boolean;
      };
      if (!response.ok) {
        throw new Error('Availability check failed');
      }

      const emailTaken = Boolean(email) && Boolean(json.emailExists);
      const phoneTaken = Boolean(phone) && Boolean(json.phoneExists);

      if (emailTaken) {
        setError('email', {
          type: 'manual',
          message: locale === 'bn' ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
        });
      } else if (errors.email?.type === 'manual') {
        clearErrors('email');
      }

      if (phoneTaken) {
        setError('phone', {
          type: 'manual',
          message: locale === 'bn' ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত' : 'This phone number is already registered',
        });
      } else if (errors.phone?.type === 'manual') {
        clearErrors('phone');
      }

      setEmailAvailability(email ? (emailTaken ? 'taken' : 'available') : 'idle');
      setPhoneAvailability(phone ? (phoneTaken ? 'taken' : 'available') : 'idle');

      if (emailTaken || phoneTaken) {
        return 'taken';
      }
      return 'available';
    } catch {
      setEmailAvailability(email ? 'error' : 'idle');
      setPhoneAvailability(phone ? 'error' : 'idle');
      return 'error';
    }
  };

  const onSubmit = async (data: RegisterFormData) => {
    setSubmitError(null);
    setSubmitStage('idle');

    const availability = await checkContactAvailability(data.email, data.phone);
    if (availability === 'error') {
      setSubmitError(
        locale === 'bn'
          ? 'ই-মেইল/মোবাইল যাচাই করা যাচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Unable to validate email/phone right now. Please try again.'
      );
      return;
    }

    if (availability === 'taken') {
      setSubmitError(
        locale === 'bn'
          ? 'এই ই-মেইল বা মোবাইল নম্বর দিয়ে ইতোমধ্যে নিবন্ধন করা হয়েছে।'
          : 'This email or phone number is already registered.'
      );
      return;
    }

    const missingDocumentKey = REQUIRED_DOCUMENT_KEYS.find((key) => !documentFiles[key]);
    if (missingDocumentKey) {
      setDocumentErrors((prev) => ({
        ...prev,
        [missingDocumentKey]: locale === 'bn' ? 'এই ফাইলটি প্রয়োজন' : 'This file is required',
      }));
      setSubmitError(
        locale === 'bn'
          ? 'নিবন্ধন সম্পন্ন করতে সব বাধ্যতামূলক নথি আপলোড করুন।'
          : 'Please upload all required documents to complete registration.',
      );
      return;
    }

    if (Object.values(documentErrors).some(Boolean)) {
      setSubmitError(
        locale === 'bn'
          ? 'নথির ত্রুটিগুলো ঠিক করে আবার চেষ্টা করুন।'
          : 'Please fix the document upload errors and try again.',
      );
      return;
    }

    const totalUploadBytes = REQUIRED_DOCUMENT_KEYS.reduce((sum, key) => {
      const file = documentFiles[key];
      return sum + (file?.size ?? 0);
    }, 0);
    if (totalUploadBytes > REGISTRATION_MAX_TOTAL_UPLOAD_BYTES) {
      setSubmitError(
        locale === 'bn'
          ? 'নথির মোট সাইজ খুব বেশি। সর্বোচ্চ ৩.৫ MB এর মধ্যে রাখুন।'
          : 'Total document upload size is too large. Keep all files within 3.5 MB.',
      );
      return;
    }

    try {
      setSubmitStage('uploading');
      const registrationPayload = {
        // Personal Info
        nameEn: data.nameEn,
        nameBn: data.nameBn,
        fatherName: data.fatherName,
        motherName: data.motherName,
        phone: data.phone,
        email: data.email,
        nidNumber: data.nidNumber,
        maritalStatus: data.maritalStatus,
        childrenCount: data.childrenCount,
        gender: data.gender,
        bloodGroup: data.bloodGroup,
        profession: data.profession,
        dateOfBirth: data.dateOfBirth,
        // Permanent Address
        permanentHouseNo: data.permanentHouseNo,
        permanentRoadNo: data.permanentRoadNo,
        permanentVillage: data.permanentVillage,
        permanentUnion: data.permanentUnion,
        permanentPoliceStation: data.permanentPoliceStation,
        permanentDistrict: data.permanentDistrict,

        // Present Address
        sameAsPermanent: data.sameAsPermanent ?? true,
        presentHouseNo: data.presentHouseNo,
        presentRoadNo: data.presentRoadNo,
        presentVillage: data.presentVillage,
        presentUnion: data.presentUnion,
        presentPoliceStation: data.presentPoliceStation,
        presentDistrict: data.presentDistrict,

        // Nominee
        nomineeName: data.nomineeName,
        nomineeRelationship: data.nomineeRelationship,
        nomineeNid: data.nomineeNid,
        nomineePhone: data.nomineePhone,
      };

      const formData = new FormData();
      formData.append('payload', JSON.stringify(registrationPayload));
      for (const key of REQUIRED_DOCUMENT_KEYS) {
        const file = documentFiles[key];
        if (file) {
          formData.append(key, file);
        }
      }

      const response = await fetch('/api/v1/registrations', {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let json: {
        error?: string;
        details?: {
          fieldErrors?: Record<string, string[] | undefined>;
          formErrors?: string[];
        };
      } = {};
      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        setSubmitStage('idle');
        // Keep registration error rendering resilient so users never see a blank failure.
        const fieldErrorMessages = json?.details?.fieldErrors && typeof json.details.fieldErrors === 'object'
          ? Object.entries(json.details.fieldErrors)
            .map(([field, messages]) => {
              const safeMessages = Array.isArray(messages)
                ? messages.filter((message): message is string => typeof message === 'string' && message.trim() !== '')
                : [];
              if (!safeMessages.length) return '';
              return `${getRegistrationFieldLabel(field, locale === 'bn' ? 'bn' : 'en')}: ${safeMessages.join(', ')}`;
            })
            .filter(Boolean)
            .join('\n')
          : '';
        const formErrorMessages = (Array.isArray(json?.details?.formErrors) ? json.details.formErrors : [])
          .filter((message): message is string => typeof message === 'string')
          .map((message) => message.trim())
          .filter(Boolean)
          .join('\n');
        const detailedMessage = [fieldErrorMessages, formErrorMessages].filter(Boolean).join('\n');

        if (detailedMessage) {
          setSubmitError(
            locale === 'bn'
              ? `ফর্মে ত্রুটি রয়েছে:\n${detailedMessage}`
              : `Form has errors:\n${detailedMessage}`
          );
        } else {
          const fallbackFromBody = responseText.trim();
          setSubmitError(
            (typeof json?.error === 'string' && json.error.trim())
            || fallbackFromBody
            || (locale === 'bn' ? 'নিবন্ধন ব্যর্থ হয়েছে' : 'Registration failed')
          );
        }
        return;
      }

      // Show success toast
      toast({
        title: locale === 'bn' ? 'নিবন্ধন সফল!' : 'Registration Successful!',
        description: locale === 'bn'
          ? 'আপনার আবেদন জমা হয়েছে। অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।'
          : 'Your application has been submitted. Please wait for admin approval.',
        variant: 'success',
      });

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(draftStorageKey);
      }
      setDocumentFiles({
        nidFrontImage: null,
        nidBackImage: null,
        memberPhotoImage: null,
        signatureImage: null,
      });
      setDocumentErrors({});
      setSubmitStage('finishing');

      // Redirect after a short delay so user can see the message
      setTimeout(() => {
        router.push(`/${locale}/login`);
      }, 2000);
    } catch {
      setSubmitStage('idle');
      setSubmitError(
        locale === 'bn'
          ? 'নিবন্ধন ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Registration failed. Please try again.'
      );
    }
  };

  const onInvalidSubmit = (formErrors: FieldErrors<RegisterFormData>) => {
    const stepFieldSet = new Set(stepFields.flat());
    const errorFields = (Object.keys(formErrors) as RegisterFieldName[]).filter((field) =>
      stepFieldSet.has(field)
    );
    const visibleErrorFields = errorFields.filter(
      (field) => !(sameAsPermanent && conditionalAddressFields.includes(field))
    );

    if (!visibleErrorFields.length) {
      const rootMessage = (formErrors as { root?: { message?: unknown } }).root?.message;
      const firstFieldMessage = Object.values(formErrors).find((value) => {
        if (!value || typeof value !== 'object') {
          return false;
        }
        return typeof (value as { message?: unknown }).message === 'string';
      }) as { message?: string } | undefined;

      const fallbackMessage =
        (typeof rootMessage === 'string' && rootMessage.trim())
          ? rootMessage.trim()
          : (firstFieldMessage?.message?.trim() ||
            (locale === 'bn'
              ? 'ফর্মে কিছু তথ্য আবার যাচাই করুন।'
              : 'Please review the form information once more.'));

      setSubmitError(fallbackMessage);
      return;
    }

    let targetStep = steps.length - 1;
    for (const [index, fields] of stepFields.entries()) {
      if (visibleErrorFields.some((field) => fields.includes(field))) {
        targetStep = index;
        break;
      }
    }

    setCurrentStep(targetStep);
    toast({
      title: locale === 'bn' ? 'ফর্মে সমস্যা আছে' : 'Form needs attention',
      description:
        locale === 'bn'
          ? 'যে ধাপে সমস্যা আছে সেখানে আপনাকে নিয়ে যাওয়া হয়েছে।'
          : 'You have been moved to the step that needs correction.',
      variant: 'destructive',
    });
  };

  const nextStep = async () => {
    setSubmitError(null);

    // Validate current step fields before proceeding
    const fieldsToValidate =
      currentStep === 1 && sameAsPermanent
        ? stepFields[currentStep].filter((field) => !conditionalAddressFields.includes(field))
        : stepFields[currentStep];
    const isValid = await trigger(fieldsToValidate);

    if (!isValid) {
      // Show toast about validation errors
      toast({
        title: locale === 'bn' ? 'অনুগ্রহ করে ত্রুটি সংশোধন করুন' : 'Please fix the errors',
        description: locale === 'bn'
          ? 'সব প্রয়োজনীয় ফিল্ড সঠিকভাবে পূরণ করুন।'
          : 'Please fill all required fields correctly.',
        variant: 'destructive',
      });
      return;
    }

    if (currentStep === 0) {
      const availability = await checkContactAvailability(getValues('email'), getValues('phone'));
      if (availability === 'error') {
        toast({
          title: locale === 'bn' ? 'যাচাই ব্যর্থ' : 'Validation failed',
          description:
            locale === 'bn'
              ? 'ই-মেইল/মোবাইল যাচাই করা যাচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Unable to validate email/phone right now. Please try again.',
          variant: 'destructive',
        });
        return;
      }
      if (availability === 'taken') {
        toast({
          title: locale === 'bn' ? 'ডুপ্লিকেট তথ্য পাওয়া গেছে' : 'Duplicate information found',
          description:
            locale === 'bn'
              ? 'এই ই-মেইল বা মোবাইল নম্বর আগে থেকেই ব্যবহৃত হয়েছে।'
              : 'This email or phone number is already in use.',
          variant: 'destructive',
        });
        return;
      }
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    setSubmitError(null);

    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const stepTitles = locale === 'bn' 
    ? ['ব্যক্তিগত তথ্য', 'ঠিকানা', 'নমিনী', 'নথি ও চুক্তি']
    : ['Personal Info', 'Address', 'Nominee', 'Documents'];

  const documentFieldMeta: Array<{ key: RequiredDocumentKey; label: string; helper: string }> = [
    {
      key: 'nidFrontImage',
      label: locale === 'bn' ? 'NID কার্ডের সামনের ছবি *' : 'NID front image *',
      helper: locale === 'bn' ? 'স্পষ্ট ও পূর্ণ ফ্রেমে তুলুন' : 'Upload a clear full-frame image',
    },
    {
      key: 'nidBackImage',
      label: locale === 'bn' ? 'NID কার্ডের পেছনের ছবি *' : 'NID back image *',
      helper: locale === 'bn' ? 'সব লেখা স্পষ্ট দেখা যেতে হবে' : 'Make sure all text is readable',
    },
    {
      key: 'memberPhotoImage',
      label: locale === 'bn' ? 'আপনার পাসপোর্ট সাইজ ছবি *' : 'Your passport photo *',
      helper: locale === 'bn' ? 'সাম্প্রতিক ছবি দিন' : 'Use a recent portrait photo',
    },
    {
      key: 'signatureImage',
      label: locale === 'bn' ? 'স্বাক্ষরের ছবি *' : 'Signature image *',
      helper: locale === 'bn' ? 'সাদা কাগজে কালো কালি/কলমে' : 'Use dark ink on white background',
    },
  ];

  const handleDocumentChange = (key: RequiredDocumentKey, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSubmitError(null);

    if (!file) {
      setDocumentFiles((prev) => ({ ...prev, [key]: null }));
      setDocumentErrors((prev) => ({ ...prev, [key]: locale === 'bn' ? 'এই ফাইলটি প্রয়োজন' : 'This file is required' }));
      return;
    }

    const validation = validateImageFile(file, {
      acceptedTypes: UPLOAD_TYPES.avatar,
      maxSizeMB: REGISTRATION_MAX_FILE_SIZE_MB,
    });
    if (!validation.valid) {
      setDocumentFiles((prev) => ({ ...prev, [key]: null }));
      setDocumentErrors((prev) => ({ ...prev, [key]: validation.error || (locale === 'bn' ? 'অবৈধ ফাইল' : 'Invalid file') }));
      event.target.value = '';
      return;
    }

    setDocumentFiles((prev) => ({ ...prev, [key]: file }));
    setDocumentErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (currentStep < steps.length - 1) {
      event.preventDefault();
      void nextStep();
      return;
    }
    void handleSubmit(onSubmit, onInvalidSubmit)(event);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      {/* Header with Navigation */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur-md safe-area-top">
        <div className="container-wide flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href={`/${locale}`}>
              <Logo size="sm" showTagline={false} />
            </Link>
            <Link
              href={`/${locale}`}
              className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {locale === 'bn' ? 'হোম' : 'Home'}
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/${locale === 'en' ? 'bn' : 'en'}/register`}>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span className="text-sm">{locale === 'en' ? 'বাংলা' : 'English'}</span>
              </Button>
            </Link>
            <Link
              href={`/${locale}/login`}
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {locale === 'bn' ? 'লগইন করুন' : 'Login'}
            </Link>
          </div>
        </div>
      </header>

      <main className="py-6 sm:py-8 px-4 safe-area-bottom">
        <div className="container-wide max-w-4xl">
          {/* Progress Steps */}
          <div className="mb-8 sm:mb-12 relative">
            <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-200 dark:bg-slate-800 -translate-y-1/2 rounded-full z-0" />
            <div className="flex items-center justify-between relative z-10">
              {steps.map((step, index) => (
                <div key={step.id} className="flex flex-col items-center group">
                  <div
                    className={`h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl flex items-center justify-center border-2 sm:border-4 transition-all duration-500 ${
                      index < currentStep
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-600/30 scale-100'
                        : index === currentStep
                        ? 'bg-white border-emerald-600 text-emerald-600 shadow-xl shadow-emerald-600/20 scale-105 sm:scale-110'
                        : 'bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800'
                    }`}
                  >
                    {index < currentStep ? (
                      <Check className="h-4 w-4 sm:h-6 sm:w-6 animate-in zoom-in duration-300" />
                    ) : (
                      <step.icon className={`h-4 w-4 sm:h-6 sm:w-6 ${index === currentStep ? 'animate-bounce' : ''}`} />
                    )}
                  </div>
                  <span className={`text-[10px] sm:text-sm mt-2 sm:mt-3 font-semibold transition-colors duration-300 text-center ${
                    index <= currentStep ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'
                  }`}>
                    {stepTitles[index]}
                  </span>
                </div>
              ))}
            </div>
            
            <div 
              className="absolute top-1/2 left-0 h-1 bg-emerald-600 -translate-y-1/2 rounded-full z-0 transition-all duration-700 ease-in-out"
              style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
            />
          </div>

          <Card className="border-0 shadow-2xl shadow-emerald-900/10 dark:shadow-black/40 overflow-hidden bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
            <div className="h-2 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
            <CardHeader className="pb-8 text-center border-b border-slate-100 dark:border-slate-800/50">
              <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                {locale === 'bn' ? 'হাসনাহেনায় নিবন্ধন' : 'Register for Hasnahena'}
              </CardTitle>
              <CardDescription className="text-lg mt-2 text-slate-500 dark:text-slate-400">
                {locale === 'bn'
                  ? 'সুদমুক্ত অর্থায়নে আপনার যাত্রা শুরু করুন'
                  : 'Start your journey to interest-free finance'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 md:p-10">
              {submitError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}
              <form onSubmit={handleFormSubmit}>
                {/* Step 1: Personal Information */}
                {currentStep === 0 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b border-slate-100 pb-3 text-slate-800">
                      {locale === 'bn' ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nameEn" className="text-sm font-medium">
                          {locale === 'bn' ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
                        </Label>
                        <Input
                          id="nameEn"
                          className="h-11 bg-white border-slate-200 focus:border-primary"
                          placeholder="Full name in English"
                          {...register('nameEn')}
                        />
                        {errors.nameEn && (
                          <p className="text-sm text-destructive">{errors.nameEn.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nameBn" className="text-sm font-medium">
                          {locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}
                        </Label>
                        <Input
                          id="nameBn"
                          className="h-11 bg-white border-slate-200 focus:border-primary"
                          placeholder="পূর্ণ নাম বাংলায়"
                          {...register('nameBn')}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fatherName">
                          {locale === 'bn' ? 'পিতার নাম *' : "Father's Name *"}
                        </Label>
                        <Input
                          id="fatherName"
                          {...register('fatherName')}
                        />
                        {errors.fatherName && (
                          <p className="text-sm text-destructive">{errors.fatherName.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="motherName">
                          {locale === 'bn' ? 'মাতার নাম *' : "Mother's Name *"}
                        </Label>
                        <Input
                          id="motherName"
                          {...register('motherName')}
                        />
                        {errors.motherName && (
                          <p className="text-sm text-destructive">{errors.motherName.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="phone">
                          {locale === 'bn' ? 'মোবাইল নম্বর *' : 'Mobile Number *'}
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="01XXXXXXXXX"
                          {...register('phone')}
                        />
                        {errors.phone && (
                          <p className="text-sm text-destructive">{errors.phone.message}</p>
                        )}
                        {!errors.phone && phoneAvailability === 'checking' && (
                          <p className="text-xs text-muted-foreground">
                            {locale === 'bn' ? 'মোবাইল নম্বর যাচাই হচ্ছে...' : 'Checking phone number...'}
                          </p>
                        )}
                        {!errors.phone && phoneAvailability === 'taken' && (
                          <p className="text-sm text-destructive">
                            {locale === 'bn'
                              ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
                              : 'This phone number is already registered'}
                          </p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="email">
                          {locale === 'bn' ? 'ই-মেইল *' : 'Email *'}
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="name@example.com"
                          {...register('email')}
                        />
                        {errors.email && (
                          <p className="text-sm text-destructive">{errors.email.message}</p>
                        )}
                        {!errors.email && emailAvailability === 'checking' && (
                          <p className="text-xs text-muted-foreground">
                            {locale === 'bn' ? 'ই-মেইল যাচাই হচ্ছে...' : 'Checking email...'}
                          </p>
                        )}
                        {!errors.email && emailAvailability === 'taken' && (
                          <p className="text-sm text-destructive">
                            {locale === 'bn'
                              ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত'
                              : 'This email is already registered'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nidNumber">
                          {locale === 'bn' ? 'এন.আই.ডি নং *' : 'NID Number *'}
                        </Label>
                        <Input
                          id="nidNumber"
                          placeholder="10, 13, or 17 digits"
                          {...register('nidNumber')}
                        />
                        {errors.nidNumber && (
                          <p className="text-sm text-destructive">{errors.nidNumber.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="gender">
                          {locale === 'bn' ? 'লিঙ্গ *' : 'Gender *'}
                        </Label>
                        <select
                          id="gender"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...register('gender')}
                        >
                          <option value="MALE">{locale === 'bn' ? 'পুরুষ' : 'Male'}</option>
                          <option value="FEMALE">{locale === 'bn' ? 'মহিলা' : 'Female'}</option>
                          <option value="OTHER">{locale === 'bn' ? 'অন্যান্য' : 'Other'}</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="dateOfBirth">
                          {locale === 'bn' ? 'জন্ম তারিখ *' : 'Date of Birth *'}
                        </Label>
                        <Input
                          id="dateOfBirth"
                          type="date"
                          {...register('dateOfBirth')}
                        />
                        {errors.dateOfBirth && (
                          <p className="text-sm text-destructive">{errors.dateOfBirth.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="bloodGroup">
                          {locale === 'bn' ? 'রক্তের গ্রুপ *' : 'Blood Group *'}
                        </Label>
                        <select
                          id="bloodGroup"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...register('bloodGroup')}
                        >
                          <option value="A+">A+</option>
                          <option value="A-">A-</option>
                          <option value="B+">B+</option>
                          <option value="B-">B-</option>
                          <option value="AB+">AB+</option>
                          <option value="AB-">AB-</option>
                          <option value="O+">O+</option>
                          <option value="O-">O-</option>
                        </select>
                        {errors.bloodGroup && (
                          <p className="text-sm text-destructive">{errors.bloodGroup.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="profession">
                          {locale === 'bn' ? 'পেশা *' : 'Profession *'}
                        </Label>
                        <Input
                          id="profession"
                          placeholder={locale === 'bn' ? 'যেমন: কৃষক, শিক্ষক, ব্যবসায়ী' : 'e.g. Farmer, Teacher, Business'}
                          {...register('profession')}
                        />
                        {errors.profession && (
                          <p className="text-sm text-destructive">{errors.profession.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="maritalStatus">
                          {locale === 'bn' ? 'বৈবাহিক অবস্থা *' : 'Marital Status *'}
                        </Label>
                        <select
                          id="maritalStatus"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...register('maritalStatus')}
                        >
                          <option value="UNMARRIED">{locale === 'bn' ? 'অবিবাহিত' : 'Unmarried'}</option>
                          <option value="MARRIED">{locale === 'bn' ? 'বিবাহিত' : 'Married'}</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="childrenCount">
                          {locale === 'bn' ? 'সন্তানের সংখ্যা' : 'Number of Children'}
                        </Label>
                        <Input
                          id="childrenCount"
                          type="number"
                          min="0"
                          {...register('childrenCount', { valueAsNumber: true })}
                        />
                        {errors.childrenCount && (
                          <p className="text-sm text-destructive">{errors.childrenCount.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      {locale === 'bn'
                        ? 'অনুমোদনের পরে আপনাকে ইমেইলে অস্থায়ী পাসওয়ার্ড পাঠানো হবে। প্রথম লগইনের পর পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।'
                        : 'After approval, a temporary password will be sent to your email. You must change it after first login.'}
                    </div>
                  </div>
                )}

                {/* Step 2: Address */}
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="permanentHouseNo">
                          {locale === 'bn' ? 'বাড়ী নং *' : 'House No *'}
                        </Label>
                        <Input
                          id="permanentHouseNo"
                          {...register('permanentHouseNo')}
                        />
                        {errors.permanentHouseNo && (
                          <p className="text-sm text-destructive">{errors.permanentHouseNo.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentRoadNo">
                          {locale === 'bn' ? 'রোড নং' : 'Road No'}
                        </Label>
                        <Input
                          id="permanentRoadNo"
                          {...register('permanentRoadNo')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentVillage">
                          {locale === 'bn' ? 'গ্রাম *' : 'Village *'}
                        </Label>
                        <Input
                          id="permanentVillage"
                          {...register('permanentVillage')}
                        />
                        {errors.permanentVillage && (
                          <p className="text-sm text-destructive">{errors.permanentVillage.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="permanentUnion">
                          {locale === 'bn' ? 'ইউনিয়ন *' : 'Union *'}
                        </Label>
                        <Input
                          id="permanentUnion"
                          {...register('permanentUnion')}
                        />
                        {errors.permanentUnion && (
                          <p className="text-sm text-destructive">{errors.permanentUnion.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentPoliceStation">
                          {locale === 'bn' ? 'থানা *' : 'Police Station *'}
                        </Label>
                        <Input
                          id="permanentPoliceStation"
                          {...register('permanentPoliceStation')}
                        />
                        {errors.permanentPoliceStation && (
                          <p className="text-sm text-destructive">{errors.permanentPoliceStation.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentDistrict">
                          {locale === 'bn' ? 'জেলা *' : 'District *'}
                        </Label>
                        <Input
                          id="permanentDistrict"
                          {...register('permanentDistrict')}
                        />
                        {errors.permanentDistrict && (
                          <p className="text-sm text-destructive">{errors.permanentDistrict.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t">
                      <input
                        type="checkbox"
                        id="sameAsPermanent"
                        className="h-4 w-4"
                        {...register('sameAsPermanent')}
                      />
                      <Label htmlFor="sameAsPermanent" className="text-sm font-normal">
                        {locale === 'bn'
                          ? 'বর্তমান ঠিকানা স্থায়ী ঠিকানার সাথে একই'
                          : 'Present address is same as permanent address'}
                      </Label>
                    </div>

                    {!sameAsPermanent && (
                      <>
                        <h3 className="text-lg font-semibold border-b pb-2">
                          {locale === 'bn' ? 'বর্তমান ঠিকানা' : 'Present Address'}
                        </h3>
                        
                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="presentHouseNo">
                              {locale === 'bn' ? 'বাড়ী নং *' : 'House No *'}
                            </Label>
                            <Input
                              id="presentHouseNo"
                              {...register('presentHouseNo')}
                            />
                            {errors.presentHouseNo && (
                              <p className="text-sm text-destructive">{errors.presentHouseNo.message}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentRoadNo">
                              {locale === 'bn' ? 'রোড নং' : 'Road No'}
                            </Label>
                            <Input
                              id="presentRoadNo"
                              {...register('presentRoadNo')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentVillage">
                              {locale === 'bn' ? 'গ্রাম *' : 'Village *'}
                            </Label>
                            <Input
                              id="presentVillage"
                              {...register('presentVillage')}
                            />
                            {errors.presentVillage && (
                              <p className="text-sm text-destructive">{errors.presentVillage.message}</p>
                            )}
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="presentUnion">
                              {locale === 'bn' ? 'ইউনিয়ন *' : 'Union *'}
                            </Label>
                            <Input
                              id="presentUnion"
                              {...register('presentUnion')}
                            />
                            {errors.presentUnion && (
                              <p className="text-sm text-destructive">{errors.presentUnion.message}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentPoliceStation">
                              {locale === 'bn' ? 'থানা *' : 'Police Station *'}
                            </Label>
                            <Input
                              id="presentPoliceStation"
                              {...register('presentPoliceStation')}
                            />
                            {errors.presentPoliceStation && (
                              <p className="text-sm text-destructive">{errors.presentPoliceStation.message}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentDistrict">
                              {locale === 'bn' ? 'জেলা *' : 'District *'}
                            </Label>
                            <Input
                              id="presentDistrict"
                              {...register('presentDistrict')}
                            />
                            {errors.presentDistrict && (
                              <p className="text-sm text-destructive">{errors.presentDistrict.message}</p>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Step 3: Nominee */}
                {currentStep === 2 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'নমিনী তথ্য' : 'Nominee Information'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeName">
                          {locale === 'bn' ? 'নমিনীর নাম *' : 'Nominee Name *'}
                        </Label>
                        <Input
                          id="nomineeName"
                          {...register('nomineeName')}
                        />
                        {errors.nomineeName && (
                          <p className="text-sm text-destructive">{errors.nomineeName.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nomineeRelationship">
                          {locale === 'bn' ? 'সম্পর্ক *' : 'Relationship *'}
                        </Label>
                        <Input
                          id="nomineeRelationship"
                          placeholder={locale === 'bn' ? 'যেমন: পিতা, মাতা, স্ত্রী, স্বামী' : 'e.g. Father, Mother, Wife, Husband'}
                          {...register('nomineeRelationship')}
                        />
                        {errors.nomineeRelationship && (
                          <p className="text-sm text-destructive">{errors.nomineeRelationship.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeNid">
                          {locale === 'bn' ? 'নমিনীর NID *' : 'Nominee NID *'}
                        </Label>
                        <Input
                          id="nomineeNid"
                          {...register('nomineeNid')}
                        />
                        {errors.nomineeNid && (
                          <p className="text-sm text-destructive">{errors.nomineeNid.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nomineePhone">
                          {locale === 'bn' ? 'নমিনীর মোবাইল' : 'Nominee Phone'}
                        </Label>
                        <Input
                          id="nomineePhone"
                          type="tel"
                          {...register('nomineePhone')}
                        />
                        {errors.nomineePhone && (
                          <p className="text-sm text-destructive">{errors.nomineePhone.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Documents & Agreement */}
                {currentStep === 3 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'প্রয়োজনীয় নথি' : 'Required Documents'}
                    </h3>
                    
                    <div className="bg-muted/50 rounded-lg p-4 text-sm">
                      <p className="font-medium mb-2">
                        {locale === 'bn' ? 'নিবন্ধন সম্পন্ন করতে নিচের নথিগুলো আপলোড বাধ্যতামূলক:' : 'All uploads below are mandatory to complete registration:'}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {locale === 'bn'
                          ? 'শুধু JPG/PNG/WebP, সর্বোচ্চ ১০MB।'
                          : 'Only JPG/PNG/WebP, up to 10MB each.'}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {documentFieldMeta.map((field) => (
                        <div key={field.key} className="space-y-2">
                          <Label htmlFor={field.key}>{field.label}</Label>
                          <Input
                            id={field.key}
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/webp"
                            onChange={(event) => handleDocumentChange(field.key, event)}
                          />
                          <p className="text-xs text-muted-foreground">{field.helper}</p>
                          {documentFiles[field.key] && (
                            <p className="text-xs text-emerald-700">
                              {locale === 'bn' ? 'নির্বাচিত:' : 'Selected:'} {documentFiles[field.key]?.name}
                            </p>
                          )}
                          {documentErrors[field.key] && (
                            <p className="text-xs text-destructive">{documentErrors[field.key]}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'নিয়মাবলী' : 'Rules & Regulations'}
                    </h3>
                    
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4 text-sm space-y-3">
                      <p>
                        {locale === 'bn'
                          ? '১. সুদ মুক্ত সমাজ গঠনের লক্ষ্যে এককালীন ১০০ টাকা অনুদান দিয়ে কর্জ প্রদানে ওয়াদাবদ্ধ হয়ে যে কেউ সদস্য হতে পারবে। উল্লেখ্য যে, সদস্যদের অনুদান অবশ্যই হালাল হতে হবে।'
                          : '1. Anyone can become a member by donating a one-time fee of ৳100 and committing to provide interest-free loans. Note: Member donations must be from halal sources.'}
                      </p>
                      <p>
                        {locale === 'bn'
                          ? '২. কোন সদস্য জমাকৃত টাকা উত্তোলন করতে চাইলে তাকে কমপক্ষে তিন মাস আগে কর্তৃপক্ষকে অবহিত করতে হবে।'
                          : '2. If a member wishes to withdraw deposited funds, they must notify the management at least three months in advance.'}
                      </p>
                      <p>
                        {locale === 'bn'
                          ? '৩. সদস্য জমাকৃত টাকার উপর কোন প্রকার লভ্যাংশ পাবে না।'
                          : '3. Members will not receive any interest or dividends on their deposited funds.'}
                      </p>
                    </div>

                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'অঙ্গীকারনামা' : 'Pledge'}
                    </h3>
                    
                    <div className="bg-muted/50 rounded-lg p-4 text-sm">
                      <p className="font-bengali">
                        {locale === 'bn'
                          ? 'আমি অঙ্গীকার করছি যে, অত্র ম্যানেজমেন্টের যাবতীয় নিয়ম কানুন নীতিমালা ও গৃহীত সকল সিদ্ধান্ত আন্তরিকভাবে মেনে চলব। অত্র ম্যানেজমেন্টের স্বার্থ ও মান ক্ষুন্ন ও নিয়ম পরিপন্থী কর্মকান্ডে লিপ্ত হব না।'
                          : 'I pledge that I will sincerely abide by all rules, regulations, policies, and decisions of this management. I will not engage in any activities that harm the interests or violate the rules of this management.'}
                      </p>
                    </div>

                    <div className="flex items-start gap-2 pt-4">
                      <input
                        type="checkbox"
                        id="agreeToTerms"
                        className="h-4 w-4 mt-1"
                        {...register('agreeToTerms')}
                      />
                      <Label htmlFor="agreeToTerms" className="text-sm font-normal">
                        {locale === 'bn'
                          ? 'আমি উপরের সকল নিয়মাবলী পড়েছি এবং মেনে চলতে সম্মত আছি *'
                          : 'I have read and agree to all the above rules and regulations *'}
                      </Label>
                    </div>
                    {errors.agreeToTerms && (
                      <p className="text-sm text-destructive">{errors.agreeToTerms.message}</p>
                    )}
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-8 pt-6 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    disabled={currentStep === 0}
                    className="gap-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {locale === 'bn' ? 'পেছনে' : 'Back'}
                  </Button>

                  {currentStep < steps.length - 1 ? (
                    <Button type="button" onClick={nextStep} className="gap-2">
                      {locale === 'bn' ? 'পরবর্তী' : 'Next'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isSubmitting} className="gap-2">
                      {isSubmitting ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          {submitStage === 'uploading'
                            ? (locale === 'bn' ? 'নথি আপলোড হচ্ছে...' : 'Uploading documents...')
                            : (locale === 'bn' ? 'জমা হচ্ছে...' : 'Submitting...')}
                        </span>
                      ) : (
                        <>
                          {locale === 'bn' ? 'নিবন্ধন সম্পন্ন করুন' : 'Complete Registration'}
                          <Check className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </form>

              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">
                  {locale === 'bn' ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}{' '}
                </span>
                <Link
                  href={`/${locale}/login`}
                  className="text-primary hover:underline font-medium"
                >
                  {locale === 'bn' ? 'সাইন ইন' : 'Sign In'}
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Back to home link */}
          <p className="text-center mt-8">
            <Link
              href={`/${locale}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {locale === 'bn' ? 'হোম পেজে ফিরে যান' : 'Back to home'}
            </Link>
          </p>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="border-t border-slate-100 py-6 mt-8">
        <p className="text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Hasnahena. {locale === 'bn' ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}
        </p>
      </footer>
    </div>
  );
}
