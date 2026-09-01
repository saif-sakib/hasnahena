"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  HandCoins,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useApi } from "@/lib/use-api";
import { useDashboardRole } from "@/components/dashboard/role";
import { localePath } from "@/lib/locale-path";

/**
 * The staff overview — one screen for both dashboards.
 *
 * It carries no navigation of its own. It used to duplicate the sidebar as a
 * grid of "Action Center" cards below `lg`, on the reasoning that the sidebar is
 * a drawer on a phone — but the drawer is one tap behind the hamburger in
 * `dashboard-layout.tsx`, so the cards were a second copy of the same list
 * pushing the numbers below the fold. The queue banner above stays: it is not a
 * link list, it is the one thing a member of staff needs to know on arrival.
 *
 * The numbers differ by role because the endpoints do. `/dashboard/admin` is the
 * whole foundation; `/dashboard/worker` is what this worker did today. Both are
 * read through the same normaliser so the tiles below do not care which arrived.
 */

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  alert?: boolean;
}

// Module scope, not the component body: declared inside, React saw a new
// component *type* on every render and remounted all four cards whenever any
// state changed, throwing away the transitions mid-flight.
const StatCard = ({
  title,
  value,
  subValue,
  icon: Icon,
  trend = "neutral",
  alert = false,
}: StatCardProps) => (
  <div className="flex flex-col p-5 bg-white border border-neutral-200/60 rounded-2xl hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-300">
    <div className="flex items-center justify-between mb-4">
      <span className="text-[13px] font-medium text-neutral-500 tracking-wide">
        {title}
      </span>
      <div
        className={`p-2.5 rounded-xl ${alert ? "bg-red-500/10 text-red-600" : "bg-neutral-100 text-neutral-700"}`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} />
      </div>
    </div>
    <h3 className="text-2xl font-bold text-neutral-900 tracking-tight">
      {value}
    </h3>
    {subValue ? (
      <span
        className={`mt-2 inline-flex w-fit items-center rounded-md px-2.5 py-1 text-[12px] font-semibold ${
          trend === "up"
            ? "bg-emerald-500/10 text-emerald-700"
            : trend === "down"
              ? "bg-red-500/10 text-red-700"
              : "bg-neutral-100 text-neutral-700"
        }`}
      >
        {subValue}
      </span>
    ) : null}
  </div>
);

interface ActivityItem {
  id: number | string;
  action: string;
  user: string;
  time: string;
}

interface AdminPayload {
  stats?: {
    totalMembers?: number;
    totalWorkers?: number;
    totalDeposits?: number;
    totalLoans?: number;
    activeLoanCount?: number;
    defaultedLoans?: number;
    charityFund?: number;
    monthlyGrowth?: number;
  };
  recentActivity?: ActivityItem[];
}

interface WorkerPayload {
  stats?: {
    totalMembers?: number;
    todayDeposits?: number;
    todayWithdrawals?: number;
    todayLoans?: number;
  };
}

interface ApprovalsSummary {
  registrationRequests?: Array<{ id: string }>;
  transactionRequests?: Array<{ type?: string }>;
}

export default function OverviewScreen() {
  const locale = useLocale();
  const role = useDashboardRole();
  const isAdmin = role === "admin";
  const basePath = localePath(locale, `/dashboard/${role}`);

  // WO-27 — SWR, not an effect. See lib/use-api.ts.
  const { data: dashboardData, isLoading } = useApi<
    AdminPayload & WorkerPayload
  >(isAdmin ? "/v1/dashboard/admin" : "/v1/dashboard/worker");
  const { data: approvals } = useApi<ApprovalsSummary>(
    "/v1/dashboard/admin/approvals",
  );

  const stats = dashboardData?.stats ?? {};
  const recentActivity = dashboardData?.recentActivity ?? [];

  // A worker's response carries no registrations — AdminApprovals leaves them
  // out for them — so this counts what the caller can actually act on.
  const pendingCount = useMemo(
    () =>
      (approvals?.registrationRequests?.length ?? 0) +
      (approvals?.transactionRequests?.length ?? 0),
    [approvals],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-7 pb-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {isAdmin
            ? locale === "bn"
              ? "অ্যাডমিন কমান্ড সেন্টার"
              : "Admin Command Center"
            : locale === "bn"
              ? "কর্মী ড্যাশবোর্ড"
              : "Worker Dashboard"}
        </h1>
        <p className="text-sm text-neutral-500">
          {isAdmin
            ? locale === "bn"
              ? "মূল কাজগুলো দ্রুত সম্পন্ন করার জন্য সাজানো ড্যাশবোর্ড"
              : "A streamlined dashboard to complete core tasks quickly"
            : locale === "bn"
              ? "আজকের সারসংক্ষেপ"
              : "Today's summary"}
        </p>
      </div>

      {/* Approval queue banner */}
      <div
        className={`rounded-2xl border px-5 py-4 ${pendingCount > 0 ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/70"}`}
      >
        <div className="flex items-start gap-3">
          {pendingCount > 0 ? (
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
          ) : (
            <ClipboardList className="mt-0.5 h-5 w-5 text-emerald-700" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-neutral-900">
              {pendingCount > 0
                ? locale === "bn"
                  ? "অপেক্ষমাণ কাজ রয়েছে"
                  : "You have pending items"
                : locale === "bn"
                  ? "অনুমোদন কিউ আপডেট আছে"
                  : "Approval queue is up to date"}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {locale === "bn"
                ? `${pendingCount} টি অপেক্ষমাণ অনুরোধ`
                : `${pendingCount} pending requests`}
            </p>
          </div>
          <Link
            href={`${basePath}/approvals`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {locale === "bn" ? "এখন দেখুন" : "Open Queue"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Numbers */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {isAdmin
            ? locale === "bn"
              ? "মূল সূচক"
              : "Operational Snapshot"
            : locale === "bn"
              ? "আজকের হিসাব"
              : "Today's Numbers"}
        </h2>

        {isAdmin ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title={locale === "bn" ? "মোট সদস্য" : "Total Members"}
                value={isLoading ? "..." : (stats.totalMembers ?? 0)}
                subValue={`+${(stats.monthlyGrowth ?? 0).toFixed(1)}% ${locale === "bn" ? "এই মাসে" : "this month"}`}
                icon={Users}
                trend="up"
              />
              <StatCard
                title={locale === "bn" ? "মোট আমানত" : "Total Deposits"}
                value={
                  isLoading
                    ? "..."
                    : formatCurrency(stats.totalDeposits ?? 0, locale)
                }
                icon={Wallet}
              />
              <StatCard
                title={locale === "bn" ? "ঋণ বিতরণ" : "Loans Disbursed"}
                value={
                  isLoading
                    ? "..."
                    : formatCurrency(stats.totalLoans ?? 0, locale)
                }
                subValue={`${stats.activeLoanCount ?? 0} ${locale === "bn" ? "সক্রিয় ঋণ" : "active loans"}`}
                icon={HandCoins}
              />
              <StatCard
                title={locale === "bn" ? "ঝুঁকিপূর্ণ ঋণ" : "At Risk Loans"}
                value={isLoading ? "..." : (stats.defaultedLoans ?? 0)}
                icon={AlertTriangle}
                alert={(stats.defaultedLoans ?? 0) > 0}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {locale === "bn" ? "কর্মী" : "Workers"}
                </p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {isLoading ? "..." : (stats.totalWorkers ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {locale === "bn" ? "দান তহবিল" : "Charity Fund"}
                </p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {isLoading
                    ? "..."
                    : formatCurrency(stats.charityFund ?? 0, locale)}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {locale === "bn" ? "মাসিক বৃদ্ধি" : "Monthly Growth"}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xl font-semibold text-emerald-700">
                  <TrendingUp className="h-4 w-4" />
                  {isLoading
                    ? "..."
                    : `${(stats.monthlyGrowth ?? 0).toFixed(1)}%`}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title={locale === "bn" ? "মোট সদস্য" : "Total Members"}
              value={isLoading ? "..." : (stats.totalMembers ?? 0)}
              icon={Users}
            />
            <StatCard
              title={locale === "bn" ? "আজকের জমা" : "Today's Deposits"}
              value={
                isLoading
                  ? "..."
                  : formatCurrency(stats.todayDeposits ?? 0, locale)
              }
              icon={Wallet}
            />
            <StatCard
              title={locale === "bn" ? "আজকের উত্তোলন" : "Today's Withdrawals"}
              value={
                isLoading
                  ? "..."
                  : formatCurrency(stats.todayWithdrawals ?? 0, locale)
              }
              icon={Wallet}
            />
            <StatCard
              title={locale === "bn" ? "আজকের ঋণ" : "Today's Loans"}
              value={
                isLoading
                  ? "..."
                  : formatCurrency(stats.todayLoans ?? 0, locale)
              }
              icon={HandCoins}
            />
          </div>
        )}
      </div>

      {/* **Not the audit trail** — see `dashboard/admin/audit` for that.
          This is a `UNION` over `users`, `loans` and `transactions` that
          *reconstructs* the last few events from current state, so it can only
          show things that left a row behind: never a sign-in, a password reset,
          a member erasure, a branch closure, a lockout or a ledger drift. It is
          a summary on the way past, and the link at the bottom goes to the
          record. Admin only, because it is the whole foundation's activity. */}
      {isAdmin && (
        <div className="bg-white border border-neutral-200/60 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-100/80">
            <h2 className="text-[15px] font-semibold text-neutral-900 tracking-wide">
              {locale === "bn" ? "সাম্প্রতিক কার্যক্রম" : "Recent Activity"}
            </h2>
          </div>
          <div className="divide-y divide-neutral-100/60">
            {isLoading ? (
              <div className="px-6 py-9 text-center text-sm font-medium text-neutral-400">
                {locale === "bn" ? "লোড হচ্ছে..." : "Loading..."}
              </div>
            ) : recentActivity.length > 0 ? (
              recentActivity.slice(0, 8).map((activity) => (
                <div
                  key={activity.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-neutral-50/50 transition-colors"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-neutral-900">
                      {activity.action}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {activity.user}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-500 bg-neutral-100 px-2.5 py-1 rounded-md">
                    {new Date(activity.time).toLocaleDateString(
                      locale === "bn" ? "bn-BD" : "en-BD",
                      {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-6 py-10 text-center text-sm font-medium text-neutral-400">
                {locale === "bn"
                  ? "কোনো সাম্প্রতিক কার্যক্রম নেই"
                  : "No recent activity"}
              </div>
            )}
          </div>
          {/* The way from the summary to the record. Without it the audit log is
              a sidebar entry an admin has to already know exists, and this card
              looks like the whole story. */}
          <Link
            href={`${basePath}/audit`}
            className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-100/80 text-sm font-medium text-neutral-600 hover:bg-neutral-50/50 transition-colors"
          >
            {locale === "bn"
              ? "সম্পূর্ণ নিরীক্ষা লগ দেখুন"
              : "Open the full audit log"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
