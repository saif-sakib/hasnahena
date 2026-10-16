"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Building2,
  Eye,
  Download,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REJECTION_REASON_CODES,
  REJECTION_REASON_LABELS,
  REJECTION_REASON_REQUIRING_NOTE,
  REJECTION_NOTE_MAX_LENGTH,
  type RejectionReasonCode,
} from "@/lib/rejection-reasons";
import { apiPost } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import useSWR from "swr";
import {
  downloadDocumentFile,
  guessFileNameFromUrl,
  isImageDocument,
} from "@/lib/document-files";
import { formatCurrency } from "@/lib/utils";
import { useDashboardRole } from "@/components/dashboard/role";
import Image from "next/image";

type ApprovalTab = "registration" | "loan" | "deposit";

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
  type: "WITHDRAWAL" | "DEPOSIT" | "LOAN_REPAYMENT" | string;
  amount: number;
  status: string;
  member: {
    name: string;
    accountNo: string;
  };
  requestDate: string;
  reference?: string;
  notes?: string;
  loanId?: string;
}

interface ApprovalsResponse {
  registrationRequests?: RegistrationRequest[];
  transactionRequests?: TransactionRequest[];
}

interface ApproveRegistrationResult {
  message?: string;
  emailDelivered?: boolean;
  deliveryError?: string;
  /** Allocated by the approval. The temporary password is never returned (ADR-036). */
  accountNo?: string;
}

/**
 * Submission time to the minute (first-asked is served first), as two parts so
 * callers can stack them at 412px.
 */
function formatSubmitted(
  value: string,
  locale: string,
): { date: string; time: string } {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return { date: "-", time: "" };
  const tag = locale === "bn" ? "bn-BD" : "en-GB";
  return {
    date: when.toLocaleDateString(tag, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: when.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }),
  };
}

/** The submitted stamp, stacked; also under the name on phones, where the Date column is hidden. */
function SubmittedStamp({ value, locale }: { value: string; locale: string }) {
  const { date, time } = formatSubmitted(value, locale);
  return (
    <>
      <span className="block">{date}</span>
      {time ? (
        <span className="block text-[11px] text-gray-400">{time}</span>
      ) : null}
    </>
  );
}

/** The offices an admin can admit somebody to. */
interface BranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

function inferDocumentLabel(
  document: RegistrationDocument,
  index: number,
  locale: string,
): string {
  const source = `${document.type || ""} ${document.url}`.toLowerCase();
  if (
    source.includes("nid-front") ||
    source.includes("nid_front") ||
    source.includes("nid front")
  ) {
    return locale === "bn" ? "এনআইডি (সামনের অংশ)" : "NID Front";
  }
  if (
    source.includes("nid-back") ||
    source.includes("nid_back") ||
    source.includes("nid back")
  ) {
    return locale === "bn" ? "এনআইডি (পেছনের অংশ)" : "NID Back";
  }
  if (
    source.includes("member-photo") ||
    source.includes("member_photo") ||
    source.includes("member photo")
  ) {
    return locale === "bn" ? "সদস্যের ছবি" : "Member Photo";
  }
  if (source.includes("signature") || source.includes("member_signature")) {
    return locale === "bn" ? "স্বাক্ষর" : "Signature";
  }
  return locale === "bn" ? `নথি ${index + 1}` : `Document ${index + 1}`;
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
  const tA11y = useTranslations("dashboard.a11y");
  const [expanded, setExpanded] = useState(false);
  const [previewDocument, setPreviewDocument] =
    useState<RegistrationDocument | null>(null);
  const [downloadingDocumentKey, setDownloadingDocumentKey] = useState<
    string | null
  >(null);

  const formatAddress = (addr: RegistrationRequest["permanentAddress"]) => {
    if (!addr) return "-";
    return (
      [addr.village, addr.union, addr.policeStation, addr.district]
        .filter(Boolean)
        .join(", ") || "-"
    );
  };

  const normalizedDocuments: RegistrationDocument[] = (
    item.documents ?? []
  ).map((doc, index) => {
    if (typeof doc === "string") {
      return {
        id: `${item.id}-doc-${index}`,
        url: doc,
        fileName: guessFileNameFromUrl(
          doc,
          `registration-document-${index + 1}`,
        ),
      };
    }
    return {
      id: doc.id || `${item.id}-doc-${index}`,
      type: doc.type,
      url: doc.url,
      fileName:
        doc.fileName ||
        guessFileNameFromUrl(doc.url, `registration-document-${index + 1}`),
      mimeType: doc.mimeType,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
    };
  });

  const handleDownloadDocument = async (
    document: RegistrationDocument,
    fallbackLabel: string,
  ) => {
    const documentKey = document.id || document.url;
    setDownloadingDocumentKey(documentKey);
    try {
      await downloadDocumentFile(
        document.url,
        document.fileName || fallbackLabel,
      );
    } finally {
      setDownloadingDocumentKey(null);
    }
  };

  const previewLabel = previewDocument
    ? inferDocumentLabel(
        previewDocument,
        Math.max(
          normalizedDocuments.findIndex(
            (document) =>
              (document.id || document.url) ===
              (previewDocument.id || previewDocument.url),
          ),
          0,
        ),
        locale,
      )
    : "";

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{item.name}</div>
          <div className="text-xs text-gray-500">{item.nameBn}</div>
          {item.accountNo && (
            <div className="text-xs text-gray-500 font-mono mt-0.5">
              {item.accountNo}
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-gray-400 md:hidden">
            {formatSubmitted(item.requestDate, locale).date}{" "}
            {formatSubmitted(item.requestDate, locale).time}
          </div>
        </td>
        <td className="px-4 py-3">{item.phone}</td>
        <td className="px-4 py-3 hidden sm:table-cell">{item.email || "-"}</td>
        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
          <SubmittedStamp value={item.requestDate} locale={locale} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-600 hover:text-blue-800"
              aria-label={expanded ? "Collapse details" : "Expand details"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
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
                <span className="text-gray-500">NID:</span>{" "}
                {item.nidNumber || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "পিতা:" : "Father:"}
                </span>{" "}
                {item.fatherName || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "মাতা:" : "Mother:"}
                </span>{" "}
                {item.motherName || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "লিঙ্গ:" : "Gender:"}
                </span>{" "}
                {item.gender || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "রক্তের গ্রুপ:" : "Blood Group:"}
                </span>{" "}
                {item.bloodGroup || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "পেশা:" : "Profession:"}
                </span>{" "}
                {item.profession || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "বৈবাহিক:" : "Marital:"}
                </span>{" "}
                {item.maritalStatus || "-"}
              </div>
              <div>
                <span className="text-gray-500">
                  {locale === "bn" ? "সন্তান:" : "Children:"}
                </span>{" "}
                {item.childrenCount ?? 0}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="text-gray-500 block mb-1">
                  {locale === "bn" ? "স্থায়ী ঠিকানা:" : "Permanent:"}
                </span>
                <span className="text-gray-700">
                  {formatAddress(item.permanentAddress)}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">
                  {locale === "bn" ? "বর্তমান ঠিকানা:" : "Present:"}
                </span>
                <span className="text-gray-700">
                  {formatAddress(item.presentAddress)}
                </span>
              </div>
            </div>
            {item.nominee && (
              <div className="mt-3 text-sm">
                <span className="text-gray-500">
                  {locale === "bn" ? "নমিনী:" : "Nominee:"}
                </span>{" "}
                {[
                  item.nominee.name,
                  item.nominee.relationship,
                  item.nominee.phone,
                ]
                  .filter(Boolean)
                  .join(" • ") || "-"}
              </div>
            )}
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">
                {locale === "bn"
                  ? "জমাকৃত ছবি ও নথি"
                  : "Submitted Photos & Documents"}
              </p>
              {normalizedDocuments.length > 0 ? (
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {normalizedDocuments.map((document, index) => {
                    const label = inferDocumentLabel(document, index, locale);
                    const documentKey = document.id || document.url;
                    const isDownloading =
                      downloadingDocumentKey === documentKey;
                    return (
                      <div
                        key={documentKey}
                        className="rounded-sm border border-gray-200 bg-white p-3"
                      >
                        <p className="text-xs font-medium text-gray-700">
                          {label}
                        </p>
                        <div className="mt-2 overflow-hidden rounded-sm border border-gray-200 bg-slate-50">
                          {isImageDocument(document.url, document.mimeType) ? (
                            // `fill`: member scans have unknown sizes (WO-75).
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
                              {locale === "bn"
                                ? "প্রিভিউ নেই"
                                : "No preview available"}
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
                            {locale === "bn" ? "দেখুন" : "View"}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
                            onClick={() =>
                              void handleDownloadDocument(document, label)
                            }
                            disabled={isDownloading}
                          >
                            {isDownloading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            {locale === "bn" ? "ডাউনলোড" : "Download"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  {locale === "bn"
                    ? "কোনো নথি পাওয়া যায়নি"
                    : "No documents found"}
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
                      {locale === "bn" ? "বন্ধ করুন" : "Close"}
                    </button>
                  </div>
                  <div className="max-h-[75vh] overflow-auto bg-slate-50 p-4">
                    {isImageDocument(
                      previewDocument.url,
                      previewDocument.mimeType,
                    ) ? (
                      // object-contain: never crop the corner of an NID.
                      <div className="relative mx-auto h-[65vh] w-full">
                        <Image
                          src={previewDocument.url}
                          alt={previewDocument.fileName || "Document preview"}
                          fill
                          sizes="100vw"
                          className="rounded-sm border border-gray-200 bg-white object-contain"
                        />
                      </div>
                    ) : (
                      <div className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">
                        {locale === "bn"
                          ? "এই নথির জন্য ইনলাইন প্রিভিউ উপলব্ধ নয়।"
                          : "Inline preview is unavailable for this document."}
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
 * The approvals queue for both staff dashboards. Workers see the processing
 * tabs (deposits, repayments); registrations are admin-only, and the API
 * returns none to a worker.
 */
export default function ApprovalsScreen() {
  const locale = useLocale();
  const role = useDashboardRole();
  const canApproveRegistrations = role === "admin";
  const [activeTab, setActiveTab] = useState<ApprovalTab>(
    canApproveRegistrations ? "registration" : "deposit",
  );
  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const {
    data: approvalsData,
    error: loadError,
    isLoading,
    refresh: loadApprovals,
  } = useApi<ApprovalsResponse>("/v1/dashboard/admin/approvals");

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
   * The newly allocated account number, shown until dismissed (no email goes
   * to most members). Deliberately NOT the password — that comes from Reset
   * password on the member's page (ADR-036).
   */
  const [approvedMember, setApprovedMember] = useState<{
    name: string;
    accountNo: string;
    branchName: string;
    emailDelivered: boolean;
    /** `null` while the documents are still being filed; `false` if they were not. */
    filed: boolean | null;
  } | null>(null);
  // Cleared on the next approval, and by the admin. Small enough to sit above
  // the queue without pushing it off a 412 px screen.

  const error = actionError ?? loadError;

  const loanRepaymentRequests = useMemo(
    () => transactionRequests.filter((item) => item.type === "LOAN_REPAYMENT"),
    [transactionRequests],
  );

  const depositRequests = useMemo(
    () => transactionRequests.filter((item) => item.type !== "LOAN_REPAYMENT"),
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

  /** The application being admitted, and to which office (a decision, not a guess). */
  const [approveTarget, setApproveTarget] =
    useState<RegistrationRequest | null>(null);
  const [approveBranchId, setApproveBranchId] = useState<string>("");

  // Offices from the Next route, loaded once for the screen.
  const { data: branches } = useSWR<BranchOption[], Error>(
    canApproveRegistrations ? "/api/v1/admin/branches" : null,
    async (url: string) => {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("hn_access_token")
          : null;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok)
        throw new Error(payload?.error || "Failed to load offices");
      return payload.data as BranchOption[];
    },
  );

  const activeBranches = useMemo(
    () => (branches ?? []).filter((b) => b.isActive),
    [branches],
  );

  const openApproveDialog = (item: RegistrationRequest) => {
    setApproveTarget(item);
    // Pre-select only when there is exactly one active office.
    setApproveBranchId(activeBranches.length === 1 ? activeBranches[0].id : "");
  };

  const [rejectTarget, setRejectTarget] = useState<RegistrationRequest | null>(
    null,
  );
  const [rejectCode, setRejectCode] = useState<RejectionReasonCode | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejectFieldError, setRejectFieldError] = useState<string | null>(null);

  const openRejectDialog = (item: RegistrationRequest) => {
    setRejectTarget(item);
    setRejectCode("");
    setRejectNote("");
    setRejectFieldError(null);
  };

  const closeRejectDialog = () => {
    setRejectTarget(null);
    setRejectFieldError(null);
  };

  const submitRejection = async () => {
    if (!rejectTarget) return;
    if (!rejectCode) {
      setRejectFieldError(
        locale === "bn" ? "একটি কারণ নির্বাচন করুন" : "Choose a reason",
      );
      return;
    }
    // Mirrors the server rule rather than trusting it to be forgiving: "Other"
    // with nothing after it tells the applicant exactly as much as no reason.
    if (rejectCode === REJECTION_REASON_REQUIRING_NOTE && !rejectNote.trim()) {
      setRejectFieldError(
        locale === "bn" ? "কারণটি লিখুন" : "Describe the reason",
      );
      return;
    }

    setIsActionLoading(true);
    setActionError(null);
    try {
      const result = await apiPost<{
        emailDelivered?: boolean;
        deliveryError?: string;
      }>("/v1/dashboard/admin/approvals/registration/reject", {
        userId: rejectTarget.id,
        reasonCode: rejectCode,
        reasonNote: rejectNote.trim(),
        locale,
      });
      closeRejectDialog();

      // Delete the four identity documents NOW (ADR-038). Best effort — the
      // nightly sweep catches anything missed.
      void fetch("/api/v1/admin/retention", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof window !== "undefined" &&
          localStorage.getItem("hn_access_token")
            ? {
                Authorization: `Bearer ${localStorage.getItem("hn_access_token")}`,
              }
            : {}),
        },
        body: JSON.stringify({ userId: rejectTarget.id }),
      }).catch(() => {
        // The scheduled sweep is the guarantee; this call is only the hurry.
      });

      // Committed either way; if the email failed, the admin must phone.
      if (result?.emailDelivered === false) {
        const base =
          locale === "bn"
            ? "আবেদন বাতিল করা হয়েছে, কিন্তু আবেদনকারীকে ইমেইল পাঠানো যায়নি। তাকে সরাসরি জানান।"
            : "The application was rejected, but the applicant could not be emailed. Tell them directly.";
        const detail = result.deliveryError
          ? ` ${locale === "bn" ? "কারণ:" : "Reason:"} ${result.deliveryError}.`
          : "";
        setActionError(`${base}${detail}`);
      }
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? "Action failed");
    } finally {
      setIsActionLoading(false);
    }
  };

  // Approval. Rejection goes through its own dialog, because it needs a reason;
  // this one needs an office.
  const submitApproval = async () => {
    if (!approveTarget) return;
    const id = approveTarget.id;
    setIsActionLoading(true);
    setActionError(null);
    try {
      const approvalResult = await apiPost<ApproveRegistrationResult>(
        "/v1/dashboard/admin/approvals/registration",
        {
          userId: id,
          notes: "",
          locale,
          branchId: approveBranchId,
        },
      );
      setApproveTarget(null);
      setApprovedMember({
        name: registrations.find((item) => item.id === id)?.name ?? "",
        accountNo: approvalResult.accountNo ?? "",
        branchName:
          activeBranches.find((b) => b.id === approveBranchId)?.name ?? "",
        emailDelivered: approvalResult.emailDelivered !== false,
        filed: null,
      });

      // File the documents under people/<accountNo> (ADR-040). Awaited and
      // reported — the admin is the only one who would notice a failure — but it
      // cannot fail the approval. Uses the NEW id: admission renamed the row (ADR-043).
      const memberId = approvalResult.accountNo ?? id;
      void (async () => {
        try {
          const token =
            typeof window !== "undefined"
              ? localStorage.getItem("hn_access_token")
              : null;
          const res = await fetch(
            `/api/v1/admin/members/${memberId}/refile-documents`,
            {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            },
          );
          const payload = await res.json().catch(() => null);
          const data = payload?.data as
            { moved?: number; failed?: number } | undefined;
          const ok =
            res.ok && payload?.ok === true && (data?.failed ?? 0) === 0;
          setApprovedMember((current) =>
            current && current.accountNo === (approvalResult.accountNo ?? "")
              ? { ...current, filed: ok }
              : current,
          );
        } catch {
          setApprovedMember((current) =>
            current && current.accountNo === (approvalResult.accountNo ?? "")
              ? { ...current, filed: false }
              : current,
          );
        }
      })();

      if (
        approvalResult.emailDelivered === false &&
        approvalResult.deliveryError
      ) {
        setActionError(
          locale === "bn"
            ? `অনুমোদন ইমেইল পাঠানো যায়নি। কারণ: ${approvalResult.deliveryError}`
            : `The approval email could not be sent. Reason: ${approvalResult.deliveryError}`,
        );
      }
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? "Action failed");
    } finally {
      setIsActionLoading(false);
    }
  };

  /**
   * The posting the confirmation dialog is about. Approve/reject move money and
   * the buttons are 28px apart, so each asks first.
   */
  const [transactionTarget, setTransactionTarget] = useState<{
    item: TransactionRequest;
    action: "approve" | "reject";
  } | null>(null);

  const runTransactionAction = async (
    id: string,
    action: "approve" | "reject",
  ) => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const payload = { requestId: id, transactionId: id };
      if (action === "approve") {
        await apiPost("/v1/dashboard/admin/approvals/withdrawal", payload);
      } else {
        await apiPost("/v1/dashboard/admin/approvals/withdrawal/reject", {
          ...payload,
          reason: "",
        });
      }
      setTransactionTarget(null);
      // The shared SWR key also clears the sidebar's red dot.
      await loadApprovals();
    } catch (e: any) {
      setActionError(e?.message ?? "Action failed");
    } finally {
      setIsActionLoading(false);
    }
  };

  const getRequestTypeLabel = (type: TransactionRequest["type"]) => {
    const labels: Record<string, { en: string; bn: string; tone: string }> = {
      DEPOSIT: {
        en: "Deposit Request",
        bn: "ডিপোজিট অনুরোধ",
        tone: "bg-emerald-100 text-emerald-700",
      },
      LOAN_REPAYMENT: {
        en: "Loan Repayment Request",
        bn: "ঋণ পরিশোধ অনুরোধ",
        tone: "bg-blue-100 text-blue-700",
      },
      WITHDRAWAL: {
        en: "Withdrawal Request",
        bn: "উত্তোলন অনুরোধ",
        tone: "bg-amber-100 text-amber-700",
      },
    };
    return (
      labels[type] ?? {
        en: type,
        bn: type,
        tone: "bg-gray-100 text-gray-700",
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {locale === "bn" ? "অনুমোদন কেন্দ্র" : "Approvals"}
          </h1>
          <p className="text-sm text-gray-500">
            {pendingCount}{" "}
            {locale === "bn" ? "টি অপেক্ষমাণ কাজ" : "pending items"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadApprovals()}
          disabled={isLoading || isActionLoading}
          className="h-8"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1 ${isLoading || isActionLoading ? "animate-spin" : ""}`}
          />
          {locale === "bn" ? "রিফ্রেশ" : "Refresh"}
        </Button>
      </div>

      <div className="border border-gray-200 bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "registration", en: "Registration", bn: "নিবন্ধন" },
              { key: "loan", en: "Loan Repayment", bn: "ঋণ পরিশোধ" },
              { key: "deposit", en: "Deposit", bn: "ডিপোজিট" },
            ] as const
          )
            .filter(
              (tab) => tab.key !== "registration" || canApproveRegistrations,
            )
            .map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span>{locale === "bn" ? tab.bn : tab.en}</span>
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-xs ${isActive ? "bg-white/20 text-white" : "bg-white text-slate-600"}`}
                  >
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
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          <span className="font-medium">
            {locale === "bn"
              ? `${approvedMember.name} এখন সদস্য`
              : `${approvedMember.name} is now a member`}
          </span>
          <span className="font-mono font-semibold">
            {approvedMember.accountNo || "—"}
          </span>
          {approvedMember.branchName && (
            <span className="text-emerald-700">
              · {approvedMember.branchName}
            </span>
          )}
          <span className="text-emerald-700">
            {"· "}
            {approvedMember.emailDelivered
              ? locale === "bn"
                ? "অস্থায়ী পাসওয়ার্ড ইমেইলে পাঠানো হয়েছে"
                : "temporary password emailed"
              : locale === "bn"
                ? "ইমেইল নেই — সদস্যের পাতা থেকে পাসওয়ার্ড রিসেট করুন"
                : "no email — issue a password from their page"}
          </span>
          {approvedMember.filed === false && (
            <span className="text-amber-700">
              {"· "}
              {locale === "bn"
                ? "নথিগুলো এখনও আবেদনের ফোল্ডারে — রাতের কাজ আবার চেষ্টা করবে"
                : "documents still in the application folder — the nightly sweep will retry"}
            </span>
          )}
          <button
            type="button"
            onClick={() => setApprovedMember(null)}
            className="ml-auto shrink-0 text-emerald-700 hover:text-emerald-900"
            aria-label={locale === "bn" ? "বন্ধ করুন" : "Dismiss"}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {activeTab === "registration" && canApproveRegistrations && (
        <div className="border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold">
              {locale === "bn" ? "নিবন্ধন অনুরোধ" : "Registration Requests"}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {locale === "bn"
                ? "ফর্মের তথ্য ও জমাকৃত ছবি দেখে অনুমোদন বা প্রত্যাখ্যান করুন"
                : "Review form details and submitted photos before approval"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "নাম" : "Name"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "ফোন" : "Phone"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">
                    {locale === "bn" ? "ইমেইল" : "Email"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                    {locale === "bn" ? "তারিখ" : "Date"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "অ্যাকশন" : "Action"}
                  </th>
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
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-gray-500"
                    >
                      {locale === "bn"
                        ? "কোনো অপেক্ষমাণ নিবন্ধন নেই"
                        : "No pending registrations"}
                    </td>
                  </tr>
                ) : (
                  registrations.map((item) => (
                    <RegistrationRow
                      key={item.id}
                      item={item}
                      locale={locale}
                      isActionLoading={isActionLoading}
                      onApprove={() => openApproveDialog(item)}
                      onReject={() => openRejectDialog(item)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "loan" && (
        <div className="space-y-4">
          <div className="border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold">
                {locale === "bn"
                  ? "ঋণ পরিশোধ অনুরোধ"
                  : "Loan Repayment Requests"}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      {locale === "bn" ? "সদস্য" : "Member"}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      {locale === "bn" ? "ঋণ" : "Loan"}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">
                      {locale === "bn" ? "পরিমাণ" : "Amount"}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                      {locale === "bn" ? "রেফারেন্স" : "Reference"}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                      {locale === "bn" ? "তারিখ" : "Date"}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      {locale === "bn" ? "অ্যাকশন" : "Action"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                      </td>
                    </tr>
                  ) : loanRepaymentRequests.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        {locale === "bn"
                          ? "কোনো অপেক্ষমাণ ঋণ পরিশোধ অনুরোধ নেই"
                          : "No pending loan repayment requests"}
                      </td>
                    </tr>
                  ) : (
                    loanRepaymentRequests.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {item.member?.name || "-"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {item.member?.accountNo || "-"}
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-400 md:hidden">
                            {formatSubmitted(item.requestDate, locale).date}{" "}
                            {formatSubmitted(item.requestDate, locale).time}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {item.loanId || "-"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(item.amount, locale)}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-600">
                          {item.reference || "-"}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                          <SubmittedStamp
                            value={item.requestDate}
                            locale={locale}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={isActionLoading}
                              onClick={() =>
                                setTransactionTarget({ item, action: "reject" })
                              }
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              disabled={isActionLoading}
                              onClick={() =>
                                setTransactionTarget({
                                  item,
                                  action: "approve",
                                })
                              }
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

      {activeTab === "deposit" && (
        <div className="border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold">
              {locale === "bn" ? "ডিপোজিট অনুরোধ" : "Deposit Requests"}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "সদস্য" : "Member"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "অনুরোধ" : "Request"}
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                    {locale === "bn" ? "পরিমাণ" : "Amount"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                    {locale === "bn" ? "রেফারেন্স" : "Reference"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 hidden md:table-cell">
                    {locale === "bn" ? "তারিখ" : "Date"}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                    {locale === "bn" ? "অ্যাকশন" : "Action"}
                  </th>
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
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-gray-500"
                    >
                      {locale === "bn"
                        ? "কোনো অপেক্ষমাণ ডিপোজিট অনুরোধ নেই"
                        : "No pending deposit requests"}
                    </td>
                  </tr>
                ) : (
                  depositRequests.map((item) => {
                    const typeMeta = getRequestTypeLabel(item.type);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {item.member?.name || "-"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {item.member?.accountNo || "-"}
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-400 md:hidden">
                            {formatSubmitted(item.requestDate, locale).date}{" "}
                            {formatSubmitted(item.requestDate, locale).time}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${typeMeta.tone}`}
                          >
                            {locale === "bn" ? typeMeta.bn : typeMeta.en}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(item.amount, locale)}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-600">
                          {item.reference || "-"}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                          <SubmittedStamp
                            value={item.requestDate}
                            locale={locale}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={isActionLoading}
                              onClick={() =>
                                setTransactionTarget({ item, action: "reject" })
                              }
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              disabled={isActionLoading}
                              onClick={() =>
                                setTransactionTarget({
                                  item,
                                  action: "approve",
                                })
                              }
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

      {/* Approving asks which office the member belongs to (pre-selected when there is one). */}
      {/* Confirming restates who, what, how much and when — not a bare "are you sure?". */}
      <Dialog
        open={transactionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTransactionTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {transactionTarget?.action === "approve"
                ? locale === "bn"
                  ? "অনুরোধটি অনুমোদন করবেন?"
                  : "Approve this request?"
                : locale === "bn"
                  ? "অনুরোধটি বাতিল করবেন?"
                  : "Reject this request?"}
            </DialogTitle>
            <DialogDescription>
              {transactionTarget?.action === "approve"
                ? locale === "bn"
                  ? "অনুমোদন করার সাথে সাথেই সদস্যের হিসাব পরিবর্তিত হবে। এই পাতা থেকে তা ফেরানো যাবে না — সংশোধন করতে হলে নতুন এন্ট্রি দিতে হবে।"
                  : "The member's balance changes as soon as you confirm. It cannot be undone from this screen — a correction has to be posted separately."
                : locale === "bn"
                  ? "সদস্যকে জানানো হবে যে অনুরোধটি গ্রহণ করা হয়নি। এটি ফেরানো যাবে না।"
                  : "The member will be told the request was not accepted. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>

          {transactionTarget ? (
            <dl className="space-y-2 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">
                  {locale === "bn" ? "সদস্য" : "Member"}
                </dt>
                <dd className="text-right font-medium text-gray-900">
                  {transactionTarget.item.member?.name || "-"}
                  <span className="block font-mono text-xs font-normal text-gray-500">
                    {transactionTarget.item.member?.accountNo || "-"}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">
                  {locale === "bn" ? "ধরন" : "Type"}
                </dt>
                <dd className="text-right text-gray-900">
                  {locale === "bn"
                    ? getRequestTypeLabel(transactionTarget.item.type).bn
                    : getRequestTypeLabel(transactionTarget.item.type).en}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">
                  {locale === "bn" ? "পরিমাণ" : "Amount"}
                </dt>
                <dd className="text-right font-semibold text-gray-900">
                  {formatCurrency(transactionTarget.item.amount, locale)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">
                  {locale === "bn" ? "জমা দেওয়ার সময়" : "Submitted"}
                </dt>
                <dd className="text-right text-gray-900">
                  {
                    formatSubmitted(transactionTarget.item.requestDate, locale)
                      .date
                  }{" "}
                  <span className="text-gray-500">
                    {
                      formatSubmitted(
                        transactionTarget.item.requestDate,
                        locale,
                      ).time
                    }
                  </span>
                </dd>
              </div>
            </dl>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransactionTarget(null)}
              disabled={isActionLoading}
            >
              {locale === "bn" ? "বাতিল" : "Cancel"}
            </Button>
            <Button
              variant={
                transactionTarget?.action === "reject"
                  ? "destructive"
                  : "default"
              }
              onClick={() => {
                if (transactionTarget) {
                  void runTransactionAction(
                    transactionTarget.item.id,
                    transactionTarget.action,
                  );
                }
              }}
              disabled={isActionLoading}
            >
              {isActionLoading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {transactionTarget?.action === "approve"
                ? locale === "bn"
                  ? "অনুমোদন করুন"
                  : "Approve"
                : locale === "bn"
                  ? "বাতিল করুন"
                  : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {locale === "bn"
                ? "সদস্য হিসেবে অনুমোদন করবেন?"
                : "Admit this applicant?"}
            </DialogTitle>
            <DialogDescription>
              {approveTarget
                ? locale === "bn"
                  ? `${approveTarget.name} একটি গ্রাহক আই.ডি পাবেন এবং সদস্য হিসেবে সক্রিয় হবেন।`
                  : `${approveTarget.name} will be given an account number and activated as a member.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="approve-branch" className="text-sm">
              {locale === "bn" ? "শাখা" : "Office"}
            </Label>
            {activeBranches.length === 0 ? (
              <p className="text-xs text-gray-500">
                {locale === "bn"
                  ? "কোনো সক্রিয় শাখা নেই। সদস্য শাখা ছাড়াই অনুমোদিত হবেন; পরে সদস্যের পাতা থেকে নির্ধারণ করা যাবে।"
                  : "There are no active offices. The member will be admitted without one, and it can be set later from their page."}
              </p>
            ) : (
              <>
                <select
                  id="approve-branch"
                  value={approveBranchId}
                  onChange={(e) => setApproveBranchId(e.target.value)}
                  className="h-10 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm"
                >
                  <option value="">
                    {locale === "bn"
                      ? "নির্ধারণ করবেন না"
                      : "Do not assign yet"}
                  </option>
                  {activeBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.id})
                    </option>
                  ))}
                </select>
                <p className="flex items-start gap-1.5 text-xs text-gray-500">
                  <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {locale === "bn"
                    ? "শাখা অনুযায়ী রিপোর্ট এখান থেকেই আসে। পরে সদস্যের পাতা থেকে পরিবর্তন করা যাবে।"
                    : "Per-office reports are counted from this. It can be changed later from the member’s page."}
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveTarget(null)}
              disabled={isActionLoading}
            >
              {locale === "bn" ? "বাতিল" : "Cancel"}
            </Button>
            <Button
              onClick={() => void submitApproval()}
              disabled={isActionLoading}
            >
              {isActionLoading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {locale === "bn" ? "অনুমোদন করুন" : "Admit member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejecting is irreversible and emails the applicant: the dialog is the confirmation AND the reason. */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRejectDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {locale === "bn"
                ? "আবেদন বাতিল করবেন?"
                : "Reject this application?"}
            </DialogTitle>
            <DialogDescription>
              {locale === "bn"
                ? `${rejectTarget?.name ?? ""} — আবেদনকারীকে ইমেইলে কারণসহ জানানো হবে। তিনি চাইলে আবার আবেদন করতে পারবেন।`
                : `${rejectTarget?.name ?? ""} — the applicant is emailed with the reason, and may apply again.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">
                {locale === "bn" ? "কারণ" : "Reason"}
              </Label>
              {/* Native <select>: works one-thumbed on low-end Android; the server translates the reason. */}
              <select
                id="reject-reason"
                value={rejectCode}
                onChange={(e) => {
                  setRejectCode(e.target.value as RejectionReasonCode | "");
                  setRejectFieldError(null);
                }}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">
                  {locale === "bn" ? "কারণ নির্বাচন করুন…" : "Choose a reason…"}
                </option>
                {REJECTION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {
                      REJECTION_REASON_LABELS[code][
                        locale === "bn" ? "bn" : "en"
                      ]
                    }
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reject-note">
                {locale === "bn" ? "বিস্তারিত" : "Details"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {rejectCode === REJECTION_REASON_REQUIRING_NOTE
                    ? locale === "bn"
                      ? "(আবশ্যক)"
                      : "(required)"
                    : locale === "bn"
                      ? "(ঐচ্ছিক)"
                      : "(optional)"}
                </span>
              </Label>
              <Textarea
                id="reject-note"
                rows={3}
                maxLength={REJECTION_NOTE_MAX_LENGTH}
                value={rejectNote}
                onChange={(e) => {
                  setRejectNote(e.target.value);
                  setRejectFieldError(null);
                }}
                placeholder={
                  locale === "bn"
                    ? "যেমন: এন.আই.ডি-র পিছনের ছবিটি স্পষ্ট নয়।"
                    : "e.g. the back of the NID is not readable."
                }
              />
              <p className="text-xs text-muted-foreground">
                {locale === "bn"
                  ? "এটি আবেদনকারীকে পাঠানো ইমেইলে যুক্ত হবে।"
                  : "This is included in the email sent to the applicant."}
              </p>
            </div>

            {rejectFieldError && (
              <p role="alert" className="text-sm text-red-600">
                {rejectFieldError}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={closeRejectDialog}
              disabled={isActionLoading}
            >
              {locale === "bn" ? "বাতিল" : "Cancel"}
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void submitRejection()}
              disabled={isActionLoading}
            >
              {isActionLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {locale === "bn" ? "আবেদন বাতিল করুন" : "Reject application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
