import {
  Building2,
  ClipboardList,
  FileText,
  ScrollText,
  HandCoins,
  Image as ImageIcon,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { DashboardRole } from './role';

/**
 * The one description of what each dashboard contains.
 *
 * The sidebar renders it, and the overview screen builds its action cards from
 * it, so a screen that exists for a role is linked from both places or from
 * neither. Before this there were four hand-maintained lists — two nav arrays
 * and two grids of `<Link>` cards — and they had already diverged: the worker
 * overview linked to five screens, the worker sidebar listed six, and neither
 * mentioned the two management tools a worker is supposed to have.
 *
 * `roles` is presentation only. See the note in role.tsx: the API decides.
 */
export interface DashboardNavItem {
  /** Stable key, and the suffix of the route under `/dashboard/{role}`. */
  name: string;
  /** Appended to the dashboard base path. `''` is the overview itself. */
  href: string;
  icon: LucideIcon;
  en: string;
  bn: string;
  /** Which dashboards show it. */
  roles: readonly DashboardRole[];
  /** Sidebar grouping. Staff dashboards render the two groups separately. */
  group: 'primary' | 'management';
  /** One line under the title on the overview's action cards. */
  blurbEn?: string;
  blurbBn?: string;
}

const STAFF: readonly DashboardRole[] = ['worker', 'admin'];
const ADMIN_ONLY: readonly DashboardRole[] = ['admin'];
const MEMBER_ONLY: readonly DashboardRole[] = ['member'];

export const DASHBOARD_NAV: readonly DashboardNavItem[] = [
  // ---- Member -------------------------------------------------------------
  {
    name: 'overview',
    href: '',
    icon: LayoutDashboard,
    en: 'Overview',
    bn: 'সারসংক্ষেপ',
    roles: MEMBER_ONLY,
    group: 'primary',
  },
  {
    name: 'member-deposits',
    href: '/deposits',
    icon: Wallet,
    en: 'Deposit History',
    bn: 'আমানতের ইতিহাস',
    roles: MEMBER_ONLY,
    group: 'primary',
  },
  {
    name: 'member-loans',
    href: '/loans',
    icon: HandCoins,
    en: 'Loan Status',
    bn: 'ঋণের স্থিতি',
    roles: MEMBER_ONLY,
    group: 'primary',
  },
  {
    name: 'member-transactions',
    href: '/transactions',
    icon: Receipt,
    en: 'Transactions',
    bn: 'লেনদেন',
    roles: MEMBER_ONLY,
    group: 'primary',
  },

  // ---- Staff: daily operations -------------------------------------------
  {
    name: 'staff-overview',
    href: '',
    icon: LayoutDashboard,
    en: 'Overview',
    bn: 'সারসংক্ষেপ',
    roles: STAFF,
    group: 'primary',
  },
  {
    name: 'approvals',
    href: '/approvals',
    icon: ClipboardList,
    en: 'Approvals',
    bn: 'অনুমোদন',
    roles: STAFF,
    group: 'primary',
    blurbEn: 'Registrations, deposits and repayment requests',
    blurbBn: 'নিবন্ধন, ডিপোজিট ও ঋণ পরিশোধ অনুরোধ',
  },
  {
    name: 'members',
    href: '/members',
    icon: Users,
    en: 'Members',
    bn: 'সদস্যগণ',
    roles: STAFF,
    group: 'primary',
    blurbEn: 'Profiles, status and lookup',
    blurbBn: 'প্রোফাইল, স্ট্যাটাস ও খোঁজ',
  },
  {
    name: 'deposits',
    href: '/deposits',
    icon: Wallet,
    en: 'Deposits & Withdrawals',
    bn: 'জমা ও উত্তোলন',
    roles: STAFF,
    group: 'primary',
    blurbEn: 'Record and review cash movements',
    blurbBn: 'নগদ লেনদেন রেকর্ড ও যাচাই',
  },
  {
    name: 'loans',
    href: '/loans',
    icon: HandCoins,
    en: 'Loans',
    bn: 'ঋণ',
    roles: STAFF,
    group: 'primary',
    blurbEn: 'Track instalments and collect repayments',
    blurbBn: 'কিস্তি ট্র্যাক ও পরিশোধ সংগ্রহ',
  },
  {
    name: 'transactions',
    href: '/transactions',
    icon: Receipt,
    en: 'Transactions',
    bn: 'লেনদেন',
    roles: STAFF,
    group: 'primary',
    blurbEn: 'Every posting, filterable by type and date',
    blurbBn: 'সব লেনদেন, ধরন ও তারিখ অনুযায়ী',
  },

  // ---- Staff: management tools -------------------------------------------
  {
    name: 'reports',
    href: '/reports',
    icon: FileText,
    en: 'Reports',
    bn: 'রিপোর্ট',
    roles: STAFF,
    group: 'management',
    blurbEn: 'Monthly, yearly and loan performance',
    blurbBn: 'মাসিক, বার্ষিক ও ঋণ কর্মক্ষমতা',
  },
  {
    name: 'content',
    href: '/content',
    icon: ImageIcon,
    en: 'Content & Media',
    bn: 'কনটেন্ট ও মিডিয়া',
    roles: STAFF,
    group: 'management',
    blurbEn: 'Gallery posts, public page copy and brand images',
    blurbBn: 'গ্যালারি, পাবলিক পেজের লেখা ও ব্র্যান্ড ছবি',
  },
  {
    name: 'donations',
    href: '/donations',
    icon: PieChart,
    en: 'Donations',
    bn: 'দান তহবিল',
    roles: ADMIN_ONLY,
    group: 'management',
    blurbEn: 'Record and review the charity fund',
    blurbBn: 'দান তহবিল রেকর্ড ও যাচাই',
  },
  {
    name: 'workers',
    href: '/workers',
    icon: UserPlus,
    en: 'Workers',
    bn: 'কর্মীগণ',
    roles: ADMIN_ONLY,
    group: 'management',
    blurbEn: 'Field worker accounts and branch assignment',
    blurbBn: 'মাঠকর্মীর অ্যাকাউন্ট ও শাখা বরাদ্দ',
  },
  {
    name: 'branches',
    href: '/branches',
    icon: Building2,
    en: 'Branches',
    bn: 'শাখাসমূহ',
    roles: ADMIN_ONLY,
    group: 'management',
    blurbEn: 'Offices members and workers are assigned to',
    blurbBn: 'সদস্য ও কর্মীদের নির্ধারিত অফিস',
  },
  {
    // Last in the management group, beside Settings: it is the screen an admin
    // goes to when something has already happened, not one they work from.
    name: 'audit',
    href: '/audit',
    icon: ScrollText,
    en: 'Audit Log',
    bn: 'নিরীক্ষা লগ',
    roles: ADMIN_ONLY,
    group: 'management',
    blurbEn: 'Who did what, when — kept permanently',
    blurbBn: 'কে কখন কী করেছেন — স্থায়ীভাবে সংরক্ষিত',
  },
  {
    name: 'settings',
    href: '/settings',
    icon: Settings,
    en: 'Settings',
    bn: 'সেটিংস',
    roles: ADMIN_ONLY,
    group: 'management',
    blurbEn: 'Organisation, loan policy, payment channels',
    blurbBn: 'প্রতিষ্ঠান, ঋণ নীতি, পেমেন্ট চ্যানেল',
  },
] as const;

export function navFor(role: DashboardRole, group?: DashboardNavItem['group']): DashboardNavItem[] {
  return DASHBOARD_NAV.filter(
    (item) => item.roles.includes(role) && (group === undefined || item.group === group),
  );
}

/** Whether a screen is reachable at all in this dashboard. */
export function navItemVisible(role: DashboardRole, name: string): boolean {
  return DASHBOARD_NAV.some((item) => item.name === name && item.roles.includes(role));
}
