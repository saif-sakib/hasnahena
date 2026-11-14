'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useSWR from 'swr';
import {
  AlertCircle,
  Building2,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateOfBirthInput } from '@/components/ui/date-of-birth-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import {
  downscaleImageFile,
  formatFileSize,
  validateImageFile,
  UPLOAD_TYPES,
} from '@/lib/image-utils';
import {
  dateOfBirthMessage,
  dateOfBirthProblem,
  minimumAgeYears,
} from '@/lib/membership-eligibility';
import { fetchSettings } from '@/lib/settings-client';
import { cn } from '@/lib/utils';
import {
  getRegistrationFieldLabel,
  registerApiSchema,
  REGISTRATION_UPLOAD_LIMITS,
} from '@/lib/validation/registration';

export interface CreatedMemberSummary {
  id: string;
  accountNo: string;
  name: string;
  email: string;
  branchName: string;
  emailDelivered: boolean;
  deliveryError?: string;
}

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMemberCreated: (result: CreatedMemberSummary) => void;
  onPartialSave?: () => void;
}

interface BranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

type RegisterApiFormData = z.infer<typeof registerApiSchema>;
type ApiFieldName = FieldPath<RegisterApiFormData>;

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

const DOCUMENT_LABELS: Record<
  RequiredDocumentKey,
  { en: string; bn: string; helperEn: string; helperBn: string }
> = {
  nidFrontImage: {
    en: 'NID front image',
    bn: 'NID কার্ডের সামনের ছবি',
    helperEn: 'Capture the whole card, in focus',
    helperBn: 'স্পষ্ট ও পূর্ণ ফ্রেমে তুলুন',
  },
  nidBackImage: {
    en: 'NID back image',
    bn: 'NID কার্ডের পেছনের ছবি',
    helperEn: 'All text must be readable',
    helperBn: 'সব লেখা স্পষ্ট দেখা যেতে হবে',
  },
  memberPhotoImage: {
    en: 'Member passport photo',
    bn: 'সদস্যের পাসপোর্ট সাইজ ছবি',
    helperEn: 'Use a recent portrait photo',
    helperBn: 'সাম্প্রতিক ছবি দিন',
  },
  signatureImage: {
    en: 'Signature image',
    bn: 'স্বাক্ষরের ছবি',
    helperEn: 'Dark ink on white paper',
    helperBn: 'সাদা কাগজে কালো কালিতে',
  },
};

type DocumentSlot = {
  file: File;
  previewUrl: string;
  originalSize: number;
};

const EMPTY_DOCUMENTS: Record<RequiredDocumentKey, DocumentSlot | null> = {
  nidFrontImage: null,
  nidBackImage: null,
  memberPhotoImage: null,
  signatureImage: null,
};

const FORM_DEFAULT_VALUES: Partial<RegisterApiFormData> = {
  nameEn: '',
  nameBn: '',
  fatherName: '',
  motherName: '',
  phone: '',
  email: '',
  nidNumber: '',
  dateOfBirth: '',
  profession: '',
  maritalStatus: 'UNMARRIED',
  gender: 'MALE',
  bloodGroup: 'A+',
  childrenCount: 0,
  permanentHouseNo: '',
  permanentRoadNo: '',
  permanentVillage: '',
  permanentUnion: '',
  permanentPoliceStation: '',
  permanentDistrict: '',
  sameAsPermanent: true,
  presentHouseNo: '',
  presentRoadNo: '',
  presentVillage: '',
  presentUnion: '',
  presentPoliceStation: '',
  presentDistrict: '',
  nomineeName: '',
  nomineeRelationship: '',
  nomineeNid: '',
  nomineePhone: '',
};

const STEP_FIELDS = [
  // Step 0 — Personal & Office
  [
    'nameEn',
    'nameBn',
    'fatherName',
    'motherName',
    'phone',
    'email',
    'nidNumber',
    'gender',
    'dateOfBirth',
    'bloodGroup',
    'profession',
    'maritalStatus',
    'childrenCount',
  ],
  // Step 1 — Address
  [
    'permanentHouseNo',
    'permanentRoadNo',
    'permanentVillage',
    'permanentUnion',
    'permanentPoliceStation',
    'permanentDistrict',
    'sameAsPermanent',
    'presentHouseNo',
    'presentRoadNo',
    'presentVillage',
    'presentUnion',
    'presentPoliceStation',
    'presentDistrict',
  ],
  // Step 2 — Nominee
  ['nomineeName', 'nomineeRelationship', 'nomineeNid', 'nomineePhone'],
  // Step 3 — Documents
  [],
] as const satisfies ReadonlyArray<ReadonlyArray<ApiFieldName>>;

const CONDITIONAL_ADDRESS_FIELDS: ApiFieldName[] = [
  'presentHouseNo',
  'presentRoadNo',
  'presentVillage',
  'presentUnion',
  'presentPoliceStation',
  'presentDistrict',
];

const FIELD_CLASS = 'h-12 text-base sm:h-10 sm:text-sm';

const SELECT_CLASS = cn(
  'flex w-full rounded-sm border border-input bg-background px-3 py-2 shadow-none transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50',
  FIELD_CLASS,
);

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

interface ApproveRegistrationResult {
  message?: string;
  emailDelivered?: boolean;
  deliveryError?: string;
  accountNo?: string;
}

const DOCUMENTS_STEP = STEP_FIELDS.length - 1;

export default function AddMemberDialog({
  open,
  onOpenChange,
  onMemberCreated,
  onPartialSave,
}: AddMemberDialogProps) {
  const locale = useLocale();
  const isBn = locale === 'bn';
  const t = useTranslations('dashboard.addMember');

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState<'idle' | 'uploading' | 'approving'>('idle');
  const [documentFiles, setDocumentFiles] =
    useState<Record<RequiredDocumentKey, DocumentSlot | null>>(EMPTY_DOCUMENTS);
  const [documentErrors, setDocumentErrors] = useState<
    Partial<Record<RequiredDocumentKey, string>>
  >({});
  const [processingDocument, setProcessingDocument] = useState<RequiredDocumentKey | null>(null);
  const [savedPendingApp, setSavedPendingApp] = useState<{
    id: string;
    formNumber: string;
    name: string;
    email: string;
  } | null>(null);

  const submittingRef = useRef(false);
  const contentTopRef = useRef<HTMLDivElement | null>(null);

  const { data: settings } = useSWR<Record<string, string> | null>(
    open ? '/api/v1/settings' : null,
    () => fetchSettings(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const minimumAge = minimumAgeYears(settings);

  const { data: branches } = useSWR<BranchOption[], Error>(
    open ? '/api/v1/admin/branches' : null,
    async (url: string) => {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to load offices');
      }
      return payload.data as BranchOption[];
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const activeBranches = useMemo(
    () => (branches ?? []).filter((branch) => branch.isActive),
    [branches],
  );

  const effectiveBranchId =
    selectedBranchId ?? (activeBranches.length === 1 ? activeBranches[0].id : '');

  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    trigger,
    setError,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<RegisterApiFormData>({
    resolver: zodResolver(registerApiSchema),
    defaultValues: FORM_DEFAULT_VALUES,
    mode: 'onChange',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });

  const watchedSameAsPermanent = useWatch({ control, name: 'sameAsPermanent' });
  const sameAsPermanent = watchedSameAsPermanent ?? true;
  const maritalStatus = useWatch({ control, name: 'maritalStatus' });
  const watchedDateOfBirth = useWatch({ control, name: 'dateOfBirth' });

  const stepTitles = [
    t('stepPersonal'),
    t('stepAddress'),
    t('stepNominee'),
    t('stepDocuments'),
  ];

  const resetDialogState = useCallback(() => {
    for (const key of REQUIRED_DOCUMENT_KEYS) {
      const slot = documentFiles[key];
      if (slot) URL.revokeObjectURL(slot.previewUrl);
    }
    reset(FORM_DEFAULT_VALUES);
    setDocumentFiles(EMPTY_DOCUMENTS);
    setDocumentErrors({});
    setProcessingDocument(null);
    setCurrentStep(0);
    setSelectedBranchId(null);
    setSubmitError(null);
    setSubmitStage('idle');
    setSavedPendingApp(null);
  }, [documentFiles, reset]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (submittingRef.current || submitStage !== 'idle')) {
      return;
    }
    if (!nextOpen) {
      resetDialogState();
    }
    onOpenChange(nextOpen);
  };

  const scrollToTop = () => {
    contentTopRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const flagMissingDocuments = useCallback((): RequiredDocumentKey[] => {
    const missing = REQUIRED_DOCUMENT_KEYS.filter((key) => !documentFiles[key]);
    if (missing.length > 0) {
      setDocumentErrors((prev) => {
        const next = { ...prev };
        for (const key of missing) {
          next[key] = isBn ? 'এই ফাইলটি প্রয়োজন' : 'This file is required';
        }
        return next;
      });
    }
    return missing;
  }, [documentFiles, isBn]);

  const fieldsForStep = useCallback(
    (step: number): ApiFieldName[] => {
      const fields = [...STEP_FIELDS[step]] as ApiFieldName[];
      if (step === 1 && sameAsPermanent) {
        return fields.filter((field) => !CONDITIONAL_ADDRESS_FIELDS.includes(field));
      }
      return fields;
    },
    [sameAsPermanent],
  );

  const checkContactAvailability = useCallback(
    async (emailValue: string, phoneValue: string): Promise<'available' | 'taken' | 'error'> => {
      const email = emailValue.trim().toLowerCase();
      const phone = phoneValue.trim();
      if (!email && !phone) return 'available';

      try {
        const params = new URLSearchParams();
        if (email) params.set('email', email);
        if (phone) params.set('phone', phone);

        const response = await fetch(`/api/v1/registrations?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) return 'error';
        const json = (await response.json().catch(() => ({}))) as {
          emailExists?: boolean;
          phoneExists?: boolean;
        };

        const emailTaken = Boolean(email) && Boolean(json.emailExists);
        const phoneTaken = Boolean(phone) && Boolean(json.phoneExists);

        if (emailTaken) {
          setError('email', {
            type: 'manual',
            message: isBn ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
          });
        }
        if (phoneTaken) {
          setError('phone', {
            type: 'manual',
            message: isBn
              ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
              : 'This phone number is already registered',
          });
        }
        return emailTaken || phoneTaken ? 'taken' : 'available';
      } catch {
        return 'error';
      }
    },
    [isBn, setError],
  );

  const nextStep = async () => {
    setSubmitError(null);

    const fieldsToValidate = fieldsForStep(currentStep);
    const isValid = fieldsToValidate.length === 0 ? true : await trigger(fieldsToValidate);

    if (!isValid) {
      const badFields = fieldsToValidate.filter((field) => getFieldState(field).invalid);
      const labels = badFields.map((field) => getRegistrationFieldLabel(field, isBn ? 'bn' : 'en'));
      setSubmitError(
        labels.length
          ? isBn
            ? `এই তথ্যগুলো ঠিক করুন: ${labels.join(', ')}`
            : `Please correct: ${labels.join(', ')}`
          : isBn
            ? 'সব প্রয়োজনীয় ফিল্ড সঠিকভাবে পূরণ করুন।'
            : 'Please fill all required fields correctly.',
      );
      scrollToTop();
      return;
    }

    if (currentStep === 0) {
      const dobProblem = dateOfBirthProblem(getValues('dateOfBirth'), minimumAge);
      if (dobProblem) {
        const message = dateOfBirthMessage(dobProblem, minimumAge, isBn ? 'bn' : 'en');
        setError('dateOfBirth', { type: 'manual', message });
        setSubmitError(message);
        scrollToTop();
        return;
      }

      const availability = await checkContactAvailability(getValues('email'), getValues('phone'));
      if (availability === 'taken') {
        setSubmitError(
          isBn
            ? 'এই ই-মেইল বা মোবাইল নম্বর আগে থেকেই ব্যবহৃত হয়েছে।'
            : 'This email or phone number is already in use.',
        );
        scrollToTop();
        return;
      }
    }

    if (currentStep === 2) {
      const applicantNid = String(getValues('nidNumber') ?? '').trim();
      const nomineeNid = String(getValues('nomineeNid') ?? '').trim();
      if (applicantNid && nomineeNid && applicantNid === nomineeNid) {
        const message = isBn
          ? 'নমিনী আবেদনকারী নিজে হতে পারেন না। অন্য ব্যক্তির এন.আই.ডি দিন।'
          : 'The nominee cannot be the applicant. Enter the nominee’s own NID number.';
        setError('nomineeNid', { type: 'manual', message });
        setSubmitError(message);
        scrollToTop();
        return;
      }
    }

    if (currentStep < STEP_FIELDS.length - 1) {
      setCurrentStep((prev) => prev + 1);
      scrollToTop();
    }
  };

  const prevStep = () => {
    setSubmitError(null);
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      scrollToTop();
    }
  };

  const goToStep = (index: number) => {
    if (index < currentStep && !submittingRef.current && submitStage === 'idle') {
      setSubmitError(null);
      setCurrentStep(index);
      scrollToTop();
    }
  };

  const handleDocumentChange = async (
    key: RequiredDocumentKey,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    setSubmitError(null);
    event.target.value = '';
    if (!file) return;

    setProcessingDocument(key);
    try {
      const typeCheck = validateImageFile(file, {
        acceptedTypes: UPLOAD_TYPES.avatar,
        maxSizeMB: Number.MAX_SAFE_INTEGER,
      });
      if (!typeCheck.valid) {
        setDocumentErrors((prev) => ({
          ...prev,
          [key]: isBn
            ? 'শুধু JPG, PNG বা WebP ছবি দিন।'
            : 'Only JPG, PNG or WebP images are accepted.',
        }));
        return;
      }

      const processed = await downscaleImageFile(file);
      const sizeCheck = validateImageFile(processed, {
        acceptedTypes: UPLOAD_TYPES.avatar,
        maxSizeMB: REGISTRATION_UPLOAD_LIMITS.PER_FILE_MB,
      });
      if (!sizeCheck.valid) {
        setDocumentErrors((prev) => ({
          ...prev,
          [key]: isBn
            ? `ছবিটি খুব বড় (${formatFileSize(processed.size)})। কম রেজোলিউশনে তুলুন।`
            : `Still too large after compression (${formatFileSize(processed.size)}). Use a lower-resolution photo.`,
        }));
        return;
      }

      setDocumentFiles((prev) => {
        const existing = prev[key];
        if (existing) URL.revokeObjectURL(existing.previewUrl);
        return {
          ...prev,
          [key]: {
            file: processed,
            previewUrl: URL.createObjectURL(processed),
            originalSize: file.size,
          },
        };
      });
      setDocumentErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } finally {
      setProcessingDocument(null);
    }
  };

  const clearDocument = (key: RequiredDocumentKey) => {
    setDocumentFiles((prev) => {
      const existing = prev[key];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return { ...prev, [key]: null };
    });
    setDocumentErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const approveAndRefile = async (application: {
    id: string;
    formNumber: string;
    name: string;
    email: string;
  }) => {
    setSubmitStage('approving');
    const approvalResult = await apiPost<ApproveRegistrationResult>(
      '/v1/dashboard/admin/approvals/registration',
      {
        userId: application.id,
        notes: 'Registered directly by admin',
        locale,
        branchId: effectiveBranchId,
      },
    );

    const accountNo = approvalResult.accountNo ?? '';
    const memberId = accountNo || application.id;

    // File documents under people/<accountNo> (ADR-040); best effort so an asset
    // move hiccup never cancels the committed member admission.
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
      await fetch(`/api/v1/admin/members/${memberId}/refile-documents`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // The nightly retention sweep retries unfiled application folders.
    }

    const branchName =
      activeBranches.find((branch) => branch.id === effectiveBranchId)?.name ?? '';

    const summary: CreatedMemberSummary = {
      id: memberId,
      accountNo,
      name: application.name,
      email: application.email,
      branchName,
      emailDelivered: approvalResult.emailDelivered !== false,
      deliveryError: approvalResult.deliveryError,
    };

    resetDialogState();
    onMemberCreated(summary);
    onOpenChange(false);
  };

  const onSubmit = async (data: RegisterApiFormData) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);

    try {
      // If the application row was already saved in a prior attempt and only
      // approval failed (e.g. branch error), retry approval directly.
      if (savedPendingApp) {
        try {
          await approveAndRefile(savedPendingApp);
        } catch (approvalErr) {
          const reason =
            approvalErr instanceof Error ? approvalErr.message : 'Approval failed';
          setSubmitStage('idle');
          setSubmitError(
            t('approvalFallbackWarning', {
              formNumber: savedPendingApp.formNumber,
              reason,
            }),
          );
          onPartialSave?.();
          scrollToTop();
        }
        return;
      }

      const missingDocuments = flagMissingDocuments();
      if (missingDocuments.length > 0) {
        const missingLabels = missingDocuments.map((key) =>
          isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
        );
        setSubmitError(
          isBn
            ? `চারটি ছবিই দিতে হবে। বাকি আছে: ${missingLabels.join(', ')}`
            : `All four document photos are required. Still needed: ${missingLabels.join(', ')}`,
        );
        scrollToTop();
        return;
      }

      if (Object.values(documentErrors).some(Boolean)) {
        setSubmitError(
          isBn
            ? 'নথির ত্রুটিগুলো ঠিক করে আবার চেষ্টা করুন।'
            : 'Please fix the document upload errors and try again.',
        );
        scrollToTop();
        return;
      }

      const totalUploadBytes = REQUIRED_DOCUMENT_KEYS.reduce(
        (sum, key) => sum + (documentFiles[key]?.file.size ?? 0),
        0,
      );
      if (totalUploadBytes > REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES) {
        setSubmitError(
          isBn
            ? `নথির মোট সাইজ ${formatFileSize(totalUploadBytes)} — সর্বোচ্চ ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL}। ছোট ছবি দিন।`
            : `Documents total ${formatFileSize(totalUploadBytes)}, above the ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL} limit. Replace one with a smaller photo.`,
        );
        scrollToTop();
        return;
      }

      const dobProblem = dateOfBirthProblem(data.dateOfBirth, minimumAge);
      if (dobProblem) {
        const message = dateOfBirthMessage(dobProblem, minimumAge, isBn ? 'bn' : 'en');
        setError('dateOfBirth', { type: 'manual', message });
        setCurrentStep(0);
        setSubmitError(message);
        scrollToTop();
        return;
      }

      if (data.nomineeNid.trim() === data.nidNumber.trim()) {
        const message = isBn
          ? 'নমিনী আবেদনকারী নিজে হতে পারেন না।'
          : 'The nominee cannot be the applicant.';
        setError('nomineeNid', { type: 'manual', message });
        setCurrentStep(2);
        setSubmitError(message);
        scrollToTop();
        return;
      }

      setSubmitStage('uploading');

      const formData = new FormData();
      formData.append(
        'payload',
        JSON.stringify({
          ...data,
          sameAsPermanent: data.sameAsPermanent ?? true,
        }),
      );
      formData.append('locale', isBn ? 'bn' : 'en');
      for (const key of REQUIRED_DOCUMENT_KEYS) {
        const slot = documentFiles[key];
        if (slot) formData.append(key, slot.file);
      }

      const response = await fetch('/api/v1/registrations', {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let json: {
        error?: string;
        field?: string;
        details?: {
          fieldErrors?: Record<string, string[] | undefined>;
          formErrors?: string[];
        };
        user?: { id?: string; formNumber?: string; email?: string; nameEn?: string };
      } = {};
      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch {
        json = {};
      }

      if (!response.ok || !json?.user?.id) {
        setSubmitStage('idle');

        if (response.status === 409) {
          const conflictTarget = `${json.field || ''} ${json.error || ''}`;
          const conflictField: ApiFieldName = /phone/i.test(conflictTarget)
            ? 'phone'
            : /nid/i.test(conflictTarget)
              ? 'nidNumber'
              : 'email';
          setError(conflictField, {
            type: 'manual',
            message:
              conflictField === 'phone'
                ? isBn
                  ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
                  : 'This phone number is already registered'
                : conflictField === 'nidNumber'
                  ? isBn
                    ? 'এই এন.আই.ডি নম্বর ইতোমধ্যে নিবন্ধিত'
                    : 'This NID number is already registered'
                  : isBn
                    ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত'
                    : 'This email is already registered',
          });
          setSubmitError(
            json.error ||
              (isBn
                ? 'এই তথ্য দিয়ে ইতোমধ্যে সদস্য নিবন্ধিত আছেন। প্রথম ধাপে গিয়ে সংশোধন করুন।'
                : 'A member with this detail already exists. Correct it on step 1 and try again.'),
          );
          setCurrentStep(0);
          scrollToTop();
          return;
        }

        if (response.status === 413) {
          setSubmitError(
            isBn
              ? `নথিগুলো খুব বড়। সর্বোচ্চ ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL}।`
              : `Documents are too large. Keep them under ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL}.`,
          );
          scrollToTop();
          return;
        }

        const fieldErrorMessages =
          json?.details?.fieldErrors && typeof json.details.fieldErrors === 'object'
            ? Object.entries(json.details.fieldErrors)
                .map(([field, messages]) => {
                  const safeMessages = Array.isArray(messages)
                    ? messages.filter(
                        (msg): msg is string => typeof msg === 'string' && msg.trim() !== '',
                      )
                    : [];
                  if (!safeMessages.length) return '';
                  return `${getRegistrationFieldLabel(field, isBn ? 'bn' : 'en')}: ${safeMessages.join(', ')}`;
                })
                .filter(Boolean)
                .join('\n')
            : '';

        const serverMessage =
          typeof json?.error === 'string' && json.error.trim() ? json.error.trim() : '';
        setSubmitError(
          fieldErrorMessages ||
            serverMessage ||
            (isBn ? 'নিবন্ধন ব্যর্থ হয়েছে।' : 'Registration failed. Please try again.'),
        );
        scrollToTop();
        return;
      }

      const pendingApp = {
        id: json.user.id,
        formNumber: json.user.formNumber || json.user.id,
        name: json.user.nameEn || data.nameEn,
        email: json.user.email || data.email,
      };
      setSavedPendingApp(pendingApp);

      try {
        await approveAndRefile(pendingApp);
      } catch (approvalErr) {
        const reason =
          approvalErr instanceof Error ? approvalErr.message : 'Approval failed';
        setSubmitStage('idle');
        setSubmitError(
          t('approvalFallbackWarning', {
            formNumber: pendingApp.formNumber,
            reason,
          }),
        );
        onPartialSave?.();
        scrollToTop();
      }
    } catch {
      setSubmitStage('idle');
      setSubmitError(
        isBn
          ? 'নিবন্ধন সম্পন্ন করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
          : 'Could not complete registration. Check your connection and try again.',
      );
      scrollToTop();
    } finally {
      submittingRef.current = false;
    }
  };

  const onInvalidSubmit = (formErrors: FieldErrors<RegisterApiFormData>) => {
    const errored = (Object.keys(formErrors) as ApiFieldName[]).filter((field) => {
      if (sameAsPermanent && CONDITIONAL_ADDRESS_FIELDS.includes(field)) return false;
      return STEP_FIELDS.some((fields) => (fields as readonly string[]).includes(field));
    });

    if (!errored.length) {
      const missingDocuments = currentStep === DOCUMENTS_STEP ? flagMissingDocuments() : [];
      if (missingDocuments.length) {
        const missingLabels = missingDocuments.map((key) =>
          isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
        );
        setSubmitError(
          isBn
            ? `এই নথিগুলো দিন: ${missingLabels.join(', ')}`
            : `Upload these documents: ${missingLabels.join(', ')}`,
        );
      } else {
        setSubmitError(
          isBn ? 'ফর্মের তথ্যগুলো আবার যাচাই করুন।' : 'Please review the form details.',
        );
      }
      scrollToTop();
      return;
    }

    let targetStep = DOCUMENTS_STEP;
    for (const [index, fields] of STEP_FIELDS.entries()) {
      if (errored.some((field) => (fields as readonly string[]).includes(field))) {
        targetStep = index;
        break;
      }
    }

    const fieldsOnTarget = errored.filter((field) =>
      (STEP_FIELDS[targetStep] as readonly string[]).includes(field),
    );
    const labels = fieldsOnTarget.map((field) =>
      getRegistrationFieldLabel(field, isBn ? 'bn' : 'en'),
    );

    setSubmitError(
      isBn
        ? `${stepTitles[targetStep]} ধাপে এই তথ্যগুলো ঠিক করুন: ${labels.join(', ')}`
        : `Fix these on the "${stepTitles[targetStep]}" step: ${labels.join(', ')}`,
    );
    setCurrentStep(targetStep);
    scrollToTop();
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submittingRef.current) {
      event.preventDefault();
      return;
    }
    if (currentStep < DOCUMENTS_STEP) {
      event.preventDefault();
      void nextStep();
      return;
    }
    void handleSubmit(onSubmit, onInvalidSubmit)(event);
  };

  const uploadedCount = REQUIRED_DOCUMENT_KEYS.filter((key) => documentFiles[key]).length;
  const totalUploadBytes = REQUIRED_DOCUMENT_KEYS.reduce(
    (sum, key) => sum + (documentFiles[key]?.file.size ?? 0),
    0,
  );
  const busy = isSubmitting || submitStage !== 'idle';

  const documentFieldMeta = REQUIRED_DOCUMENT_KEYS.map((key) => ({
    key,
    label: isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
    helper: isBn ? DOCUMENT_LABELS[key].helperBn : DOCUMENT_LABELS[key].helperEn,
  }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentTopRef}
        className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6"
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="space-y-2 border-b pb-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('stepIndicator', { current: currentStep + 1, total: STEP_FIELDS.length })}</span>
            <span className="font-medium text-foreground">{stepTitles[currentStep]}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {stepTitles.map((title, index) => {
              const done = index < currentStep;
              const active = index === currentStep;
              return (
                <button
                  key={title}
                  type="button"
                  onClick={() => goToStep(index)}
                  disabled={index >= currentStep || busy}
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-sm border px-2 py-1.5 text-xs font-medium transition-colors',
                    done && 'border-primary/40 bg-primary/10 text-primary cursor-pointer',
                    active && 'border-primary bg-primary text-primary-foreground',
                    !done && !active && 'border-gray-200 bg-gray-50 text-gray-500',
                  )}
                >
                  {done ? <Check className="h-3 w-3 shrink-0" /> : <span>{index + 1}.</span>}
                  <span className="truncate">{title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {submitError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 whitespace-pre-line rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
          {/* Step 0: Personal Info & Office */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nameEn">
                    {isBn ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nameEn"
                    placeholder="Full name in English"
                    aria-invalid={Boolean(errors.nameEn)}
                    {...register('nameEn')}
                  />
                  <FieldError message={errors.nameEn?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nameBn">
                    {isBn ? 'নাম (বাংলা)' : 'Name (Bengali)'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nameBn"
                    placeholder="পূর্ণ নাম বাংলায়"
                    aria-invalid={Boolean(errors.nameBn)}
                    {...register('nameBn')}
                  />
                  <FieldError message={errors.nameBn?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-fatherName">
                    {isBn ? 'পিতার নাম *' : "Father's Name *"}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-fatherName"
                    aria-invalid={Boolean(errors.fatherName)}
                    {...register('fatherName')}
                  />
                  <FieldError message={errors.fatherName?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-motherName">
                    {isBn ? 'মাতার নাম *' : "Mother's Name *"}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-motherName"
                    aria-invalid={Boolean(errors.motherName)}
                    {...register('motherName')}
                  />
                  <FieldError message={errors.motherName?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-phone">
                    {isBn ? 'মোবাইল নম্বর *' : 'Mobile Number *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="01XXXXXXXXX"
                    aria-invalid={Boolean(errors.phone)}
                    {...register('phone')}
                  />
                  <FieldError message={errors.phone?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-email">{isBn ? 'ই-মেইল *' : 'Email *'}</Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="name@example.com"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                  <FieldError message={errors.email?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nidNumber">
                    {isBn ? 'এন.আই.ডি নং *' : 'NID Number *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nidNumber"
                    inputMode="numeric"
                    maxLength={17}
                    placeholder={isBn ? '১০, ১৩ বা ১৭ সংখ্যা' : '10, 13 or 17 digits'}
                    aria-invalid={Boolean(errors.nidNumber)}
                    {...register('nidNumber')}
                  />
                  <FieldError message={errors.nidNumber?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-gender">{isBn ? 'লিঙ্গ *' : 'Gender *'}</Label>
                  <select
                    id="add-member-gender"
                    className={SELECT_CLASS}
                    aria-invalid={Boolean(errors.gender)}
                    {...register('gender')}
                  >
                    <option value="MALE">{isBn ? 'পুরুষ' : 'Male'}</option>
                    <option value="FEMALE">{isBn ? 'মহিলা' : 'Female'}</option>
                    <option value="OTHER">{isBn ? 'অন্যান্য' : 'Other'}</option>
                  </select>
                  <FieldError message={errors.gender?.message} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-member-dateOfBirth">
                  {isBn ? 'জন্ম তারিখ *' : 'Date of Birth *'}
                </Label>
                <DateOfBirthInput
                  id="add-member-dateOfBirth"
                  locale={isBn ? 'bn' : 'en'}
                  minimumAge={minimumAge}
                  invalid={Boolean(errors.dateOfBirth)}
                  value={watchedDateOfBirth ?? ''}
                  onChange={(next) =>
                    setValue('dateOfBirth', next, { shouldValidate: true, shouldDirty: true })
                  }
                />
                <FieldError message={errors.dateOfBirth?.message} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-bloodGroup">
                    {isBn ? 'রক্তের গ্রুপ *' : 'Blood Group *'}
                  </Label>
                  <select
                    id="add-member-bloodGroup"
                    className={SELECT_CLASS}
                    aria-invalid={Boolean(errors.bloodGroup)}
                    {...register('bloodGroup')}
                  >
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors.bloodGroup?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-profession">
                    {isBn ? 'পেশা *' : 'Profession *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-profession"
                    placeholder={
                      isBn ? 'যেমন: কৃষক, শিক্ষক, ব্যবসায়ী' : 'e.g. Farmer, Teacher, Business'
                    }
                    aria-invalid={Boolean(errors.profession)}
                    {...register('profession')}
                  />
                  <FieldError message={errors.profession?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-maritalStatus">
                    {isBn ? 'বৈবাহিক অবস্থা *' : 'Marital Status *'}
                  </Label>
                  <select
                    id="add-member-maritalStatus"
                    className={SELECT_CLASS}
                    aria-invalid={Boolean(errors.maritalStatus)}
                    {...register('maritalStatus', {
                      onChange: (event) => {
                        if (event.target.value === 'UNMARRIED') {
                          setValue('childrenCount', 0, {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                        }
                      },
                    })}
                  >
                    <option value="UNMARRIED">{isBn ? 'অবিবাহিত' : 'Unmarried'}</option>
                    <option value="MARRIED">{isBn ? 'বিবাহিত' : 'Married'}</option>
                  </select>
                  <FieldError message={errors.maritalStatus?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-childrenCount">
                    {isBn ? 'সন্তানের সংখ্যা' : 'Number of Children'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-childrenCount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={20}
                    disabled={maritalStatus === 'UNMARRIED'}
                    aria-invalid={Boolean(errors.childrenCount)}
                    {...register('childrenCount', { valueAsNumber: true })}
                  />
                  <FieldError message={errors.childrenCount?.message} />
                </div>
              </div>

              {/* Assigned Office / Branch */}
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="add-member-branch">{t('officeLabel')}</Label>
                {activeBranches.length > 0 ? (
                  <>
                    <select
                      id="add-member-branch"
                      value={effectiveBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">{t('officeNone')}</option>
                      {activeBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} ({branch.id})
                        </option>
                      ))}
                    </select>
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{t('officeHint')}</span>
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('officeNone')}</p>
                )}
              </div>

              <div className="rounded-sm border border-primary/30 bg-primary/5 p-3 text-xs sm:text-sm text-foreground">
                {t('passwordNotice')}
              </div>
            </div>
          )}

          {/* Step 1: Address */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="border-b pb-2 text-sm font-semibold">
                {isBn ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}
              </h3>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentHouseNo">
                    {isBn ? 'বাড়ী নং *' : 'House No *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentHouseNo"
                    aria-invalid={Boolean(errors.permanentHouseNo)}
                    {...register('permanentHouseNo')}
                  />
                  <FieldError message={errors.permanentHouseNo?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentRoadNo">
                    {isBn ? 'রোড নং' : 'Road No'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentRoadNo"
                    aria-invalid={Boolean(errors.permanentRoadNo)}
                    {...register('permanentRoadNo')}
                  />
                  <FieldError message={errors.permanentRoadNo?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentVillage">
                    {isBn ? 'গ্রাম *' : 'Village *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentVillage"
                    aria-invalid={Boolean(errors.permanentVillage)}
                    {...register('permanentVillage')}
                  />
                  <FieldError message={errors.permanentVillage?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentUnion">
                    {isBn ? 'ইউনিয়ন *' : 'Union *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentUnion"
                    aria-invalid={Boolean(errors.permanentUnion)}
                    {...register('permanentUnion')}
                  />
                  <FieldError message={errors.permanentUnion?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentPoliceStation">
                    {isBn ? 'থানা *' : 'Police Station *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentPoliceStation"
                    aria-invalid={Boolean(errors.permanentPoliceStation)}
                    {...register('permanentPoliceStation')}
                  />
                  <FieldError message={errors.permanentPoliceStation?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-permanentDistrict">
                    {isBn ? 'জেলা *' : 'District *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-permanentDistrict"
                    aria-invalid={Boolean(errors.permanentDistrict)}
                    {...register('permanentDistrict')}
                  />
                  <FieldError message={errors.permanentDistrict?.message} />
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-sm border bg-muted/40 p-3">
                <input
                  type="checkbox"
                  id="add-member-sameAsPermanent"
                  className="h-5 w-5 shrink-0 accent-primary"
                  {...register('sameAsPermanent')}
                />
                <Label
                  htmlFor="add-member-sameAsPermanent"
                  className="text-sm font-normal leading-snug"
                >
                  {isBn
                    ? 'বর্তমান ঠিকানা স্থায়ী ঠিকানার সাথে একই'
                    : 'Present address is same as permanent address'}
                </Label>
              </div>

              {!sameAsPermanent && (
                <>
                  <h3 className="border-b pb-2 text-sm font-semibold">
                    {isBn ? 'বর্তমান ঠিকানা' : 'Present Address'}
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentHouseNo">
                        {isBn ? 'বাড়ী নং *' : 'House No *'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentHouseNo"
                        aria-invalid={Boolean(errors.presentHouseNo)}
                        {...register('presentHouseNo')}
                      />
                      <FieldError message={errors.presentHouseNo?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentRoadNo">
                        {isBn ? 'রোড নং' : 'Road No'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentRoadNo"
                        aria-invalid={Boolean(errors.presentRoadNo)}
                        {...register('presentRoadNo')}
                      />
                      <FieldError message={errors.presentRoadNo?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentVillage">
                        {isBn ? 'গ্রাম *' : 'Village *'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentVillage"
                        aria-invalid={Boolean(errors.presentVillage)}
                        {...register('presentVillage')}
                      />
                      <FieldError message={errors.presentVillage?.message} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentUnion">
                        {isBn ? 'ইউনিয়ন *' : 'Union *'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentUnion"
                        aria-invalid={Boolean(errors.presentUnion)}
                        {...register('presentUnion')}
                      />
                      <FieldError message={errors.presentUnion?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentPoliceStation">
                        {isBn ? 'থানা *' : 'Police Station *'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentPoliceStation"
                        aria-invalid={Boolean(errors.presentPoliceStation)}
                        {...register('presentPoliceStation')}
                      />
                      <FieldError message={errors.presentPoliceStation?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="add-member-presentDistrict">
                        {isBn ? 'জেলা *' : 'District *'}
                      </Label>
                      <Input
                        className={FIELD_CLASS}
                        id="add-member-presentDistrict"
                        aria-invalid={Boolean(errors.presentDistrict)}
                        {...register('presentDistrict')}
                      />
                      <FieldError message={errors.presentDistrict?.message} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 2: Nominee */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nomineeName">
                    {isBn ? 'নমিনীর নাম *' : 'Nominee Name *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nomineeName"
                    aria-invalid={Boolean(errors.nomineeName)}
                    {...register('nomineeName')}
                  />
                  <FieldError message={errors.nomineeName?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nomineeRelationship">
                    {isBn ? 'সম্পর্ক *' : 'Relationship *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nomineeRelationship"
                    placeholder={
                      isBn
                        ? 'যেমন: পিতা, মাতা, স্ত্রী, স্বামী'
                        : 'e.g. Father, Mother, Wife, Husband'
                    }
                    aria-invalid={Boolean(errors.nomineeRelationship)}
                    {...register('nomineeRelationship')}
                  />
                  <FieldError message={errors.nomineeRelationship?.message} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nomineeNid">
                    {isBn ? 'নমিনীর NID *' : 'Nominee NID *'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nomineeNid"
                    inputMode="numeric"
                    maxLength={17}
                    placeholder={isBn ? '১০, ১৩ বা ১৭ সংখ্যা' : '10, 13 or 17 digits'}
                    aria-invalid={Boolean(errors.nomineeNid)}
                    {...register('nomineeNid')}
                  />
                  <FieldError message={errors.nomineeNid?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="add-member-nomineePhone">
                    {isBn ? 'নমিনীর মোবাইল' : 'Nominee Phone'}
                  </Label>
                  <Input
                    className={FIELD_CLASS}
                    id="add-member-nomineePhone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="01XXXXXXXXX"
                    aria-invalid={Boolean(errors.nomineePhone)}
                    {...register('nomineePhone')}
                  />
                  <FieldError message={errors.nomineePhone?.message} />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Documents */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                <h3 className="text-sm font-semibold">
                  {isBn ? 'প্রয়োজনীয় নথি (৪টি আবশ্যক)' : 'Required Documents (All 4 Required)'}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {uploadedCount}/{REQUIRED_DOCUMENT_KEYS.length}
                  {totalUploadBytes > 0 ? ` · ${formatFileSize(totalUploadBytes)}` : ''}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {documentFieldMeta.map((field) => {
                  const slot = documentFiles[field.key];
                  const isProcessing = processingDocument === field.key;
                  const inputId = `add-member-${field.key}`;
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={inputId}>{field.label} *</Label>
                      <input
                        id={inputId}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        className="sr-only"
                        onChange={(event) => void handleDocumentChange(field.key, event)}
                      />
                      {slot ? (
                        <div className="flex items-center gap-3 rounded-sm border p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={slot.previewUrl}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-sm border object-cover"
                          />
                          <div className="min-w-0 flex-1 text-xs">
                            <p className="truncate font-medium">{slot.file.name}</p>
                            <p className="text-muted-foreground tabular-nums">
                              {formatFileSize(slot.file.size)}
                              {slot.originalSize > slot.file.size && (
                                <>
                                  {' '}
                                  <span className="text-primary">
                                    ({isBn ? 'ছোট করা হয়েছে' : 'compressed'})
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => clearDocument(field.key)}
                            aria-label={isBn ? 'ছবি সরান' : 'Remove image'}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <Label
                          htmlFor={inputId}
                          className={cn(
                            'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed p-3 text-center transition-colors',
                            documentErrors[field.key]
                              ? 'border-destructive/50 bg-destructive/5'
                              : 'hover:border-primary hover:bg-primary/5',
                          )}
                        >
                          {isProcessing ? (
                            <>
                              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                              <span className="text-xs text-muted-foreground">
                                {isBn ? 'ছবি প্রস্তুত হচ্ছে...' : 'Preparing image…'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Camera className="h-5 w-5 text-muted-foreground" aria-hidden />
                              <span className="text-xs font-medium">
                                {isBn ? 'ছবি তুলুন বা বেছে নিন' : 'Choose or take photo'}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {field.helper}
                              </span>
                            </>
                          )}
                        </Label>
                      )}
                      <FieldError message={documentErrors[field.key]} />
                    </div>
                  );
                })}
              </div>

              <div className="rounded-sm border border-primary/30 bg-primary/5 p-3 text-xs sm:text-sm text-foreground">
                {t('passwordNotice')}
              </div>
            </div>
          )}

          {/* Footer Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                {t('cancel')}
              </Button>
              {currentStep > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={prevStep}
                  disabled={busy}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('back')}
                </Button>
              )}
            </div>

            {currentStep < DOCUMENTS_STEP ? (
              <Button
                key="next-step"
                type="button"
                size="sm"
                onClick={() => void nextStep()}
                disabled={busy}
                className="gap-1"
              >
                {t('next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button key="submit-member" type="submit" size="sm" disabled={busy} className="gap-1.5">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {submitStage === 'approving'
                      ? t('submittingApprove')
                      : t('submittingUpload')}
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    {t('submit')}
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
