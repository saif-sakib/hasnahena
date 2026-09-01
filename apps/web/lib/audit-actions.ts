/**
 * Every action either backend writes into `audit_logs`, in one catalogue.
 *
 * ---
 *
 * **Why a catalogue rather than a union of strings.** `audit.ts` used to carry a
 * hand-written `AuditAction` union, and it had drifted so far that it described a
 * different system: it listed `REGISTRATION_APPROVED`, `LOAN_APPROVED`,
 * `DEPOSIT_CONFIRMED`, `WITHDRAWAL_APPROVED` and `SETTINGS_UPDATED`, **none of
 * which anything writes**, while every one of the twenty-two actions the Go API
 * actually writes was missing. It compiled, because the only thing it constrained
 * was the ten call sites in this app.
 *
 * That is tolerable while nothing reads the table. The moment a screen does, a
 * missing entry is a row rendered as a raw `MARK_LOAN_DEFAULTED` in a list an
 * admin is meant to be able to scan, and a wrong entry is worse: a colour and a
 * severity attached to something that never happens.
 * `apps/web/test/unit/audit-actions.test.ts` reads both backends for audit
 * writes and fails on anything not catalogued here, in either direction.
 *
 * **Three things are declared per action and each is load-bearing:**
 *
 * - `category` groups the timeline and drives the filter chips.
 * - `severity` is the colour, and it answers *"would this need explaining?"* —
 *   not *"did it involve money"*. A deposit is `routine` and a member erasure is
 *   `critical` even though only one of them moves taka.
 * - `retention` is how long the row is kept ([ADR-038](../../docs/decisions.md)).
 *   It is here, beside the action, rather than in the sweep that applies it,
 *   because the question "may this be deleted" is a property of what happened.
 *
 * **`noise: true`** marks the actions that are true, useful, and would drown the
 * screen: a member logging in is worth having and is not worth being the top
 * twenty rows. The screen hides these unless asked. It is *not* a synonym for
 * short retention — `LOGIN_LOCKOUT_ESCALATED` is noise on a good day and the
 * first thing anybody looks at on a bad one.
 */

export type AuditCategory =
  | 'money'
  | 'lending'
  | 'membership'
  | 'staff'
  | 'security'
  | 'data'
  | 'system';

/**
 * How loudly a row is drawn.
 *
 * `critical`  irreversible, or the thing an investigation starts from.
 * `notable`   a decision somebody made that another person is affected by.
 * `routine`   the platform working normally.
 */
export type AuditSeverity = 'critical' | 'notable' | 'routine';

/**
 * How long the row is kept. See ADR-038 for why these three and not a number
 * per action.
 *
 * `permanent`  the ledger and every decision about a person. Never deleted.
 * `long`       security history — kept long enough to investigate an incident
 *              nobody noticed at the time.
 * `short`      operational noise, useful for days and a liability for years.
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
  // Every one of these is permanent without exception: the row is the record of
  // who moved somebody else's savings, and the hourly reconciliation
  // (ADR-027) is only interpretable next to it.
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
    // Takes a guarantor's savings. There is no more consequential thing this
    // platform does to somebody who did not borrow.
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
    // Somebody is guessing a password. Kept long: the value of this row is
    // almost entirely in being able to look back at it after the fact.
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
    // A reset asked for on an identifier that is not a member. One is a typo;
    // a hundred is somebody testing which addresses belong to members, which is
    // the exact question ADR-032 exists to refuse to answer.
    category: 'security', severity: 'notable', retention: 'short', noise: true,
    en: 'Reset requested for an unknown identifier', bn: 'অজানা পরিচয়ে রিসেটের অনুরোধ',
  },

  // ---- Data erasure -------------------------------------------------------
  // Permanent without exception, and the reason is circular in the right way:
  // these rows are the proof that data was destroyed, so a policy that expired
  // them would destroy the evidence of its own compliance.

  MEMBER_ERASED: {
    category: 'data', severity: 'critical', retention: 'permanent',
    en: 'Member erased', bn: 'সদস্য মুছে ফেলা',
  },
  APPLICATION_DOCUMENTS_ERASED: {
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Application documents erased', bn: 'আবেদনের কাগজপত্র মুছে ফেলা',
  },
  AUDIT_LOG_EXPIRED: {
    // The sweep deleting expired audit rows leaves one row saying it did.
    // Permanent, like every other erasure record: a retention policy whose own
    // trail expires cannot be shown to have been followed.
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Expired audit entries removed', bn: 'মেয়াদোত্তীর্ণ নিরীক্ষা এন্ট্রি মুছে ফেলা',
  },
  RETENTION_SWEEP: {
    category: 'data', severity: 'notable', retention: 'permanent',
    en: 'Retention sweep cleared an application', bn: 'রক্ষণ নীতিতে আবেদন পরিষ্কার',
  },

  // ---- System -------------------------------------------------------------
  LEDGER_DRIFT_DETECTED: {
    // The stored balances disagree with the sum of the postings. Never repaired
    // automatically (ADR-027); this row is where a human starts.
    category: 'system', severity: 'critical', retention: 'permanent',
    en: 'Ledger drift detected', bn: 'হিসাবের গরমিল শনাক্ত',
  },
  SCHEMA_IDS_MIGRATED: {
    // Written by a **migration**, not by either backend — the only action that
    // is. `20260901120000_ids_are_the_numbers` suspended the append-only trigger
    // for one statement block to make `entityId` readable (ADR-044), and this
    // row is the trail's own record that it happened. Permanent, and critical
    // for the same reason: it is the evidence for the one exception ever made to
    // the guarantee this table exists to give.
    category: 'system', severity: 'critical', retention: 'permanent',
    en: 'Database identifiers migrated', bn: 'ডাটাবেস আইডি রূপান্তরিত',
  },
} as const satisfies Record<string, AuditActionSpec>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: string): value is AuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value);
}

/**
 * What to show for an action, including one this build has never heard of.
 *
 * A row written by a newer deploy, or by a branch, must render as itself rather
 * than vanish or crash the list. `SOMETHING_NEW` becomes "Something new" in the
 * `system` group — visible, unstyled, and obviously uncatalogued.
 */
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

/**
 * How long a `short` and a `long` row live.
 *
 * Defined in `lib/retention-policy.ts` and re-exported here, so a reader of this
 * catalogue still finds it beside the tiers it applies to. The definition lives
 * over there because `/privacy` quotes these two numbers, and a public marketing
 * page should not import the admin dashboard's vocabulary to read them.
 */
export { AUDIT_RETENTION_DAYS } from './retention-policy';
