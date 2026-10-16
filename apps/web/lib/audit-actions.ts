/**
 * Every action either backend writes into `audit_logs`, in one catalogue
 * (audit-actions.test.ts checks both backends against it). Per action:
 *   category  timeline group and filter chip
 *   severity  "would this need explaining?" — not "did money move"
 *   retention how long the row is kept (ADR-038)
 *   noise     hidden by default on the screen; NOT the same as short retention
 */

export type AuditCategory =
  | 'money'
  | 'lending'
  | 'membership'
  | 'staff'
  | 'security'
  | 'data'
  | 'system';

/** critical: irreversible or where an investigation starts · notable: a decision affecting someone · routine. */
export type AuditSeverity = 'critical' | 'notable' | 'routine';

/**
 * permanent: the ledger and every decision about a person · long: security
 * history · short: operational noise (ADR-038).
 */
export type AuditRetention = 'permanent' | 'long' | 'short';

export interface AuditActionSpec {
  category: AuditCategory;
  severity: AuditSeverity;
  retention: AuditRetention;
  /** Hidden from the timeline unless the reader asks for it. */
  noise?: boolean;
  en: string;
  bn: string;
}

export const AUDIT_ACTIONS = {
  // ---- Money that moved ---------------------------------------------------
  // All permanent: who moved somebody else's savings.
  DEPOSIT_POSTED: {
    category: 'money', severity: 'notable', retention: 'permanent',
    en: 'Deposit posted', bn: 'জমা করা হয়েছে',
  },
  WITHDRAWAL_POSTED: {
    category: 'money', severity: 'notable', retention: 'permanent',
    en: 'Withdrawal paid', bn: 'উত্তোলন পরিশোধ',
  },
  DONATION_RECORDED: {
    category: 'money', severity: 'notable', retention: 'permanent',
    en: 'Donation recorded', bn: 'দান লিপিবদ্ধ',
  },
  APPROVE_TRANSACTION: {
    category: 'money', severity: 'notable', retention: 'permanent',
    en: 'Request approved', bn: 'অনুরোধ অনুমোদিত',
  },
  REJECT_TRANSACTION: {
    category: 'money', severity: 'notable', retention: 'permanent',
    en: 'Request rejected', bn: 'অনুরোধ প্রত্যাখ্যাত',
  },
  TRANSACTION_DISPUTED: {
    category: 'money', severity: 'critical', retention: 'permanent',
    en: 'Posting disputed by member', bn: 'সদস্য কর্তৃক আপত্তি',
  },

  // ---- Lending ------------------------------------------------------------
  APPROVE_LOAN: {
    category: 'lending', severity: 'notable', retention: 'permanent',
    en: 'Loan approved', bn: 'ঋণ অনুমোদিত',
  },
  REJECT_LOAN: {
    category: 'lending', severity: 'notable', retention: 'permanent',
    en: 'Loan rejected', bn: 'ঋণ প্রত্যাখ্যাত',
  },
  LOAN_DISBURSED: {
    category: 'lending', severity: 'notable', retention: 'permanent',
    en: 'Loan disbursed', bn: 'ঋণ বিতরণ',
  },
  LOAN_TOPPED_UP: {
    category: 'lending', severity: 'notable', retention: 'permanent',
    en: 'Loan topped up', bn: 'ঋণ বৃদ্ধি',
  },
  LOAN_REPAYMENT_POSTED: {
    category: 'lending', severity: 'routine', retention: 'permanent',
    en: 'Instalment posted', bn: 'কিস্তি জমা',
  },
  MARK_LOAN_DEFAULTED: {
    category: 'lending', severity: 'critical', retention: 'permanent',
    en: 'Loan marked defaulted', bn: 'ঋণ খেলাপি ঘোষণা',
  },
  WATERFALL_RECOVERY: {
    // Takes a guarantor's savings.
    category: 'lending', severity: 'critical', retention: 'permanent',
    en: 'Default recovered from savings', bn: 'সঞ্চয় থেকে ঋণ আদায়',
  },

  // ---- Membership ---------------------------------------------------------
  APPROVE_REGISTRATION: {
    category: 'membership', severity: 'notable', retention: 'permanent',
    en: 'Application approved', bn: 'আবেদন অনুমোদিত',
  },
  REJECT_REGISTRATION: {
    category: 'membership', severity: 'notable', retention: 'permanent',
    en: 'Application rejected', bn: 'আবেদন প্রত্যাখ্যাত',
  },
  USER_STATUS_CHANGED: {
    category: 'membership', severity: 'critical', retention: 'permanent',
    en: 'Account status changed', bn: 'অ্যাকাউন্টের অবস্থা পরিবর্তন',
  },
  PROFILE_UPDATED: {
    category: 'membership', severity: 'routine', retention: 'long',
    en: 'Profile updated', bn: 'প্রোফাইল হালনাগাদ',
  },

  // ---- Staff --------------------------------------------------------------
  WORKER_CREATED: {
    category: 'staff', severity: 'critical', retention: 'permanent',
    en: 'Field worker created', bn: 'মাঠকর্মী তৈরি',
  },
  WORKER_UPDATED: {
    category: 'staff', severity: 'critical', retention: 'permanent',
    en: 'Field worker changed', bn: 'মাঠকর্মী পরিবর্তন',
  },
  BRANCH_CREATED: {
    category: 'staff', severity: 'notable', retention: 'permanent',
    en: 'Branch created', bn: 'শাখা তৈরি',
  },
  BRANCH_UPDATED: {
    category: 'staff', severity: 'notable', retention: 'permanent',
    en: 'Branch updated', bn: 'শাখা হালনাগাদ',
  },
  BRANCH_DEACTIVATED: {
    category: 'staff', severity: 'notable', retention: 'permanent',
    en: 'Branch closed', bn: 'শাখা বন্ধ',
  },
  BRANCH_DELETED: {
    category: 'staff', severity: 'critical', retention: 'permanent',
    en: 'Branch deleted', bn: 'শাখা মুছে ফেলা',
  },

  // ---- Security -----------------------------------------------------------
  LOGIN: {
    category: 'security', severity: 'routine', retention: 'short', noise: true,
    en: 'Signed in', bn: 'সাইন ইন',
  },
  LOGOUT: {
    category: 'security', severity: 'routine', retention: 'short', noise: true,
    en: 'Signed out', bn: 'সাইন আউট',
  },
  LOGIN_LOCKOUT_ESCALATED: {
    // Someone is guessing a password; valuable in hindsight.
    category: 'security', severity: 'critical', retention: 'long',
    en: 'Repeated failed sign-ins — account locked', bn: 'বারবার ব্যর্থ লগইন — অ্যাকাউন্ট লক',
  },
  PASSWORD_CHANGE: {
    category: 'security', severity: 'notable', retention: 'long',
    en: 'Password changed', bn: 'পাসওয়ার্ড পরিবর্তন',
  },
  PASSWORD_CHANGE_CODE_SENT: {
    category: 'security', severity: 'routine', retention: 'short', noise: true,
    en: 'Password change code sent', bn: 'পাসওয়ার্ড পরিবর্তনের কোড পাঠানো',
  },
  PASSWORD_RESET: {
    category: 'security', severity: 'critical', retention: 'long',
    en: 'Password reset', bn: 'পাসওয়ার্ড রিসেট',
  },
  PASSWORD_RESET_REQUESTED: {
    category: 'security', severity: 'routine', retention: 'short', noise: true,
    en: 'Password reset requested', bn: 'পাসওয়ার্ড রিসেটের অনুরোধ',
  },
  PASSWORD_RESET_REQUESTED_UNKNOWN: {
    // A reset for a non-member — many means enumeration (ADR-032).
    category: 'security', severity: 'notable', retention: 'short', noise: true,
    en: 'Reset requested for an unknown identifier', bn: 'অজানা পরিচয়ে রিসেটের অনুরোধ',
  },

  // ---- Data erasure -------------------------------------------------------
  // Permanent: the proof that data was destroyed.

  MEMBER_ERASED: {
    category: 'data', severity: 'critical', retention: 'permanent',
    en: 'Member erased', bn: 'সদস্য মুছে ফেলা',
  },
  APPLICATION_DOCUMENTS_ERASED: {
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Application documents erased', bn: 'আবেদনের কাগজপত্র মুছে ফেলা',
  },
  AUDIT_LOG_EXPIRED: {
    // The audit sweep's own record; permanent.
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Expired audit entries removed', bn: 'মেয়াদোত্তীর্ণ নিরীক্ষা এন্ট্রি মুছে ফেলা',
  },
  RETENTION_SWEEP: {
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Retention sweep cleared an application', bn: 'রক্ষণ নীতিতে আবেদন পরিষ্কার',
  },

  // ---- System -------------------------------------------------------------
  LEDGER_DRIFT_DETECTED: {
    // Ledger drift; never auto-repaired (ADR-027).
    category: 'system', severity: 'critical', retention: 'permanent',
    en: 'Ledger drift detected', bn: 'হিসাবের গরমিল শনাক্ত',
  },
  SCHEMA_IDS_MIGRATED: {
    // Written only by migration 20260901120000_ids_are_the_numbers, which
    // suspended the append-only trigger once (ADR-044).
    category: 'system', severity: 'critical', retention: 'permanent',
    en: 'Database identifiers migrated', bn: 'ডাটাবেস আইডি রূপান্তরিত',
  },
} as const satisfies Record<string, AuditActionSpec>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: string): value is AuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value);
}

/** Spec for an action, including an uncatalogued one (rendered plainly under `system`). */
export function auditActionSpec(action: string): AuditActionSpec {
  if (isAuditAction(action)) return AUDIT_ACTIONS[action];
  const words = action.toLowerCase().replace(/_/g, ' ');
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return {
    category: 'system',
    severity: 'routine',
    retention: 'long',
    en: label,
    bn: label,
  };
}

export function auditActionLabel(action: string, locale: string): string {
  const spec = auditActionSpec(action);
  return locale === 'bn' ? spec.bn : spec.en;
}

/** The action names in one category — the filter chips render from this. */
export function actionsInCategory(category: AuditCategory): AuditAction[] {
  return AUDIT_ACTION_NAMES.filter((name) => AUDIT_ACTIONS[name].category === category);
}

/** Actions the timeline hides by default. */
export const NOISE_ACTIONS: AuditAction[] = AUDIT_ACTION_NAMES.filter(
  (name) => 'noise' in AUDIT_ACTIONS[name] && (AUDIT_ACTIONS[name] as AuditActionSpec).noise === true,
);

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, { en: string; bn: string }> = {
  money: { en: 'Money', bn: 'অর্থ' },
  lending: { en: 'Lending', bn: 'ঋণ' },
  membership: { en: 'Membership', bn: 'সদস্যপদ' },
  staff: { en: 'Staff & branches', bn: 'কর্মী ও শাখা' },
  security: { en: 'Security', bn: 'নিরাপত্তা' },
  data: { en: 'Data erasure', bn: 'তথ্য মুছে ফেলা' },
  system: { en: 'System', bn: 'সিস্টেম' },
};

/** Re-exported from lib/retention-policy.ts, which /privacy also reads. */
export { AUDIT_RETENTION_DAYS } from './retention-policy';
