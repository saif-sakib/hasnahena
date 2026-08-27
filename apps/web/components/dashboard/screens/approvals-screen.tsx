'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  Download,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  REJECTION_REASON_CODES,
  REJECTION_REASON_LABELS,
  REJECTION_REASON_REQUIRING_NOTE,
  REJECTION_NOTE_MAX_LENGTH,
  type RejectionReasonCode,
} from '@/lib/rejection-reasons';
import { apiPost } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { downloadDocumentFile, guessFileNameFromUrl, isImageDocument } from '@/lib/document-files';
import { formatCurrency } from '@/lib/utils';
import { useDashboardRole } from '@/components/dashboard/role';
import Image from 'next/image';

type ApprovalTab = 'registration' | 'loan' | 'deposit';

interface RegistrationRequest {
  id: string;
  accountNo?: string;
  name: string;
  nameBn?: string;
  email?: string;
  phone: string;
  nidNumber?: string;
  fatherName?: string;
  motherName?: string;
  gender?: string;
  bloodGroup?: string;
  profession?: string;
  maritalStatus?: string;
  childrenCount?: number;
  dateOfBirth?: string;
  permanentAddress?: {
    houseNo?: string;
    roadNo?: string;
    village?: string;
    union?: string;
    policeStation?: string;
    district?: string;
  };
  presentAddress?: {
    houseNo?: string;
    roadNo?: string;
    village?: string;
    union?: string;
    policeStation?: string;
    district?: string;
  };
  nominee?: {
    name?: string;
    relationship?: string;
    nidNumber?: string;
    phone?: string;
  };
  documents?: Array<RegistrationDocument | string>;
  requestDate: string;
}

interface RegistrationDocument {
  id?: string;
  type?: string;
  url: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
}

interface TransactionRequest {
  id: string;
  type: 'WITHDRAWAL' | 'DEPOSIT' | 'LOAN_REPAYMENT' | string;
  amount: number;
  status: string;
  member: {
    name: string;
    accountNo: string;
  };
  requestDate: string;
  reference?: string;
  notes?: string;
  loanNumber?: string;
}

interface ApprovalsResponse {
  registrationRequests?: RegistrationRequest[];
  transactionRequests?: TransactionRequest[];
}

interface ApproveRegistrationResult {
  message?: string;
  emailDelivered?: boolean;
  deliveryError?: string;
  temporaryPassword?: string;
  /** Allocated by the approval itself — an application has none. */
  accountNo?: string;
}

function inferDocumentLabel(document: RegistrationDocument, index: number, locale: string): string {
  const source = `${document.type || ''} ${document.url}`.toLowerCase();
  if (source.includes('nid-front') || source.includes('nid_front') || source.includes('nid front')) {
    return locale === 'bn' ? 'এনআইডি (সামনের অংশ)' : 'NID Front';
  }
  if (source.includes('nid-back') || source.includes('nid_back') || source.includes('nid back')) {
    return locale === 'bn' ? 'এনআইডি (পেছনের অংশ)' : 'NID Back';
  }
  if (source.includes('member-photo') || source.includes('member_photo') || source.includes('member photo')) {
    return locale === 'bn' ? 'সদস্যের ছবি' : 'Member Photo';
  }
  if (source.includes('signature') || source.includes('member_signature')) {
    return locale === 'bn' ? 'স্বাক্ষর' : 'Signature';
  }
  return locale === 'bn' ? `নথি ${index + 1}` : `Document ${index + 1}`;
}

function RegistrationRow({
  item,
  locale,
  isActionLoading,
  onApprove,
  onReject,
}: {
  item: RegistrationRequest;
  locale: string;
  isActionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const tA11y = useTranslations('dashboard.a11y');
  const [expanded, setExpanded] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<RegistrationDocument | null>(null);
  const [downloadingDocumentKey, setDownloadingDocumentKey] = useState<string | null>(null);

  const formatAddress = (addr: RegistrationRequest['permanentAddress']) => {
    if (!addr) return '-';
    return [addr.village, addr.union, addr.policeStation, addr.district]
      .filter(Boolean)
      .join(', ') || '-';
  };

  const normalizedDocuments: RegistrationDocument[] = (item.documents ?? []).map((doc, index) => {
    if (typeof doc === 'string') {
      return {
        id: `${item.id}-doc-${index}`,
        url: doc,
        fileName: guessFileNameFromUrl(doc, `registration-document-${index + 1}`),
      };
    }
    return {
      id: doc.id || `${item.id}-doc-${index}`,
      type: doc.type,
      url: doc.url,
      fileName: doc.fileName || guessFileNameFromUrl(doc.url, `registration-document-${index + 1}`),
      mimeType: doc.mimeType,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
    };
  });

  const handleDownloadDocument = async (document: RegistrationDocument, fallbackLabel: string) => {
    const documentKey = document.id || document.url;
    setDownloadingDocumentKey(documentKey);
    try {
      await downloadDocumentFile(document.url, document.fileName || fallbackLabel);
    } finally {
      setDownloadingDocumentKey(null);
    }
  };

  const previewLabel = previewDocument
    ? inferDocumentLabel(
      previewDocument,
      Math.max(
        normalizedDocuments.findIndex(
          (document) => (document.id || document.url) === (previewDocument.id || previewDocument.url),
        ),
        0,
      ),
      locale,
    )
    : '';

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{item.name}</div>
          <div className="text-xs text-gray-500">{item.nameBn}</div>
          {item.accountNo && (
            <div className="text-xs text-gray-500 font-mono mt-0.5">{item.accountNo}</div>
          )}
        </td>
        <td className="px-4 py-3">{item.phone}</td>
        <td className="px-4 py-3 hidden sm:table-cell">{item.email || '-'}</td>
        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
          {new Date(item.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-600 hover:text-blue-800"
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={isActionLoading}
              onClick={onReject}
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={isActionLoading}
              onClick={onApprove}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div>
                <span className="text-gray-500">NID:</span> {item.nidNumber || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'পিতা:' : 'Father:'}</span> {item.fatherName || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'মাতা:' : 'Mother:'}</span> {item.motherName || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'লিঙ্গ:' : 'Gender:'}</span> {item.gender || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'রক্তের গ্রুপ:' : 'Blood Group:'}</span> {item.bloodGroup || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'পেশা:' : 'Profession:'}</span> {item.profession || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'বৈবাহিক:' : 'Marital:'}</span> {item.maritalStatus || '-'}
              </div>
              <div>
                <span className="text-gray-500">{locale === 'bn' ? 'সন্তান:' : 'Children:'}</span> {item.childrenCount ?? 0}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'স্থায়ী ঠিকানা:' : 'Permanent:'}</span>
                <span className="text-gray-700">{formatAddress(item.permanentAddress)}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">{locale === 'bn' ? 'বর্তমান ঠিকানা:' : 'Present:'}</span>
                <span className="text-gray-700">{formatAddress(item.presentAddress)}</span>
              </div>
            </div>
            {item.nominee && (
              <div className="mt-3 text-sm">
                <span className="text-gray-500">{locale === 'bn' ? 'নমিনী:' : 'Nominee:'}</span>{' '}
                {[item.nominee.name, item.nominee.relationship, item.nominee.phone].filter(Boolean).join(' • ') || '-'}
              </div>
            )}
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">
                {locale === 'bn' ? 'জমাকৃত ছবি ও নথি' : 'Submitted Photos & Documents'}
              </p>
              {normalizedDocuments.length > 0 ? (
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {normalizedDocuments.map((document, index) => {
                    const label = inferDocumentLabel(document, index, locale);
                    const documentKey = document.id || document.url;
                    const isDownloading = downloadingDocumentKey === documentKey;
                    return (
                      <div key={documentKey} className="rounded-sm border border-gray-200 bg-white p-3">
                        <p className="text-xs font-medium text-gray-700">{label}</p>
                        <div className="mt-2 overflow-hidden rounded-sm border border-gray-200 bg-slate-50">
                          {isImageDocument(document.url, document.mimeType) ? (
                            // WO-75. `fill` rather than fixed dimensions: these are
                            // member-uploaded scans, so nothing here knows their size.
                            // The parent is the box that decides, hence `relative`.
                            <div className="relative h-28 w-full">
                              <Image
                                src={document.url}
                                alt={label}
                                fill
                                sizes="(max-width: 768px) 100vw, 320px"
                                className="object-cover"
                              />
                            </div>
                          ) : (
                            <div className="flex h-28 items-center justify-center text-xs text-gray-500">
                              {locale === 'bn' ? 'প্রিভিউ নেই' : 'No preview available'}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                            onClick={() => setPreviewDocument(document)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {locale === 'bn' ? 'দেখুন' : 'View'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
                            onClick={() => void handleDownloadDocument(document, label)}
                            disabled={isDownloading}
                          >
                            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            {locale === 'bn' ? 'ডাউনলোড' : 'Download'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  {locale === 'bn' ? 'কোনো নথি পাওয়া যায়নি' : 'No documents found'}
                </p>
              )}
            </div>
            {previewDocument && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-3xl rounded-sm border border-gray-200 bg-white">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {previewLabel}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPreviewDocument(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
                    </button>
                  </div>
                  <div className="max-h-[75vh] overflow-auto bg-slate-50 p-4">
                    {isImageDocument(previewDocument.url, previewDocument.mimeType) ? (
                      // `object-contain`, not `cover`: this is the full-size read of
                      // an NID, and a crop that hides the corner of a document is
                      // worse than one that leaves letterboxing.
                      <div className="relative mx-auto h-[65vh] w-full">
                        <Image
                          src={previewDocument.url}
                          alt={previewDocument.fileName || 'Document preview'}
                          fill
                          sizes="100vw"
                          className="rounded-sm border border-gray-200 bg-white object-contain"
                        />
                      </div>
                    ) : (
                      <div className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">
                        {locale === 'bn' ? 'এই নথির জন্য ইনলাইন প্রিভিউ উপলব্ধ নয়।' : 'Inline preview is unavailable for this document.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The approvals queue — one screen for both staff dashboards.
 *
 * A worker sees the two tabs that are *processing* work: a member's deposit
 * request and a member's loan repayment request, which they act on by taking the
 * cash (FR-07). Approving a registration is an admin decision (product.md), so
 * that tab is not rendered for them — and the API agrees rather than merely
 * going along with it: `AdminApprovals` returns no `registrationRequests` to a
 * worker at all, and `POST /admin/approvals/registration` is mounted inside the
 * admin-only group.
 *
 * This screen was already shared — `dashboard/worker/approvals` was a one-line
 * re-export of it — but the endpoint it calls was mounted admin-only, so every
 * worker who opened it got a 403 and an empty page. That is the failure this
 * pair of changes closes.
 */
export default function ApprovalsScreen() {
  const locale = useLocale();
  const role = useDashboardRole();
  const canApproveRegistrations = role === 'admin';
  const [activeTab, setActiveTab] = useState<ApprovalTab>(
    canApproveRegistrations ? 'registration' : 'deposit',
  );
  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const {
    data: approvalsData,
    error: loadError,
    isLoading,
    refresh: loadApprovals,
  } = useApi<ApprovalsResponse>('/v1/dashboard/admin/approvals');

  const registrations = useMemo<RegistrationRequest[]>(
    () => approvalsData?.registrationRequests ?? [],
    [approvalsData],
  );
  const transactionRequests = useMemo<TransactionRequest[]>(
    () => approvalsData?.transactionRequests ?? [],
    [approvalsData],
  );

  const [isActionLoading, setIsActionLoading] = useState(false);
  // Approving or rejecting fails for its own reasons — a stale request, a
  // balance that moved — and must not be confused with a failure to load.
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * What the admin has to pass on, shown until they dismiss it.
   *
   * Both halves are returned once and stored nowhere: the temporary password is
   * only ever a bcrypt hash after this, and the account number — which the
   * approval has just allocated — is on a screen the admin has already left by
   * the time they think to look for it.
   *
   * It used to appear only when the approval *email* failed, which reads as
   * "the happy path told the member". Most members of this cooperative have no
   * email address at all (ADR-036), so for them the happy path told nobody, and
   * the number they will be asked for at the counter for the rest of their
   * membership went to a bcrypt hash and a log line.
   */
  const [approvedMember, setApprovedMember] = useState<{
    name: string;
    accountNo: string;
    temporaryPassword: string;
    emailDelivered: boolean;
  } | null>(null);
  const error = actionError ?? loadError;

  const loanRepaymentRequests = useMemo(
    () => transactionRequests.filter((item) => item.type === 'LOAN_REPAYMENT'),
    [transactionRequests],
  );

  const depositRequests = useMemo(
    () => transactionRequests.filter((item) => item.type !== 'LOAN_REPAYMENT'),
    [transactionRequests],
  );

  const pendingCount = useMemo(
    () => registrations.length + transactionRequests.length,
    [registrations.length, transactionRequests.length],
  );

  const tabCounts: Record<ApprovalTab, number> = {
    registration: registrations.length,
    loan: loanRepaymentRequests.length,
    deposit: depositRequests.length,
  };

  // What the reject dialog is currently about. `null` means it is closed.
  //
  // Rejection used to fire straight off an icon-only button with no
  // confirmation and no reason — `reason: ''` was hardcoded at the call site —
  // and it is irreversible. On a 412 px screen those buttons are 28 px apart,
  // which made a mis-tap enough to refuse somebody's membership.
  const [rejectTarget, setRejectTarget] = useState<RegistrationRequest | null>(null);
  const [rejectCode, setRejectCode] = useState<RejectionReasonCode | ''>('');
  const [rejectNote, setRejectNote] = useState('');
  const [rejectFieldError, setRejectFieldError] = useState<string | null>(null);

  const openRejectDialog = (item: RegistrationRequest) => {
    setRejectTarget(item);
    setRejectCode('');
    setRejectNote('');
    setRejectFieldError(null);
  };

  const closeRejectDialog = () => {
    setRejectTarget(null);
    setRejectFieldError(null);
  };

  const submitRejection = async () => {
    if (!rejectTarget) return;
    if (!rejectCode) {
      setRejectFieldError(locale === 'bn' ? 'একটি কারণ নির্বাচন করুন' : 'Choose a reason');
      return;
    }
    // Mirrors the server rule rather than trusting it to be forgiving: "Other"
    // with nothing after it tells the applicant exactly as much as no reason.
    if (rejectCode === REJECTION_REASON_REQUIRING_NOTE && !rejectNote.trim()) {
      setRejectFieldError(
        locale === 'bn' ? 'কারণটি লিখুন' : 'Describe the reason',
      );
      return;
    }

    setIsActionLoading(true);
    setActionError(null);
    try {
      const result = await apiPost<{ emailDelivered?: boolean; deliveryError?: string }>(
        '/v1/dashboard/admin/approvals/registration/reject',
        {
          userId: rejectTarget.id,
          reasonCode: rejectCode,
          reasonNote: rejectNote.trim(),
          locale,
        },
      );
      closeRejectDialog();

      // Erase the four identity documents now, not on a clock.
      //
      // A scan of a national identity card is the single most damaging thing
      // this platform stores, it is served from a URL that needs no login, and
      // the moment the foundation decides not to admit somebody it has no
      // remaining use for it — the written decision, the reason code and the
      // retention sweep's own clock cover every purpose keeping the images
      // would serve (ADR-038).
      //
      // Best effort, and deliberately so: this is a browser-initiated call, and
      // a closed tab or a Cloudinary outage must not leave the admin looking at
      // a rejection that appears to have failed. What makes that safe is that
      // the same route sweeps every refused application on a schedule, so
      // anything missed here is picked up rather than lost.
      void fetch('/api/v1/admin/retention', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof window !== 'undefined' && localStorage.getItem('hn_access_token')
            ? { Authorization: `Bearer ${localStorage.getItem('hn_access_token')}` }
            : {}),
        },
        body: JSON.stringify({ userId: rejectTarget.id }),
      }).catch(() => {
        // The scheduled sweep is the guarantee; this call is only the hurry.
      });

      // The rejection is committed either way. An admin whose email did not go
      // out has to telephone instead, and needs to be told that rather than
      // assuming the applicant has been informed.
      if (result?.emailDelivered === false) {
        const base = locale === 'bn'
          ? 'আবেদন বাতিল করা হয়েছে, কিন্তু আবেদনকারীকে ইমেইল পাঠানো যায়নি। তাকে সরাসরি জানান।'
          : 'The application was rejected, but the applicant could not be emailed. Tell them directly.';
        const detail = result.deliveryError
          ? ` ${locale === 'bn' ? 'কারণ:' : 'Reason:'} ${result.deliveryError}.`
          : '';
        setActionError(`${base}${detail}`);
      }
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? 'Action failed');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Approval only. Rejection goes through the dialog above, because it needs a
  // reason and a confirmation before it can be sent.
  const runRegistrationAction = async (id: string, action: 'approve') => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      if (action === 'approve') {
        const approvalResult = await apiPost<ApproveRegistrationResult>('/v1/dashboard/admin/approvals/registration', {
          userId: id,
          notes: '',
          locale,
        });
        setApprovedMember({
          name: registrations.find((item) => item.id === id)?.name ?? '',
          accountNo: approvalResult.accountNo ?? '',
          temporaryPassword: approvalResult.temporaryPassword ?? '',
          emailDelivered: approvalResult.emailDelivered !== false,
        });
        if (approvalResult.emailDelivered === false && approvalResult.deliveryError) {
          setActionError(
            locale === 'bn'
              ? `অনুমোদন ইমেইল পাঠানো যায়নি। কারণ: ${approvalResult.deliveryError}`
              : `The approval email could not be sent. Reason: ${approvalResult.deliveryError}`,
          );
        }
      }
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? 'Action failed');
    } finally {
      setIsActionLoading(false);
    }
  };

  const runTransactionAction = async (id: string, action: 'approve' | 'reject') => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const payload = { requestId: id, transactionId: id };
      if (action === 'approve') {
        await apiPost('/v1/dashboard/admin/approvals/withdrawal', payload);
      } else {
        await apiPost('/v1/dashboard/admin/approvals/withdrawal/reject', { ...payload, reason: '' });
      }
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? 'Action failed');
    } finally {
      setIsActionLoading(false);
    }
  };

  const getRequestTypeLabel = (type: TransactionRequest['type']) => {
    const labels: Record<string, { en: string; bn: string; tone: string }> = {
      DEPOSIT: {
        en: 'Deposit Request',
        bn: 'ডিপোজিট অনুরোধ',
        tone: 'bg-emerald-100 text-emerald-700',
      },
      LOAN_REPAYMENT: {
        en: 'Loan Repayment Request',
        bn: 'ঋণ পরিশোধ অনুরোধ',
        tone: 'bg-blue-100 text-blue-700',
      },
      WITHDRAWAL: {
        en: 'Withdrawal Request',
        bn: 'উত্তোলন অনুরোধ',
        tone: 'bg-amber-100 text-amber-700',
      },
    };
    return labels[type] ?? {
      en: type,
      bn: type,
      tone: 'bg-gray-100 text-gray-700',
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === 'bn' ? 'অনুমোদন কেন্দ্র' : 'Approvals'}
          </h1>
          <p className="text-sm text-gray-500">
            {pendingCount} {locale === 'bn' ? 'টি অপেক্ষমাণ কাজ' : 'pending items'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadApprovals()}
          disabled={isLoading || isActionLoading}
          className="h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${(isLoading || isActionLoading) ? 'animate-spin' : ''}`} />
          {locale === 'bn' ? 'রিফ্রেশ' : 'Refresh'}
        </Button>
      </div>

      <div className="border border-gray-200 bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'registration', en: 'Registration', bn: 'নিবন্ধন' },
            { key: 'loan', en: 'Loan Repayment', bn: 'ঋণ পরিশোধ' },
            { key: 'deposit', en: 'Deposit', bn: 'ডিপোজিট' },
          ] as const)
            .filter((tab) => tab.key !== 'registration' || canApproveRegistrations)
            .map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{locale === 'bn' ? tab.bn : tab.en}</span>
                <span className={`rounded-sm px-1.5 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-600'}`}>
                  {tabCounts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      {approvedMember && (
        <div
          role="status"
          className="border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">
              {locale === 'bn'
                ? `${approvedMember.name} এখন সদস্য`
                : `${approvedMember.name} is now a member`}
            </p>
            <button
              type="button"
              onClick={() => setApprovedMember(null)}
              className="shrink-0 rounded-sm border border-emerald-300 px-2 py-1 text-xs font-medium hover:bg-emerald-100"
            >
              {locale === 'bn' ? 'বন্ধ করুন' : 'Done'}
            </button>
          </div>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-emerald-700">
                {locale === 'bn' ? 'গ্রাহক আই.ডি' : 'Account No'}
              </dt>
              <dd className="mt-0.5 font-mono text-base font-semibold break-all">
                {approvedMember.accountNo || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-emerald-700">
                {locale === 'bn' ? 'অস্থায়ী পাসওয়ার্ড' : 'Temporary password'}
              </dt>
              <dd className="mt-0.5 font-mono text-base font-semibold break-all">
                {approvedMember.temporaryPassword || '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs">
            {approvedMember.emailDelivered
              ? locale === 'bn'
                ? 'এগুলো ইমেইলেও পাঠানো হয়েছে। এই পর্দা ছাড়লে আর দেখা যাবে না — প্রয়োজনে এখনই লিখে রাখুন।'
                : 'These were emailed as well. They cannot be shown again once you leave this screen — write them down now if the member needs them read out.'
              : locale === 'bn'
                ? 'সদস্যকে এখনই এগুলো পড়ে শোনান। এই পর্দা ছাড়লে আর দেখা যাবে না।'
                : 'Read these to the member now. They cannot be shown again once you leave this screen.'}
          </p>
        </div>
      )}

      {activeTab === 'registration' && canApproveRegistrations && (
        <div className="border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold">
              {locale === 'bn' ? 'নিবন্ধন অনুরোধ' : 'Registration Requests'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {locale === 'bn'
                ? 'ফর্মের তথ্য ও জমাকৃত ছবি দেখে অনুমোদন বা প্রত্যাখ্যান করুন'
                : 'Review form details and submitted photos before approval'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'নাম' : 'Name'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ফোন' : 'Phone'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">{locale === 'bn' ? 'ইমেইল' : 'Email'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                    </td>
                  </tr>
                ) : registrations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      {locale === 'bn' ? 'কোনো অপেক্ষমাণ নিবন্ধন নেই' : 'No pending registrations'}
                    </td>
                  </tr>
                ) : (
                  registrations.map((item) => (
                    <RegistrationRow
                      key={item.id}
                      item={item}
                      locale={locale}
                      isActionLoading={isActionLoading}
                      onApprove={() => void runRegistrationAction(item.id, 'approve')}
                      onReject={() => openRejectDialog(item)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'loan' && (
        <div className="space-y-4">
          <div className="border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold">
                {locale === 'bn' ? 'ঋণ পরিশোধ অনুরোধ' : 'Loan Repayment Requests'}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'সদস্য' : 'Member'}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'ঋণ' : 'Loan'}</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'রেফারেন্স' : 'Reference'}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                      </td>
                    </tr>
                  ) : loanRepaymentRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        {locale === 'bn' ? 'কোনো অপেক্ষমাণ ঋণ পরিশোধ অনুরোধ নেই' : 'No pending loan repayment requests'}
                      </td>
                    </tr>
                  ) : (
                    loanRepaymentRequests.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.member?.name || '-'}</div>
                          <div className="text-xs text-gray-500">{item.member?.accountNo || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{item.loanNumber || '-'}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.amount, locale)}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-600">{item.reference || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={isActionLoading}
                              onClick={() => void runTransactionAction(item.id, 'reject')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              disabled={isActionLoading}
                              onClick={() => void runTransactionAction(item.id, 'approve')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'deposit' && (
        <div className="border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold">
              {locale === 'bn' ? 'ডিপোজিট অনুরোধ' : 'Deposit Requests'}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'সদস্য' : 'Member'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'অনুরোধ' : 'Request'}</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">{locale === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'রেফারেন্স' : 'Reference'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">{locale === 'bn' ? 'তারিখ' : 'Date'}</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">{locale === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                    </td>
                  </tr>
                ) : depositRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      {locale === 'bn' ? 'কোনো অপেক্ষমাণ ডিপোজিট অনুরোধ নেই' : 'No pending deposit requests'}
                    </td>
                  </tr>
                ) : (
                  depositRequests.map((item) => {
                    const typeMeta = getRequestTypeLabel(item.type);
                    return (
                      <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.member?.name || '-'}</div>
                          <div className="text-xs text-gray-500">{item.member?.accountNo || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${typeMeta.tone}`}>
                            {locale === 'bn' ? typeMeta.bn : typeMeta.en}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.amount, locale)}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-600">{item.reference || '-'}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                          {new Date(item.requestDate).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={isActionLoading}
                              onClick={() => void runTransactionAction(item.id, 'reject')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              disabled={isActionLoading}
                              onClick={() => void runTransactionAction(item.id, 'approve')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        Rejecting an application is irreversible and, since 2026-08-26, sends the
        applicant an email. It used to happen on a single tap of a 28 px icon
        with no reason attached and nothing sent. This dialog is the
        confirmation *and* the reason, which is deliberate: a confirm step that
        only asks "are you sure?" trains people to tap through it, while one that
        asks for something makes them look at the row again.
      */}
      <Dialog open={rejectTarget !== null} onOpenChange={(open) => { if (!open) closeRejectDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {locale === 'bn' ? 'আবেদন বাতিল করবেন?' : 'Reject this application?'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'bn'
                ? `${rejectTarget?.name ?? ''} — আবেদনকারীকে ইমেইলে কারণসহ জানানো হবে। তিনি চাইলে আবার আবেদন করতে পারবেন।`
                : `${rejectTarget?.name ?? ''} — the applicant is emailed with the reason, and may apply again.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">
                {locale === 'bn' ? 'কারণ' : 'Reason'}
              </Label>
              {/*
                A native <select>. The applicant reads whichever of these the
                admin picks, translated into *their* language on the server, so
                the important property is that a reason is always chosen — not
                that the control is elaborate. Native also means it works with
                one thumb on a low-end Android, which is rule 10's whole point.
              */}
              <select
                id="reject-reason"
                value={rejectCode}
                onChange={(e) => {
                  setRejectCode(e.target.value as RejectionReasonCode | '');
                  setRejectFieldError(null);
                }}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">
                  {locale === 'bn' ? 'কারণ নির্বাচন করুন…' : 'Choose a reason…'}
                </option>
                {REJECTION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {REJECTION_REASON_LABELS[code][locale === 'bn' ? 'bn' : 'en']}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reject-note">
                {locale === 'bn' ? 'বিস্তারিত' : 'Details'}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {rejectCode === REJECTION_REASON_REQUIRING_NOTE
                    ? (locale === 'bn' ? '(আবশ্যক)' : '(required)')
                    : (locale === 'bn' ? '(ঐচ্ছিক)' : '(optional)')}
                </span>
              </Label>
              <Textarea
                id="reject-note"
                rows={3}
                maxLength={REJECTION_NOTE_MAX_LENGTH}
                value={rejectNote}
                onChange={(e) => { setRejectNote(e.target.value); setRejectFieldError(null); }}
                placeholder={locale === 'bn'
                  ? 'যেমন: এন.আই.ডি-র পিছনের ছবিটি স্পষ্ট নয়।'
                  : 'e.g. the back of the NID is not readable.'}
              />
              <p className="text-xs text-muted-foreground">
                {locale === 'bn'
                  ? 'এটি আবেদনকারীকে পাঠানো ইমেইলে যুক্ত হবে।'
                  : 'This is included in the email sent to the applicant.'}
              </p>
            </div>

            {rejectFieldError && (
              <p role="alert" className="text-sm text-red-600">{rejectFieldError}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeRejectDialog} disabled={isActionLoading}>
              {locale === 'bn' ? 'বাতিল' : 'Cancel'}
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void submitRejection()}
              disabled={isActionLoading}
            >
              {isActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {locale === 'bn' ? 'আবেদন বাতিল করুন' : 'Reject application'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
