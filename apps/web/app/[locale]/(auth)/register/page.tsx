'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  User,
  MapPin,
  Users,
  FileText,
  Globe,
  Loader2,
  AlertCircle,
  Camera,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  bdPhoneRegex,
  getRegistrationFieldLabel,
  registerSchema,
  REGISTRATION_UPLOAD_LIMITS,
  type RegisterFormData,
} from '@/lib/validation/registration';
import {
  downscaleImageFile,
  formatFileSize,
  validateImageFile,
  UPLOAD_TYPES,
} from '@/lib/image-utils';
import { localePath, otherLocale } from '@/lib/locale-path';

const steps = [
  { id: 'personal', icon: User },
  { id: 'address', icon: MapPin },
  { id: 'nominee', icon: Users },
  { id: 'documents', icon: FileText },
];

/** The uploads-and-agreement step. Named because three code paths test for it. */
const DOCUMENTS_STEP = steps.length - 1;

const emailSchema = z.string().email();
type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type RegisterFieldName = FieldPath<RegisterFormData>;

const REGISTRATION_DRAFT_KEY_PREFIX = 'hn_registration_draft_v1';

// A half-finished form is worth restoring for a few days; a two-month-old one
// is a stranger's data sitting on what may be a shared handset, and a schema
// this draft predates. Expire it rather than silently repopulating.
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * The four uploads, named.
 *
 * At module scope rather than inline in the step, because the error summary has
 * to name a missing document and the summary is built before the step renders.
 * These are not schema fields — the files live in component state, not in the
 * zod form — so nothing else knows what to call them.
 */
const DOCUMENT_LABELS: Record<RequiredDocumentKey, { en: string; bn: string; helperEn: string; helperBn: string }> = {
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
    en: 'Your passport photo',
    bn: 'আপনার পাসপোর্ট সাইজ ছবি',
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

/** The id of the wrapper a document slot renders into, for scrolling to it. */
function documentSlotId(key: RequiredDocumentKey): string {
  return `${key}-slot`;
}

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

/**
 * Which fields belong to which step.
 *
 * Every field in the schema must appear exactly once, and the assertion below
 * makes the compiler enforce that. It is not decoration: `childrenCount` was
 * missing from this list, so the cross-field rule "children must be 0 when
 * unmarried" could fail the form while `onInvalidSubmit` had no step to send
 * the member to — the submit button did nothing a member could act on.
 */
const STEP_FIELDS = [
  // Step 0 — Personal
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
  // Step 3 — Documents and agreement
  ['agreeToTerms'],
] as const satisfies ReadonlyArray<ReadonlyArray<RegisterFieldName>>;

type RoutedField = (typeof STEP_FIELDS)[number][number];
type UnroutedField = Exclude<keyof RegisterFormData, RoutedField>;
type Assert<T extends true> = T;
// Type-only. Fails to compile if a schema field belongs to no step, and the
// error names the field. Erased at build time, so it costs nothing at runtime.
export type _EveryRegistrationFieldHasAStep = Assert<
  [UnroutedField] extends [never] ? true : false
>;

/** Every field blanked, then the handful that have a starting value. */
const BLANK_FORM: Partial<RegisterFormData> = {
  ...(Object.fromEntries(
    STEP_FIELDS.flat().map((field) => [field, '']),
  ) as Partial<RegisterFormData>),
  ...FORM_DEFAULT_VALUES,
};

const CONDITIONAL_ADDRESS_FIELDS: RegisterFieldName[] = [
  'presentHouseNo',
  'presentRoadNo',
  'presentVillage',
  'presentUnion',
  'presentPoliceStation',
  'presentDistrict',
];

// Android-first field sizing.
//
// 48px is the Android touch-target minimum and 16px is the threshold below
// which mobile browsers zoom the viewport on focus, leaving the member scrolled
// sideways mid-address. The shared Input primitive is 40px/14px, which is right
// for the dense dashboard tables it was built for and wrong for a form filled
// in one-handed — so this is applied here rather than by changing the primitive
// underneath every other page.
//
// Applied per field on purpose: an `[&_input]:h-12` variant on the form reads
// better but compiles to nothing once it contains nested brackets, and a style
// that fails silently is worse than one that is repeated.
const FIELD = 'h-12 text-base sm:h-10 sm:text-sm';

const SELECT_CLASS = cn(
  'flex w-full rounded-sm border border-input bg-background px-3 py-2 shadow-none transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50',
  FIELD,
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

export default function RegisterPage() {
  const locale = useLocale();
  const isBn = locale === 'bn';
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState<'idle' | 'uploading' | 'finishing'>('idle');
  const [emailAvailability, setEmailAvailability] = useState<AvailabilityState>('idle');
  const [phoneAvailability, setPhoneAvailability] = useState<AvailabilityState>('idle');
  const [documentFiles, setDocumentFiles] =
    useState<Record<RequiredDocumentKey, DocumentSlot | null>>(EMPTY_DOCUMENTS);
  const [documentErrors, setDocumentErrors] = useState<
    Partial<Record<RequiredDocumentKey, string>>
  >({});
  const [processingDocument, setProcessingDocument] = useState<RequiredDocumentKey | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftStorageKey = useMemo(() => `${REGISTRATION_DRAFT_KEY_PREFIX}:${locale}`, [locale]);
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  const formTopRef = useRef<HTMLDivElement | null>(null);
  const hasMountedRef = useRef(false);
  // Remembers verdicts we already paid a rate-limit token for, so correcting a
  // typo and coming back to the original value does not spend another one.
  const availabilityCacheRef = useRef<Map<string, boolean>>(new Map());

  const {
    register,
    handleSubmit,
    watch,
    reset,
    getValues,
    setValue,
    trigger,
    setError,
    clearErrors,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: FORM_DEFAULT_VALUES,
    mode: 'onChange',
    reValidateMode: 'onChange',
    // This form reveals errors itself — a summary banner at the top of the
    // card, then a deliberate scroll to the first thing to fix. React Hook
    // Form's default is to focus the first errored field instead, and on the
    // Documents step that field is `agreeToTerms`: the LAST control on a very
    // long step. So a blocked submit scrolled the member to the bottom of the
    // page, below the rules and the pledge, with the four document slots left
    // off-screen above them — which is how members came to submit without
    // noticing there was anything to upload. Our own scrolling has to be the
    // only scrolling, or the two fight and the field wins.
    shouldFocusError: false,
  });

  const sameAsPermanent = watch('sameAsPermanent') ?? true;
  const watchedEmail = watch('email');
  const watchedPhone = watch('phone');
  const maritalStatus = watch('maritalStatus');

  const stepTitles = isBn
    ? ['ব্যক্তিগত তথ্য', 'ঠিকানা', 'নমিনী', 'নথি ও চুক্তি']
    : ['Personal Info', 'Address', 'Nominee', 'Documents'];

  // Switching back to Unmarried must clear any children already entered.
  // The count input is disabled while Unmarried is selected, so a leftover
  // value would fail the "must be 0 when unmarried" rule in a field the member
  // is no longer allowed to touch — an unfixable form.
  useEffect(() => {
    if (maritalStatus === 'UNMARRIED' && (getValues('childrenCount') ?? 0) !== 0) {
      setValue('childrenCount', 0, { shouldValidate: true, shouldDirty: true });
    }
  }, [maritalStatus, getValues, setValue]);

  /** Scroll a field into view and focus it, tolerating a smooth scroll on the way. */
  const focusField = useCallback((fieldId: string) => {
    if (typeof document === 'undefined') return;
    const element = document.getElementById(fieldId);
    if (!element) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    // Focusing immediately cancels the smooth scroll on Chrome; focusing after
    // it settles keeps both the scroll and the Android keyboard.
    window.setTimeout(() => {
      (element as HTMLElement).focus({ preventScroll: true });
    }, reduceMotion ? 0 : 300);
  }, []);

  /**
   * Mark every missing upload at once and report which they are.
   *
   * All four, not the first: flagging one at a time turned a single omission
   * into four submit-and-read rounds, on a step where each round costs the
   * member a scroll through the rules and the pledge.
   */
  const flagMissingDocuments = useCallback((): RequiredDocumentKey[] => {
    const missing = REQUIRED_DOCUMENT_KEYS.filter((key) => !documentFiles[key]);
    if (missing.length > 0) {
      setDocumentErrors((prev) => {
        const next = { ...prev };
        for (const key of missing) next[key] = isBn ? 'এই ফাইলটি প্রয়োজন' : 'This file is required';
        return next;
      });
    }
    return missing;
  }, [documentFiles, isBn]);

  const scrollToFormTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    formTopRef.current?.scrollIntoView({
      block: 'start',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, []);

  /**
   * Send the reader to the error summary.
   *
   * The summary sits at the top of the card and the submit button at the
   * bottom, so on a phone a blocked submit wrote an explanation onto a part of
   * the page the member could not see — which is what "it says the form needs
   * attention but there is no error" was describing. Focusing the summary is
   * also the accessible pattern: a screen reader announces the whole list of
   * problems rather than a single field the member has not reached yet.
   */
  const revealErrorSummary = useCallback(() => {
    window.setTimeout(() => {
      const banner = errorBannerRef.current;
      if (!banner) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      banner.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      banner.focus({ preventScroll: true });
    }, 0);
  }, []);

  // Moving between steps replaces the entire visible form. Without this the
  // member stays parked at the old scroll offset — they press "Next" at the
  // bottom of Personal and land at the bottom of Address, looking at the
  // buttons they just used and none of the fields they now have to fill.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollToFormTop();
  }, [currentStep, scrollToFormTop]);

  const checkAvailability = useCallback(
    async (params: URLSearchParams): Promise<{ emailExists: boolean; phoneExists: boolean } | null> => {
      const response = await fetch(`/api/v1/registrations?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`availability check failed: ${response.status}`);
      }
      const json = (await response.json().catch(() => ({}))) as {
        emailExists?: boolean;
        phoneExists?: boolean;
      };
      return {
        emailExists: Boolean(json.emailExists),
        phoneExists: Boolean(json.phoneExists),
      };
    },
    [],
  );

  useEffect(() => {
    const email = (watchedEmail || '').trim().toLowerCase();
    if (email === '' || !emailSchema.safeParse(email).success) {
      setEmailAvailability('idle');
      if (errors.email?.type === 'manual') clearErrors('email');
      return;
    }

    const cached = availabilityCacheRef.current.get(`email:${email}`);
    if (cached !== undefined) {
      setEmailAvailability(cached ? 'taken' : 'available');
      if (cached) {
        setError('email', {
          type: 'manual',
          message: isBn ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
        });
      } else if (errors.email?.type === 'manual') {
        clearErrors('email');
      }
      return;
    }

    const controller = new AbortController();
    // 700ms rather than 450ms: this endpoint is rate limited, and every extra
    // round trip while someone types their address is a token spent.
    const timeoutId = window.setTimeout(async () => {
      setEmailAvailability('checking');
      try {
        const result = await checkAvailability(new URLSearchParams({ email }));
        if (controller.signal.aborted || !result) return;
        availabilityCacheRef.current.set(`email:${email}`, result.emailExists);
        if (result.emailExists) {
          setEmailAvailability('taken');
          setError('email', {
            type: 'manual',
            message: isBn ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
          });
        } else {
          setEmailAvailability('available');
          if (errors.email?.type === 'manual') clearErrors('email');
        }
      } catch {
        if (!controller.signal.aborted) setEmailAvailability('error');
      }
    }, 700);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [watchedEmail, setError, clearErrors, errors.email?.type, isBn, checkAvailability]);

  useEffect(() => {
    const phone = (watchedPhone || '').trim();
    if (phone === '' || !bdPhoneRegex.test(phone)) {
      setPhoneAvailability('idle');
      if (errors.phone?.type === 'manual') clearErrors('phone');
      return;
    }

    const cached = availabilityCacheRef.current.get(`phone:${phone}`);
    if (cached !== undefined) {
      setPhoneAvailability(cached ? 'taken' : 'available');
      if (cached) {
        setError('phone', {
          type: 'manual',
          message: isBn
            ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
            : 'This phone number is already registered',
        });
      } else if (errors.phone?.type === 'manual') {
        clearErrors('phone');
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setPhoneAvailability('checking');
      try {
        const result = await checkAvailability(new URLSearchParams({ phone }));
        if (controller.signal.aborted || !result) return;
        availabilityCacheRef.current.set(`phone:${phone}`, result.phoneExists);
        if (result.phoneExists) {
          setPhoneAvailability('taken');
          setError('phone', {
            type: 'manual',
            message: isBn
              ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
              : 'This phone number is already registered',
          });
        } else {
          setPhoneAvailability('available');
          if (errors.phone?.type === 'manual') clearErrors('phone');
        }
      } catch {
        if (!controller.signal.aborted) setPhoneAvailability('error');
      }
    }, 700);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [watchedPhone, setError, clearErrors, errors.phone?.type, isBn, checkAvailability]);

  // Restore a draft, if there is a fresh one.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        data?: Partial<RegisterFormData>;
        currentStep?: number;
        savedAt?: number;
      };

      if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        window.localStorage.removeItem(draftStorageKey);
        return;
      }

      const restored: Partial<RegisterFormData> = {
        ...FORM_DEFAULT_VALUES,
        ...(parsed.data || {}),
        // Consent is an act, not a saved preference. Restoring a ticked box
        // would let someone submit a pledge they never read.
        agreeToTerms: undefined as unknown as true,
      };
      reset(restored);
      setDraftRestored(true);

      if (typeof parsed.currentStep === 'number' && Number.isFinite(parsed.currentStep)) {
        setCurrentStep(Math.min(Math.max(parsed.currentStep, 0), steps.length - 1));
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey, reset]);

  // Persist the draft, debounced. Writing on every keystroke serialises the
  // whole form into localStorage thirty times a second on a slow handset.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId: number | undefined;
    const subscription = watch((value: Partial<RegisterFormData>) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const { agreeToTerms: _agreed, ...persistable } = value;
        void _agreed;
        try {
          window.localStorage.setItem(
            draftStorageKey,
            JSON.stringify({ data: persistable, currentStep, savedAt: Date.now() }),
          );
        } catch {
          // Private browsing or a full quota. A lost draft is not worth a crash.
        }
      }, 400);
    });

    return () => {
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [watch, currentStep, draftStorageKey]);

  // Object URLs for the document previews leak until revoked. The unmount
  // handler has to read the *current* slots, not the empty set it closed over
  // on mount, so it goes through a ref.
  const documentFilesRef = useRef(documentFiles);
  documentFilesRef.current = documentFiles;
  useEffect(() => {
    return () => {
      for (const slot of Object.values(documentFilesRef.current)) {
        if (slot) URL.revokeObjectURL(slot.previewUrl);
      }
    };
  }, []);

  const discardDraft = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(draftStorageKey);
    }
    // Every field has to be named. `reset(FORM_DEFAULT_VALUES)` only mentions
    // the five fields with defaults, and react-hook-form leaves the DOM value
    // of a field it was not given alone — so "Start fresh" cleared the saved
    // draft and the form state while the member went on looking at their old
    // answers still typed into the boxes.
    reset(BLANK_FORM);
    setCurrentStep(0);
    setDraftRestored(false);
    setSubmitError(null);
    availabilityCacheRef.current.clear();
  }, [draftStorageKey, reset]);

  const fieldsForStep = useCallback(
    (step: number): RegisterFieldName[] => {
      const fields = [...STEP_FIELDS[step]] as RegisterFieldName[];
      if (step === 1 && sameAsPermanent) {
        return fields.filter((field) => !CONDITIONAL_ADDRESS_FIELDS.includes(field));
      }
      return fields;
    },
    [sameAsPermanent],
  );

  /**
   * Pre-flight duplicate check.
   *
   * Advisory only. The POST handler re-checks and answers 409, so a failure
   * here — a rate limit, a flaky connection — must never be what stops someone
   * registering. It used to: an unreachable check returned 'error' and the
   * Next button refused to advance, with a message offering no way forward.
   */
  const checkContactAvailability = useCallback(
    async (emailValue: string, phoneValue: string): Promise<'available' | 'taken' | 'error'> => {
      const email = emailValue.trim().toLowerCase();
      const phone = phoneValue.trim();
      if (!email && !phone) return 'available';

      setEmailAvailability(email ? 'checking' : 'idle');
      setPhoneAvailability(phone ? 'checking' : 'idle');

      try {
        const params = new URLSearchParams();
        if (email) params.set('email', email);
        if (phone) params.set('phone', phone);

        const result = await checkAvailability(params);
        if (!result) throw new Error('no result');

        const emailTaken = Boolean(email) && result.emailExists;
        const phoneTaken = Boolean(phone) && result.phoneExists;
        if (email) availabilityCacheRef.current.set(`email:${email}`, emailTaken);
        if (phone) availabilityCacheRef.current.set(`phone:${phone}`, phoneTaken);

        if (emailTaken) {
          setError('email', {
            type: 'manual',
            message: isBn ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত' : 'This email is already registered',
          });
        } else if (errors.email?.type === 'manual') {
          clearErrors('email');
        }

        if (phoneTaken) {
          setError('phone', {
            type: 'manual',
            message: isBn
              ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
              : 'This phone number is already registered',
          });
        } else if (errors.phone?.type === 'manual') {
          clearErrors('phone');
        }

        setEmailAvailability(email ? (emailTaken ? 'taken' : 'available') : 'idle');
        setPhoneAvailability(phone ? (phoneTaken ? 'taken' : 'available') : 'idle');

        return emailTaken || phoneTaken ? 'taken' : 'available';
      } catch {
        setEmailAvailability(email ? 'error' : 'idle');
        setPhoneAvailability(phone ? 'error' : 'idle');
        return 'error';
      }
    },
    [checkAvailability, clearErrors, errors.email?.type, errors.phone?.type, isBn, setError],
  );

  const onSubmit = async (data: RegisterFormData) => {
    setSubmitError(null);
    setSubmitStage('idle');

    const missingDocuments = flagMissingDocuments();
    if (missingDocuments.length > 0) {
      const missingLabels = missingDocuments.map((key) =>
        isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
      );
      setSubmitError(
        isBn
          ? `নিবন্ধন সম্পন্ন করতে চারটি ছবিই দিতে হবে। বাকি আছে: ${missingLabels.join(', ')}`
          : `All four document photos are required to complete registration. Still needed: ${missingLabels.join(', ')}`,
      );
      revealErrorSummary();
      return;
    }

    if (Object.values(documentErrors).some(Boolean)) {
      setSubmitError(
        isBn
          ? 'নথির ত্রুটিগুলো ঠিক করে আবার চেষ্টা করুন।'
          : 'Please fix the document upload errors and try again.',
      );
      revealErrorSummary();
      return;
    }

    const totalUploadBytes = REQUIRED_DOCUMENT_KEYS.reduce(
      (sum, key) => sum + (documentFiles[key]?.file.size ?? 0),
      0,
    );
    if (totalUploadBytes > REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES) {
      setSubmitError(
        isBn
          ? `নথির মোট সাইজ ${formatFileSize(totalUploadBytes)} — সর্বোচ্চ ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL}। একটি ছবি সরিয়ে ছোট ছবি দিন।`
          : `Your documents total ${formatFileSize(totalUploadBytes)}, above the ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL} limit. Replace one with a smaller photo.`,
      );
      return;
    }

    try {
      setSubmitStage('uploading');
      const registrationPayload = {
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

        permanentHouseNo: data.permanentHouseNo,
        permanentRoadNo: data.permanentRoadNo,
        permanentVillage: data.permanentVillage,
        permanentUnion: data.permanentUnion,
        permanentPoliceStation: data.permanentPoliceStation,
        permanentDistrict: data.permanentDistrict,

        sameAsPermanent: data.sameAsPermanent ?? true,
        presentHouseNo: data.presentHouseNo,
        presentRoadNo: data.presentRoadNo,
        presentVillage: data.presentVillage,
        presentUnion: data.presentUnion,
        presentPoliceStation: data.presentPoliceStation,
        presentDistrict: data.presentDistrict,

        nomineeName: data.nomineeName,
        nomineeRelationship: data.nomineeRelationship,
        nomineeNid: data.nomineeNid,
        nomineePhone: data.nomineePhone,
      };

      const formData = new FormData();
      formData.append('payload', JSON.stringify(registrationPayload));
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

        // A duplicate is decided by the server, and the field to fix is three
        // steps back. Say which, and take them there.
        if (response.status === 409) {
          const conflictsWithPhone = /phone/i.test(json.error || '');
          const field: RegisterFieldName = conflictsWithPhone ? 'phone' : 'email';
          availabilityCacheRef.current.set(
            `${field}:${conflictsWithPhone ? data.phone.trim() : data.email.trim().toLowerCase()}`,
            true,
          );
          setError(field, {
            type: 'manual',
            message: conflictsWithPhone
              ? isBn
                ? 'এই মোবাইল নম্বর ইতোমধ্যে নিবন্ধিত'
                : 'This phone number is already registered'
              : isBn
                ? 'এই ই-মেইল ইতোমধ্যে নিবন্ধিত'
                : 'This email is already registered',
          });
          setSubmitError(
            isBn
              ? 'এই ই-মেইল বা মোবাইল নম্বর দিয়ে ইতোমধ্যে নিবন্ধন করা হয়েছে। প্রথম ধাপে গিয়ে সংশোধন করুন।'
              : 'This email or phone number is already registered. Correct it on step 1 and try again.',
          );
          setCurrentStep(0);
          window.setTimeout(() => focusField(field), 350);
          return;
        }

        // The platform rejects an oversized body before this route runs, so the
        // reply is an HTML error page rather than our JSON.
        if (response.status === 413) {
          setSubmitError(
            isBn
              ? `নথিগুলো খুব বড়। সর্বোচ্চ ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL}, ছোট ছবি দিয়ে আবার চেষ্টা করুন।`
              : `Your documents are too large to send. Keep them under ${REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL} and try again.`,
          );
          return;
        }

        const fieldErrorMessages =
          json?.details?.fieldErrors && typeof json.details.fieldErrors === 'object'
            ? Object.entries(json.details.fieldErrors)
                .map(([field, messages]) => {
                  const safeMessages = Array.isArray(messages)
                    ? messages.filter(
                        (message): message is string =>
                          typeof message === 'string' && message.trim() !== '',
                      )
                    : [];
                  if (!safeMessages.length) return '';
                  return `${getRegistrationFieldLabel(field, isBn ? 'bn' : 'en')}: ${safeMessages.join(', ')}`;
                })
                .filter(Boolean)
                .join('\n')
            : '';
        const formErrorMessages = (
          Array.isArray(json?.details?.formErrors) ? json.details.formErrors : []
        )
          .filter((message): message is string => typeof message === 'string')
          .map((message) => message.trim())
          .filter(Boolean)
          .join('\n');
        const detailedMessage = [fieldErrorMessages, formErrorMessages].filter(Boolean).join('\n');

        if (detailedMessage) {
          setSubmitError(
            isBn ? `ফর্মে ত্রুটি রয়েছে:\n${detailedMessage}` : `Form has errors:\n${detailedMessage}`,
          );
          return;
        }

        // Never surface a raw response body: when the platform answers instead
        // of the route, it is an HTML page, and dumping it in the error box
        // showed members a wall of markup.
        const serverMessage =
          typeof json?.error === 'string' && json.error.trim() ? json.error.trim() : '';
        setSubmitError(
          serverMessage || (isBn ? 'নিবন্ধন ব্যর্থ হয়েছে' : 'Registration failed. Please try again.'),
        );
        return;
      }

      toast({
        title: isBn ? 'নিবন্ধন সফল!' : 'Registration Successful!',
        description: isBn
          ? 'আপনার আবেদন জমা হয়েছে। অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।'
          : 'Your application has been submitted. Please wait for admin approval.',
        variant: 'success',
      });

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(draftStorageKey);
      }
      for (const slot of Object.values(documentFiles)) {
        if (slot) URL.revokeObjectURL(slot.previewUrl);
      }
      setDocumentFiles(EMPTY_DOCUMENTS);
      setDocumentErrors({});
      setSubmitStage('finishing');

      setTimeout(() => {
        router.push(localePath(locale, '/login'));
      }, 2000);
    } catch {
      setSubmitStage('idle');
      setSubmitError(
        isBn
          ? 'নিবন্ধন ব্যর্থ হয়েছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
          : 'Registration failed. Check your connection and try again.',
      );
    }
  };

  /**
   * Submission blocked by validation.
   *
   * The old version fired a "Form needs attention" toast and moved the step,
   * and that was all: the toast vanished after a few seconds, three fields
   * rendered no error text at all, and nothing scrolled, so the member arrived
   * at a step that looked complete and was told, briefly, that it was not.
   * Now the reason stays on screen, names the fields, and the first bad one is
   * scrolled to and focused.
   */
  const onInvalidSubmit = (formErrors: FieldErrors<RegisterFormData>) => {
    const errored = (Object.keys(formErrors) as RegisterFieldName[]).filter((field) => {
      if (sameAsPermanent && CONDITIONAL_ADDRESS_FIELDS.includes(field)) return false;
      return STEP_FIELDS.some((fields) => (fields as readonly string[]).includes(field));
    });

    if (!errored.length) {
      // Nothing maps to a step — a root-level schema issue. Show whatever the
      // resolver said rather than an empty banner.
      const rootMessage = (formErrors as { root?: { message?: unknown } }).root?.message;
      const firstMessage = Object.values(formErrors).find(
        (value) =>
          value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string',
      ) as { message?: string } | undefined;

      setSubmitError(
        (typeof rootMessage === 'string' && rootMessage.trim()) ||
          firstMessage?.message?.trim() ||
          (isBn ? 'ফর্মে কিছু তথ্য আবার যাচাই করুন।' : 'Please review the form information once more.'),
      );
      revealErrorSummary();
      return;
    }

    let targetStep = steps.length - 1;
    for (const [index, fields] of STEP_FIELDS.entries()) {
      if (errored.some((field) => (fields as readonly string[]).includes(field))) {
        targetStep = index;
        break;
      }
    }

    const fieldsOnTarget = errored.filter((field) =>
      (STEP_FIELDS[targetStep] as readonly string[]).includes(field),
    );
    const labels = fieldsOnTarget.map((field) => getRegistrationFieldLabel(field, isBn ? 'bn' : 'en'));

    // The uploads are component state, not schema fields, so the resolver has
    // nothing to say about them and they were reported only *after* everything
    // in the schema passed. A member who had not ticked the agreement was told
    // about the agreement, fixed it, submitted again, and only then learned
    // that four photos were also missing. Name both the first time.
    const missingDocuments = targetStep === DOCUMENTS_STEP ? flagMissingDocuments() : [];
    const documentLabels = missingDocuments.map((key) =>
      isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
    );
    const allLabels = [...documentLabels, ...labels];

    setSubmitError(
      // No "on the X step" when they are already standing on step X: it reads
      // as an instruction to go somewhere, and the member is there.
      targetStep === currentStep
        ? isBn
          ? `এই তথ্যগুলো ঠিক করুন: ${allLabels.join(', ')}`
          : `Please correct: ${allLabels.join(', ')}`
        : isBn
          ? `${stepTitles[targetStep]} ধাপে এই তথ্যগুলো ঠিক করুন: ${allLabels.join(', ')}`
          : `Fix these on the "${stepTitles[targetStep]}" step: ${allLabels.join(', ')}`,
    );
    setCurrentStep(targetStep);

    // One scroll, always to the summary. The summary sits directly above the
    // upload slots, so revealing it puts both the list of problems and the
    // boxes to fill on screen together — which is the whole difference from
    // shouldFocusError, whose one focused field was the checkbox at the bottom.
    revealErrorSummary();
  };

  const nextStep = async () => {
    setSubmitError(null);

    const fieldsToValidate = fieldsForStep(currentStep);
    const isValid = await trigger(fieldsToValidate);

    if (!isValid) {
      // `errors` from the render closure is a tick behind `trigger`, so asking
      // it which fields failed the validation we just ran returns the previous
      // answer. getFieldState reads the live state the trigger updated.
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
      revealErrorSummary();
      return;
    }

    if (currentStep === 0) {
      const availability = await checkContactAvailability(getValues('email'), getValues('phone'));
      if (availability === 'taken') {
        setSubmitError(
          isBn
            ? 'এই ই-মেইল বা মোবাইল নম্বর আগে থেকেই ব্যবহৃত হয়েছে।'
            : 'This email or phone number is already in use.',
        );
        revealErrorSummary();
        return;
      }
      // 'error' deliberately falls through: the check is advisory and the POST
      // is authoritative. Blocking here on a rate limit or a dropped packet
      // stranded people who had done nothing wrong.
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    setSubmitError(null);
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const goToStep = (index: number) => {
    // Backwards only. Jumping forward would skip the per-step validation that
    // keeps a member from reaching the documents step with an unusable form.
    if (index < currentStep) {
      setSubmitError(null);
      setCurrentStep(index);
    }
  };

  const documentFieldMeta: Array<{
    key: RequiredDocumentKey;
    label: string;
    helper: string;
  }> = REQUIRED_DOCUMENT_KEYS.map((key) => ({
    key,
    label: isBn ? DOCUMENT_LABELS[key].bn : DOCUMENT_LABELS[key].en,
    helper: isBn ? DOCUMENT_LABELS[key].helperBn : DOCUMENT_LABELS[key].helperEn,
  }));

  const handleDocumentChange = async (
    key: RequiredDocumentKey,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    setSubmitError(null);
    // Let the same file be re-picked after an error; without this the change
    // event never fires again for an identical filename.
    event.target.value = '';

    if (!file) return;

    setProcessingDocument(key);
    try {
      // Type first: downscaling a PDF or a HEIC is not going to help, and the
      // member should hear why rather than watch a spinner.
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

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (currentStep < steps.length - 1) {
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
  const isLastStep = currentStep === steps.length - 1;
  const busy = isSubmitting || submitStage !== 'idle';

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md safe-area-top">
        <div className="container-wide flex h-14 items-center justify-between gap-2">
          <div className="flex items-center gap-6">
            <Link href={localePath(locale)} aria-label={isBn ? 'হোম' : 'Home'}>
              <Logo size="sm" />
            </Link>
            <Link
              href={localePath(locale)}
              className="hidden items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              ← {isBn ? 'হোম' : 'Home'}
            </Link>
          </div>
          <div className="flex items-center gap-1 sm:gap-4">
            <Link href={localePath(otherLocale(locale), '/register')}>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span className="text-sm">{locale === 'en' ? 'বাংলা' : 'English'}</span>
              </Button>
            </Link>
            <Link
              href={localePath(locale, '/login')}
              className="px-2 text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              {isBn ? 'লগইন' : 'Login'}
            </Link>
          </div>
        </div>
      </header>

      <main className="px-3 py-5 safe-area-bottom sm:px-4 sm:py-8">
        <div className="container-wide max-w-4xl">
          <div ref={formTopRef} className="scroll-mt-20" />

          {/* Progress */}
          <div className="relative mb-6 sm:mb-10">
            <div className="absolute left-0 top-5 z-0 h-1 w-full -translate-y-1/2 rounded-full bg-border sm:top-7" />
            <div
              className="absolute left-0 top-5 z-0 h-1 -translate-y-1/2 rounded-full bg-primary transition-all duration-500 ease-out sm:top-7"
              style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
            />
            <ol className="relative z-10 flex items-start justify-between">
              {steps.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                return (
                  <li key={step.id} className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => goToStep(index)}
                      disabled={index >= currentStep}
                      aria-current={active ? 'step' : undefined}
                      aria-label={`${isBn ? 'ধাপ' : 'Step'} ${index + 1}: ${stepTitles[index]}`}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-xl border-2 transition-all duration-300 sm:h-14 sm:w-14 sm:rounded-2xl',
                        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                        done && 'border-primary bg-primary text-primary-foreground cursor-pointer',
                        active && 'border-primary bg-background text-primary shadow-lg shadow-primary/20',
                        !done && !active && 'border-border bg-background text-muted-foreground',
                      )}
                    >
                      {done ? (
                        <Check className="h-4 w-4 sm:h-6 sm:w-6" />
                      ) : (
                        <step.icon className="h-4 w-4 sm:h-6 sm:w-6" />
                      )}
                    </button>
                    <span
                      className={cn(
                        'mt-2 max-w-16 text-center text-[11px] font-medium leading-tight sm:mt-3 sm:max-w-none sm:text-sm',
                        index <= currentStep ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {stepTitles[index]}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* No `overflow-hidden` here: it establishes a clipping context that
              silently disables `position: sticky` on the navigation bar below,
              which is the only thing keeping Next reachable one-handed. */}
          <Card className="border shadow-lg">
            <div className="h-1.5 w-full rounded-t-sm bg-primary" />
            <CardHeader className="border-b pb-5 text-center sm:pb-6">
              <CardTitle className="text-xl font-bold sm:text-3xl">
                {isBn ? 'হাসনাহেনায় নিবন্ধন' : 'Register for Hasnahena'}
              </CardTitle>
              <CardDescription className="mt-1 text-sm sm:text-base">
                {isBn
                  ? 'সুদমুক্ত অর্থায়নে আপনার যাত্রা শুরু করুন'
                  : 'Start your journey to interest-free finance'}
              </CardDescription>
              <p className="mt-2 text-xs text-muted-foreground">
                {isBn
                  ? `ধাপ ${currentStep + 1} / ${steps.length}`
                  : `Step ${currentStep + 1} of ${steps.length}`}
              </p>
            </CardHeader>

            <CardContent className="p-4 sm:p-8 md:p-10">
              {draftRestored && (
                <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {isBn
                      ? 'আপনার আগের অসম্পূর্ণ ফর্ম ফিরিয়ে আনা হয়েছে।'
                      : 'We restored your unfinished form.'}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={discardDraft}>
                    {isBn ? 'নতুন করে শুরু করুন' : 'Start fresh'}
                  </Button>
                </div>
              )}

              {submitError && (
                <div
                  ref={errorBannerRef}
                  role="alert"
                  aria-live="assertive"
                  tabIndex={-1}
                  className="mb-5 flex items-start gap-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive scroll-mt-24 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{submitError}</span>
                </div>
              )}

              {/* noValidate: the browser's own bubbles fire before submit and
                  suppress our validation, so a member saw a native tooltip on
                  one field while the rest stayed unchecked. */}
              <form onSubmit={handleFormSubmit} noValidate>
                {/* Step 1: Personal Information */}
                {currentStep === 0 && (
                  <div className="space-y-5">
                    <h3 className="border-b pb-3 text-lg font-semibold">
                      {isBn ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
                    </h3>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nameEn">{isBn ? 'নাম (ইংরেজি) *' : 'Name (English) *'}</Label>
                        <Input
                          className={FIELD}
                          id="nameEn"
                          autoComplete="name"
                          autoCapitalize="words"
                          enterKeyHint="next"
                          placeholder="Full name in English"
                          aria-invalid={Boolean(errors.nameEn)}
                          {...register('nameEn')}
                        />
                        <FieldError message={errors.nameEn?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nameBn">{isBn ? 'নাম (বাংলা)' : 'Name (Bengali)'}</Label>
                        <Input
                          className={FIELD}
                          id="nameBn"
                          autoCapitalize="words"
                          enterKeyHint="next"
                          placeholder="পূর্ণ নাম বাংলায়"
                          aria-invalid={Boolean(errors.nameBn)}
                          {...register('nameBn')}
                        />
                        <FieldError message={errors.nameBn?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="fatherName">{isBn ? 'পিতার নাম *' : "Father's Name *"}</Label>
                        <Input
                          className={FIELD}
                          id="fatherName"
                          autoCapitalize="words"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.fatherName)}
                          {...register('fatherName')}
                        />
                        <FieldError message={errors.fatherName?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="motherName">{isBn ? 'মাতার নাম *' : "Mother's Name *"}</Label>
                        <Input
                          className={FIELD}
                          id="motherName"
                          autoCapitalize="words"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.motherName)}
                          {...register('motherName')}
                        />
                        <FieldError message={errors.motherName?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone">{isBn ? 'মোবাইল নম্বর *' : 'Mobile Number *'}</Label>
                        <Input
                          className={FIELD}
                          id="phone"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          enterKeyHint="next"
                          maxLength={11}
                          placeholder="01XXXXXXXXX"
                          aria-invalid={Boolean(errors.phone)}
                          {...register('phone')}
                        />
                        <FieldError message={errors.phone?.message} />
                        {!errors.phone && phoneAvailability === 'checking' && (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            {isBn ? 'যাচাই হচ্ছে...' : 'Checking…'}
                          </p>
                        )}
                        {!errors.phone && phoneAvailability === 'available' && (
                          <p className="flex items-center gap-1.5 text-xs text-primary">
                            <Check className="h-3 w-3" aria-hidden />
                            {isBn ? 'ব্যবহার করা যাবে' : 'Available'}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">{isBn ? 'ই-মেইল *' : 'Email *'}</Label>
                        <Input
                          className={FIELD}
                          id="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="next"
                          placeholder="name@example.com"
                          aria-invalid={Boolean(errors.email)}
                          {...register('email')}
                        />
                        <FieldError message={errors.email?.message} />
                        {!errors.email && emailAvailability === 'checking' && (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            {isBn ? 'যাচাই হচ্ছে...' : 'Checking…'}
                          </p>
                        )}
                        {!errors.email && emailAvailability === 'available' && (
                          <p className="flex items-center gap-1.5 text-xs text-primary">
                            <Check className="h-3 w-3" aria-hidden />
                            {isBn ? 'ব্যবহার করা যাবে' : 'Available'}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {isBn
                            ? 'অনুমোদনের পর এখানেই পাসওয়ার্ড পাঠানো হবে।'
                            : 'Your password will be sent here after approval.'}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="nidNumber">{isBn ? 'এন.আই.ডি নং *' : 'NID Number *'}</Label>
                        <Input
                          className={FIELD}
                          id="nidNumber"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          enterKeyHint="next"
                          maxLength={17}
                          placeholder={isBn ? '১০, ১৩ বা ১৭ সংখ্যা' : '10, 13 or 17 digits'}
                          aria-invalid={Boolean(errors.nidNumber)}
                          {...register('nidNumber')}
                        />
                        <FieldError message={errors.nidNumber?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="gender">{isBn ? 'লিঙ্গ *' : 'Gender *'}</Label>
                        <select
                          id="gender"
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

                      <div className="space-y-2">
                        <Label htmlFor="dateOfBirth">{isBn ? 'জন্ম তারিখ *' : 'Date of Birth *'}</Label>
                        <Input
                          className={FIELD}
                          id="dateOfBirth"
                          type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          aria-invalid={Boolean(errors.dateOfBirth)}
                          {...register('dateOfBirth')}
                        />
                        <FieldError message={errors.dateOfBirth?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="bloodGroup">{isBn ? 'রক্তের গ্রুপ *' : 'Blood Group *'}</Label>
                        <select
                          id="bloodGroup"
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

                      <div className="space-y-2">
                        <Label htmlFor="profession">{isBn ? 'পেশা *' : 'Profession *'}</Label>
                        <Input
                          className={FIELD}
                          id="profession"
                          enterKeyHint="next"
                          placeholder={
                            isBn ? 'যেমন: কৃষক, শিক্ষক, ব্যবসায়ী' : 'e.g. Farmer, Teacher, Business'
                          }
                          aria-invalid={Boolean(errors.profession)}
                          {...register('profession')}
                        />
                        <FieldError message={errors.profession?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="maritalStatus">
                          {isBn ? 'বৈবাহিক অবস্থা *' : 'Marital Status *'}
                        </Label>
                        <select
                          id="maritalStatus"
                          className={SELECT_CLASS}
                          aria-invalid={Boolean(errors.maritalStatus)}
                          {...register('maritalStatus')}
                        >
                          <option value="UNMARRIED">{isBn ? 'অবিবাহিত' : 'Unmarried'}</option>
                          <option value="MARRIED">{isBn ? 'বিবাহিত' : 'Married'}</option>
                        </select>
                        <FieldError message={errors.maritalStatus?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="childrenCount">
                          {isBn ? 'সন্তানের সংখ্যা' : 'Number of Children'}
                        </Label>
                        <Input
                          className={FIELD}
                          id="childrenCount"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={20}
                          disabled={maritalStatus === 'UNMARRIED'}
                          aria-invalid={Boolean(errors.childrenCount)}
                          {...register('childrenCount', { valueAsNumber: true })}
                        />
                        {maritalStatus === 'UNMARRIED' ? (
                          <p className="text-xs text-muted-foreground">
                            {isBn
                              ? 'বিবাহিত নির্বাচন করলে এটি পূরণ করা যাবে।'
                              : 'Available once you select Married.'}
                          </p>
                        ) : null}
                        <FieldError message={errors.childrenCount?.message} />
                      </div>
                    </div>

                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                      {isBn
                        ? 'অনুমোদনের পরে আপনাকে ইমেইলে অস্থায়ী পাসওয়ার্ড পাঠানো হবে। প্রথম লগইনের পর পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।'
                        : 'After approval, a temporary password will be sent to your email. You must change it after first login.'}
                    </div>
                  </div>
                )}

                {/* Step 2: Address */}
                {currentStep === 1 && (
                  <div className="space-y-5">
                    <h3 className="border-b pb-3 text-lg font-semibold">
                      {isBn ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}
                    </h3>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="permanentHouseNo">{isBn ? 'বাড়ী নং *' : 'House No *'}</Label>
                        <Input
                          className={FIELD}
                          id="permanentHouseNo"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentHouseNo)}
                          {...register('permanentHouseNo')}
                        />
                        <FieldError message={errors.permanentHouseNo?.message} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentRoadNo">{isBn ? 'রোড নং' : 'Road No'}</Label>
                        <Input
                          className={FIELD}
                          id="permanentRoadNo"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentRoadNo)}
                          {...register('permanentRoadNo')}
                        />
                        <FieldError message={errors.permanentRoadNo?.message} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentVillage">{isBn ? 'গ্রাম *' : 'Village *'}</Label>
                        <Input
                          className={FIELD}
                          id="permanentVillage"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentVillage)}
                          {...register('permanentVillage')}
                        />
                        <FieldError message={errors.permanentVillage?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="permanentUnion">{isBn ? 'ইউনিয়ন *' : 'Union *'}</Label>
                        <Input
                          className={FIELD}
                          id="permanentUnion"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentUnion)}
                          {...register('permanentUnion')}
                        />
                        <FieldError message={errors.permanentUnion?.message} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentPoliceStation">
                          {isBn ? 'থানা *' : 'Police Station *'}
                        </Label>
                        <Input
                          className={FIELD}
                          id="permanentPoliceStation"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentPoliceStation)}
                          {...register('permanentPoliceStation')}
                        />
                        <FieldError message={errors.permanentPoliceStation?.message} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentDistrict">{isBn ? 'জেলা *' : 'District *'}</Label>
                        <Input
                          className={FIELD}
                          id="permanentDistrict"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.permanentDistrict)}
                          {...register('permanentDistrict')}
                        />
                        <FieldError message={errors.permanentDistrict?.message} />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                      <input
                        type="checkbox"
                        id="sameAsPermanent"
                        className="h-5 w-5 shrink-0 accent-primary"
                        {...register('sameAsPermanent')}
                      />
                      <Label htmlFor="sameAsPermanent" className="text-sm font-normal leading-snug">
                        {isBn
                          ? 'বর্তমান ঠিকানা স্থায়ী ঠিকানার সাথে একই'
                          : 'Present address is same as permanent address'}
                      </Label>
                    </div>
                    <FieldError message={errors.sameAsPermanent?.message} />

                    {!sameAsPermanent && (
                      <>
                        <h3 className="border-b pb-3 text-lg font-semibold">
                          {isBn ? 'বর্তমান ঠিকানা' : 'Present Address'}
                        </h3>

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="presentHouseNo">{isBn ? 'বাড়ী নং *' : 'House No *'}</Label>
                            <Input
                              className={FIELD}
                              id="presentHouseNo"
                              enterKeyHint="next"
                              aria-invalid={Boolean(errors.presentHouseNo)}
                              {...register('presentHouseNo')}
                            />
                            <FieldError message={errors.presentHouseNo?.message} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentRoadNo">{isBn ? 'রোড নং' : 'Road No'}</Label>
                            <Input
                              className={FIELD}
                              id="presentRoadNo"
                              enterKeyHint="next"
                              aria-invalid={Boolean(errors.presentRoadNo)}
                              {...register('presentRoadNo')}
                            />
                            <FieldError message={errors.presentRoadNo?.message} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentVillage">{isBn ? 'গ্রাম *' : 'Village *'}</Label>
                            <Input
                              className={FIELD}
                              id="presentVillage"
                              enterKeyHint="next"
                              aria-invalid={Boolean(errors.presentVillage)}
                              {...register('presentVillage')}
                            />
                            <FieldError message={errors.presentVillage?.message} />
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="presentUnion">{isBn ? 'ইউনিয়ন *' : 'Union *'}</Label>
                            <Input
                              className={FIELD}
                              id="presentUnion"
                              enterKeyHint="next"
                              aria-invalid={Boolean(errors.presentUnion)}
                              {...register('presentUnion')}
                            />
                            <FieldError message={errors.presentUnion?.message} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentPoliceStation">
                              {isBn ? 'থানা *' : 'Police Station *'}
                            </Label>
                            <Input
                              className={FIELD}
                              id="presentPoliceStation"
                              enterKeyHint="next"
                              aria-invalid={Boolean(errors.presentPoliceStation)}
                              {...register('presentPoliceStation')}
                            />
                            <FieldError message={errors.presentPoliceStation?.message} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentDistrict">{isBn ? 'জেলা *' : 'District *'}</Label>
                            <Input
                              className={FIELD}
                              id="presentDistrict"
                              enterKeyHint="next"
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

                {/* Step 3: Nominee */}
                {currentStep === 2 && (
                  <div className="space-y-5">
                    <h3 className="border-b pb-3 text-lg font-semibold">
                      {isBn ? 'নমিনী তথ্য' : 'Nominee Information'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {isBn
                        ? 'আপনার অনুপস্থিতিতে যিনি আপনার জমার দাবিদার হবেন।'
                        : 'The person who may claim your savings in your absence.'}
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeName">{isBn ? 'নমিনীর নাম *' : 'Nominee Name *'}</Label>
                        <Input
                          className={FIELD}
                          id="nomineeName"
                          autoCapitalize="words"
                          enterKeyHint="next"
                          aria-invalid={Boolean(errors.nomineeName)}
                          {...register('nomineeName')}
                        />
                        <FieldError message={errors.nomineeName?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nomineeRelationship">{isBn ? 'সম্পর্ক *' : 'Relationship *'}</Label>
                        <Input
                          className={FIELD}
                          id="nomineeRelationship"
                          enterKeyHint="next"
                          placeholder={
                            isBn ? 'যেমন: পিতা, মাতা, স্ত্রী, স্বামী' : 'e.g. Father, Mother, Wife, Husband'
                          }
                          aria-invalid={Boolean(errors.nomineeRelationship)}
                          {...register('nomineeRelationship')}
                        />
                        <FieldError message={errors.nomineeRelationship?.message} />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeNid">{isBn ? 'নমিনীর NID *' : 'Nominee NID *'}</Label>
                        <Input
                          className={FIELD}
                          id="nomineeNid"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          enterKeyHint="next"
                          maxLength={17}
                          placeholder={isBn ? '১০, ১৩ বা ১৭ সংখ্যা' : '10, 13 or 17 digits'}
                          aria-invalid={Boolean(errors.nomineeNid)}
                          {...register('nomineeNid')}
                        />
                        <FieldError message={errors.nomineeNid?.message} />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nomineePhone">{isBn ? 'নমিনীর মোবাইল' : 'Nominee Phone'}</Label>
                        <Input
                          className={FIELD}
                          id="nomineePhone"
                          type="tel"
                          inputMode="numeric"
                          enterKeyHint="done"
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

                {/* Step 4: Documents & Agreement */}
                {currentStep === 3 && (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                      <h3 className="text-lg font-semibold">
                        {isBn ? 'প্রয়োজনীয় নথি' : 'Required Documents'}
                      </h3>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {uploadedCount}/{REQUIRED_DOCUMENT_KEYS.length}
                        {totalUploadBytes > 0 ? ` · ${formatFileSize(totalUploadBytes)}` : ''}
                      </span>
                    </div>

                    <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                      {isBn
                        ? 'চারটি ছবিই দিতে হবে। ফোন থেকে সরাসরি ছবি তুলতে পারেন — ছবিগুলো পাঠানোর আগে স্বয়ংক্রিয়ভাবে ছোট করা হয়, তাই ইন্টারনেট ডেটা কম লাগবে।'
                        : 'All four are required. You can photograph them directly with your phone — each picture is shrunk automatically before sending, so it uses very little data.'}
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {documentFieldMeta.map((field) => {
                        const slot = documentFiles[field.key];
                        const isProcessing = processingDocument === field.key;
                        return (
                          <div
                            key={field.key}
                            id={documentSlotId(field.key)}
                            className="space-y-2 scroll-mt-24"
                          >
                            <Label htmlFor={field.key}>{field.label} *</Label>
                            <input
                              id={field.key}
                              type="file"
                              accept="image/jpeg,image/jpg,image/png,image/webp"
                              className="sr-only"
                              onChange={(event) => void handleDocumentChange(field.key, event)}
                            />
                            {slot ? (
                              <div className="flex items-center gap-3 rounded-lg border p-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={slot.previewUrl}
                                  alt=""
                                  className="h-16 w-16 shrink-0 rounded-md border object-cover"
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
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <Label
                                htmlFor={field.key}
                                className={cn(
                                  'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center transition-colors',
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
                                    <span className="text-sm font-medium">
                                      {isBn ? 'ছবি তুলুন বা বেছে নিন' : 'Take or choose a photo'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{field.helper}</span>
                                  </>
                                )}
                              </Label>
                            )}
                            <FieldError message={documentErrors[field.key]} />
                          </div>
                        );
                      })}
                    </div>

                    <h3 className="border-b pb-3 text-lg font-semibold">
                      {isBn ? 'নিয়মাবলী' : 'Rules & Regulations'}
                    </h3>

                    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                      <p>
                        {isBn
                          ? '১. সুদ মুক্ত সমাজ গঠনের লক্ষ্যে এককালীন ১০০ টাকা অনুদান দিয়ে কর্জ প্রদানে ওয়াদাবদ্ধ হয়ে যে কেউ সদস্য হতে পারবে। উল্লেখ্য যে, সদস্যদের অনুদান অবশ্যই হালাল হতে হবে।'
                          : '1. Anyone can become a member by donating a one-time fee of ৳100 and committing to provide interest-free loans. Note: Member donations must be from halal sources.'}
                      </p>
                      <p>
                        {isBn
                          ? '২. কোন সদস্য জমাকৃত টাকা উত্তোলন করতে চাইলে তাকে কমপক্ষে তিন মাস আগে কর্তৃপক্ষকে অবহিত করতে হবে।'
                          : '2. If a member wishes to withdraw deposited funds, they must notify the management at least three months in advance.'}
                      </p>
                      <p>
                        {isBn
                          ? '৩. সদস্য জমাকৃত টাকার উপর কোন প্রকার লভ্যাংশ পাবে না।'
                          : '3. Members will not receive any interest or dividends on their deposited funds.'}
                      </p>
                    </div>

                    <h3 className="border-b pb-3 text-lg font-semibold">
                      {isBn ? 'অঙ্গীকারনামা' : 'Pledge'}
                    </h3>

                    <div className="rounded-lg bg-muted/50 p-4 text-sm">
                      <p className="font-bengali">
                        {isBn
                          ? 'আমি অঙ্গীকার করছি যে, অত্র ম্যানেজমেন্টের যাবতীয় নিয়ম কানুন নীতিমালা ও গৃহীত সকল সিদ্ধান্ত আন্তরিকভাবে মেনে চলব। অত্র ম্যানেজমেন্টের স্বার্থ ও মান ক্ষুন্ন ও নিয়ম পরিপন্থী কর্মকান্ডে লিপ্ত হব না।'
                          : 'I pledge that I will sincerely abide by all rules, regulations, policies, and decisions of this management. I will not engage in any activities that harm the interests or violate the rules of this management.'}
                      </p>
                    </div>

                    <div
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3',
                        errors.agreeToTerms ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/40',
                      )}
                    >
                      <input
                        type="checkbox"
                        id="agreeToTerms"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                        aria-invalid={Boolean(errors.agreeToTerms)}
                        {...register('agreeToTerms')}
                      />
                      <Label htmlFor="agreeToTerms" className="text-sm font-normal leading-snug">
                        {isBn
                          ? 'আমি উপরের সকল নিয়মাবলী পড়েছি এবং মেনে চলতে সম্মত আছি *'
                          : 'I have read and agree to all the above rules and regulations *'}
                      </Label>
                    </div>
                    <FieldError message={errors.agreeToTerms?.message} />
                  </div>
                )}

                {/* Navigation — sticky on phones so the way forward is always
                    reachable without scrolling to the end of a long step. */}
                <div className="sticky bottom-0 -mx-4 mt-8 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-6 sm:backdrop-blur-none">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    disabled={currentStep === 0 || busy}
                    className="h-12 gap-1 sm:h-10 sm:gap-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {isBn ? 'পেছনে' : 'Back'}
                  </Button>

                  {/* Distinct keys, deliberately, and load-bearing.

                      Without them React sees one <Button> in one slot and reuses
                      the same DOM node when the step changes: the node the member
                      just clicked "Next" on becomes type="submit" in place. And
                      `nextStep` is async — the continuation after `await
                      trigger(...)` runs as a microtask, which is *before* the
                      browser performs the click's default action. So a single
                      ordinary click advanced to this step and then submitted it,
                      and the member landed on the Documents step already being
                      told about fields they had not been shown.

                      A key forces a fresh node, and a node that did not exist
                      when the click began has no default action to perform. */}
                  {!isLastStep ? (
                    <Button
                      key="next"
                      type="button"
                      onClick={nextStep}
                      className="h-12 gap-1 sm:h-10 sm:gap-2"
                    >
                      {isBn ? 'পরবর্তী' : 'Next'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button key="submit" type="submit" disabled={busy} className="h-12 gap-2 sm:h-10">
                      {busy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          {submitStage === 'finishing'
                            ? isBn
                              ? 'সম্পন্ন হচ্ছে...'
                              : 'Finishing…'
                            : isBn
                              ? 'জমা হচ্ছে...'
                              : 'Submitting…'}
                        </>
                      ) : (
                        <>
                          {isBn ? 'নিবন্ধন সম্পন্ন করুন' : 'Complete Registration'}
                          <Check className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </form>

              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">
                  {isBn ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}{' '}
                </span>
                <Link href={localePath(locale, '/login')} className="font-medium text-primary hover:underline">
                  {isBn ? 'সাইন ইন' : 'Sign In'}
                </Link>
              </div>
            </CardContent>
          </Card>

          <p className="mt-8 text-center">
            <Link
              href={localePath(locale)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← {isBn ? 'হোম পেজে ফিরে যান' : 'Back to home'}
            </Link>
          </p>
        </div>
      </main>

      <footer className="mt-8 border-t py-6">
        <p className="text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Hasnahena. {isBn ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}
        </p>
      </footer>
    </div>
  );
}
