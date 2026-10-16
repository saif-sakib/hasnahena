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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { DashboardRole } from "./role";

/**
 * The one description of what each dashboard contains; the sidebar renders it.
 * `roles` is presentation only — the API decides (role.tsx).
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
  group: "primary" | "management";
}

const STAFF: readonly DashboardRole[] = ["worker", "admin"];
const ADMIN_ONLY: readonly DashboardRole[] = ["admin"];
const MEMBER_ONLY: readonly DashboardRole[] = ["member"];

export const DASHBOARD_NAV: readonly DashboardNavItem[] = [
  // ---- Member -------------------------------------------------------------
  {
    name: "overview",
    href: "",
    icon: LayoutDashboard,
    en: "Overview",
    bn: "সারসংক্ষেপ",
    roles: MEMBER_ONLY,
    group: "primary",
  },
  {
    name: "member-deposits",
    href: "/deposits",
    icon: Wallet,
    en: "Deposit History",
    bn: "আমানতের ইতিহাস",
    roles: MEMBER_ONLY,
    group: "primary",
  },
  {
    name: "member-loans",
    href: "/loans",
    icon: HandCoins,
    en: "Loan Status",
    bn: "ঋণের স্থিতি",
    roles: MEMBER_ONLY,
    group: "primary",
  },
  {
    name: "member-transactions",
    href: "/transactions",
    icon: Receipt,
    en: "Transactions",
    bn: "লেনদেন",
    roles: MEMBER_ONLY,
    group: "primary",
  },

  // ---- Staff: daily operations -------------------------------------------
  {
    name: "staff-overview",
    href: "",
    icon: LayoutDashboard,
    en: "Overview",
    bn: "সারসংক্ষেপ",
    roles: STAFF,
    group: "primary",
  },
  {
    name: "approvals",
    href: "/approvals",
    icon: ClipboardList,
    en: "Approvals",
    bn: "অনুমোদন",
    roles: STAFF,
    group: "primary",
  },
  {
    name: "members",
    href: "/members",
    icon: Users,
    en: "Members",
    bn: "সদস্যগণ",
    roles: STAFF,
    group: "primary",
  },
  {
    name: "deposits",
    href: "/deposits",
    icon: Wallet,
    en: "Deposits & Withdrawals",
    bn: "জমা ও উত্তোলন",
    roles: STAFF,
    group: "primary",
  },
  {
    name: "loans",
    href: "/loans",
    icon: HandCoins,
    en: "Loans",
    bn: "ঋণ",
    roles: STAFF,
    group: "primary",
  },
  {
    name: "transactions",
    href: "/transactions",
    icon: Receipt,
    en: "Transactions",
    bn: "লেনদেন",
    roles: STAFF,
    group: "primary",
  },

  // ---- Staff: management tools -------------------------------------------
  {
    name: "reports",
    href: "/reports",
    icon: FileText,
    en: "Reports",
    bn: "রিপোর্ট",
    roles: STAFF,
    group: "management",
  },
  {
    name: "content",
    href: "/content",
    icon: ImageIcon,
    en: "Content & Media",
    bn: "কনটেন্ট ও মিডিয়া",
    roles: STAFF,
    group: "management",
  },
  {
    name: "donations",
    href: "/donations",
    icon: PieChart,
    en: "Donations",
    bn: "দান তহবিল",
    roles: ADMIN_ONLY,
    group: "management",
  },
  {
    name: "workers",
    href: "/workers",
    icon: UserPlus,
    en: "Workers",
    bn: "কর্মীগণ",
    roles: ADMIN_ONLY,
    group: "management",
  },
  {
    name: "branches",
    href: "/branches",
    icon: Building2,
    en: "Branches",
    bn: "শাখাসমূহ",
    roles: ADMIN_ONLY,
    group: "management",
  },
  {
    // Last in the management group, beside Settings: it is the screen an admin
    // goes to when something has already happened, not one they work from.
    name: "audit",
    href: "/audit",
    icon: ScrollText,
    en: "Audit Log",
    bn: "নিরীক্ষা লগ",
    roles: ADMIN_ONLY,
    group: "management",
  },
  {
    name: "settings",
    href: "/settings",
    icon: Settings,
    en: "Settings",
    bn: "সেটিংস",
    roles: ADMIN_ONLY,
    group: "management",
  },
] as const;

export function navFor(
  role: DashboardRole,
  group?: DashboardNavItem["group"],
): DashboardNavItem[] {
  return DASHBOARD_NAV.filter(
    (item) =>
      item.roles.includes(role) &&
      (group === undefined || item.group === group),
  );
}

/** Whether a screen is reachable at all in this dashboard. */
export function navItemVisible(role: DashboardRole, name: string): boolean {
  return DASHBOARD_NAV.some(
    (item) => item.name === name && item.roles.includes(role),
  );
}
