"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { pageWindow } from "@/lib/pagination";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_RETENTION_DAYS,
  auditActionSpec,
  type AuditCategory,
  type AuditSeverity,
} from "@/lib/audit-actions";

/**
 * The audit trail as a screen, built to answer a specific question fast: a
 * timeline grouped by day; colour carries importance (severity), not category;
 * routine sign-ins hidden behind a visible toggle; subjects spelled out. Phone
 * first — one column of cards at every width, filters behind one button.
 */

const CATEGORY_ICONS: Record<AuditCategory, LucideIcon> = {
  money: Wallet,
  lending: HandCoins,
  membership: UserPlus,
  staff: Users,
  security: ShieldAlert,
  data: Trash2,
  system: Activity,
};

/** Severity is the loud channel: rail, dot and border. */
const SEVERITY_STYLES: Record<
  AuditSeverity,
  { rail: string; dot: string; chip: string }
> = {
  critical: {
    rail: "bg-rose-500",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
  },
  notable: {
    rail: "bg-amber-400",
    dot: "bg-amber-400",
    chip: "bg-amber-50 text-amber-800 border-amber-200",
  },
  routine: {
    rail: "bg-slate-300",
    dot: "bg-slate-300",
    chip: "bg-slate-50 text-slate-600 border-slate-200",
  },
};

/** Category is the quiet channel: the icon chip only. */
const CATEGORY_TINTS: Record<AuditCategory, string> = {
  money: "bg-emerald-50 text-emerald-700",
  lending: "bg-blue-50 text-blue-700",
  membership: "bg-violet-50 text-violet-700",
  staff: "bg-cyan-50 text-cyan-700",
  security: "bg-orange-50 text-orange-700",
  data: "bg-rose-50 text-rose-700",
  system: "bg-slate-100 text-slate-600",
};

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  oldValue: unknown;
  newValue: unknown;
  userIp: string | null;
  createdAt: string;
  actor: {
    id: string;
    nameEn: string;
    nameBn: string | null;
    role: string;
    accountNo: string | null;
  } | null;
  subject: { label: string; kind: string } | null;
}

interface AuditResponse {
  ok: boolean;
  data: AuditRow[];
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
    /** Pages the route could see. A floor, not a fact, when `countCapped`. */
    totalPages: number;
    /** The count stopped at its ceiling, so `totalPages` is "at least". */
    countCapped: boolean;
  };
}

const CATEGORIES = Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[];
const SEVERITIES: AuditSeverity[] = ["critical", "notable", "routine"];
/** Entries per page; the trail only grows. */
const PAGE_SIZE = 20;

async function fetchAudit(url: string): Promise<AuditResponse> {
  // Same-origin Next route: plain fetch with the token, not useApi.
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hn_access_token")
      : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const payload = (await res.json().catch(() => null)) as AuditResponse | null;
  if (!res.ok || !payload?.ok) throw new Error("load-failed");
  return payload;
}

/** `2026-08-27` — the grouping key, in the reader's own timezone. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AuditScreen() {
  const locale = useLocale();
  const t = useTranslations("dashboard.audit");
  const isBn = locale === "bn";

  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [severity, setSeverity] = useState<AuditSeverity | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeNoise, setIncludeNoise] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const urlForPage = useMemo(() => {
    return (pageNumber: number) => {
      const params = new URLSearchParams({
        page: String(pageNumber),
        limit: String(PAGE_SIZE),
      });
      if (query) params.set("q", query);
      if (category !== "all") params.set("category", category);
      if (severity !== "all") params.set("severity", severity);
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      // Inclusive of the whole end day. A reader picking the same date for both
      // means "that day", not "the first instant of it".
      if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      if (includeNoise) params.set("includeNoise", "true");
      return `/api/v1/admin/audit-logs?${params.toString()}`;
    };
  }, [query, category, severity, from, to, includeNoise]);

  /**
   * Numbered pages, one at a time (owner's decision) — constant work at any
   * depth. The total is a bounded count. keepPreviousData avoids a blank flash.
   */
  const [page, setPage] = useState(1);

  /** Every page move goes through here, so an open row never survives one. */
  const goToPage = (next: number) => {
    setPage(Math.max(1, next));
    setExpanded(null);
  };

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    AuditResponse,
    Error
  >(urlForPage(page), fetchAudit, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  });

  // Memoised, not a fresh literal every render: the grouping below would then
  // re-run on every keystroke in the search box.
  const rows = useMemo(() => data?.data ?? [], [data]);
  const hasMore = data?.pagination.hasMore ?? false;
  const totalPages = data?.pagination.totalPages ?? 1;
  const countCapped = data?.pagination.countCapped ?? false;
  // True while a *different* page is in flight, so the buttons disable without
  // the rows underneath them vanishing.
  const isPaging = isValidating && !isLoading;

  /** Back to page 1 whenever the filters change. */
  const applyFilter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
      setExpanded(null);
    };

  const grouped = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    for (const row of rows) {
      const key = dayKey(row.createdAt);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [rows]);

  // One clock read per render; "yesterday" by calendar, not 86,400,000 ms.
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = dayKey(yesterdayDate.toISOString());

  const dayLabel = (key: string) => {
    const today = todayKey;
    const yesterday = yesterdayKey;
    if (key === today) return t("today");
    if (key === yesterday) return t("yesterday");
    return new Date(`${key}T00:00:00`).toLocaleDateString(
      isBn ? "bn-BD" : "en-GB",
      {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  };

  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(isBn ? "bn-BD" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const retentionLabel = (action: string) => {
    const spec = auditActionSpec(action);
    if (spec.retention === "permanent") return t("retentionPermanent");
    return t(spec.retention === "long" ? "retentionLong" : "retentionShort", {
      days: AUDIT_RETENTION_DAYS[spec.retention],
    });
  };

  const hasFilters =
    Boolean(query) ||
    category !== "all" ||
    severity !== "all" ||
    Boolean(from) ||
    Boolean(to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("refresh")}
        </button>
      </div>

      {/* Append-only is why this list can be trusted — say so on screen. */}
      <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("appendOnly")}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(searchInput.trim());
          setPage(1);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t("search")}
        </button>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            hasFilters
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          {t("filters")}
        </button>
      </form>

      {filtersOpen && (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyFilter(setCategory)("all")}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                category === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t("allCategories")}
            </button>
            {CATEGORIES.map((name) => {
              const Icon = CATEGORY_ICONS[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => applyFilter(setCategory)(name)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    category === name
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {isBn
                    ? AUDIT_CATEGORY_LABELS[name].bn
                    : AUDIT_CATEGORY_LABELS[name].en}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              {t("severity")}
              <select
                value={severity}
                onChange={(e) =>
                  applyFilter(setSeverity)(
                    e.target.value as AuditSeverity | "all",
                  )
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              >
                <option value="all">{t("allSeverities")}</option>
                {SEVERITIES.map((name) => (
                  <option key={name} value={name}>
                    {t(name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("from")}
              <input
                type="date"
                value={from}
                onChange={(e) => applyFilter(setFrom)(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("to")}
              <input
                type="date"
                value={to}
                onChange={(e) => applyFilter(setTo)(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includeNoise}
                onChange={(e) => applyFilter(setIncludeNoise)(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t("showRoutine")}
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  setCategory("all");
                  setSeverity("all");
                  setFrom("");
                  setTo("");
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {t("clear")}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("loadFailed")}
        </p>
      )}

      {isLoading && !data && (
        <p className="py-8 text-center text-sm text-slate-500">
          {t("loading")}
        </p>
      )}

      {!isLoading && rows.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">{t("noResults")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("noResultsHint")}</p>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([day, dayRows]) => (
          <section key={day}>
            <h2 className="sticky top-0 z-10 -mx-1 bg-white/90 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
              {dayLabel(day)}
            </h2>
            <ol className="mt-2 space-y-2">
              {dayRows.map((row) => {
                const spec = auditActionSpec(row.action);
                const styles = SEVERITY_STYLES[spec.severity];
                const Icon = CATEGORY_ICONS[spec.category];
                const isOpen = expanded === row.id;
                const actorName = row.actor
                  ? (isBn && row.actor.nameBn) || row.actor.nameEn
                  : t("system");

                return (
                  <li
                    key={row.id}
                    className="relative overflow-hidden rounded-md border border-slate-200 bg-white"
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-1 ${styles.rail}`}
                    />
                    <div className="py-3 pl-4 pr-3">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${CATEGORY_TINTS[spec.category]}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          {/* Time in its own column, so long (Bengali) labels do not push it to a new line. */}
                          <div className="flex items-start gap-2">
                            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="font-medium text-slate-900">
                                {isBn ? spec.bn : spec.en}
                              </span>
                              <span
                                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles.chip}`}
                              >
                                {t(spec.severity)}
                              </span>
                            </div>
                            <time
                              dateTime={row.createdAt}
                              className="shrink-0 pt-0.5 font-mono text-xs text-slate-400"
                            >
                              {timeLabel(row.createdAt)}
                            </time>
                          </div>

                          {row.subject && (
                            <p className="mt-0.5 truncate text-sm text-slate-700">
                              {row.subject.label}
                            </p>
                          )}
                          {row.details && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {row.details}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-slate-400">
                            {t("by")} {actorName}
                            {row.actor?.accountNo
                              ? ` · ${row.actor.accountNo}`
                              : ""}
                          </p>

                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : row.id)}
                            aria-expanded={isOpen}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                            {isOpen ? t("hideDetails") : t("details")}
                          </button>

                          {isOpen && (
                            <dl className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-2.5 text-xs">
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">
                                  {t("record")}
                                </dt>
                                <dd className="min-w-0 break-all font-mono text-slate-700">
                                  {row.entityType} · {row.entityId}
                                </dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">
                                  {t("ipAddress")}
                                </dt>
                                <dd className="font-mono text-slate-700">
                                  {row.userIp || "—"}
                                </dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">
                                  {t("retention")}
                                </dt>
                                <dd className="text-slate-700">
                                  {retentionLabel(row.action)}
                                </dd>
                              </div>
                              {row.oldValue != null && (
                                <div>
                                  <dt className="text-slate-500">
                                    {t("before")}
                                  </dt>
                                  <dd className="mt-0.5 overflow-x-auto">
                                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">
                                      {JSON.stringify(row.oldValue, null, 2)}
                                    </pre>
                                  </dd>
                                </div>
                              )}
                              {row.newValue != null && (
                                <div>
                                  <dt className="text-slate-500">
                                    {t("after")}
                                  </dt>
                                  <dd className="mt-0.5 overflow-x-auto">
                                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">
                                      {JSON.stringify(row.newValue, null, 2)}
                                    </pre>
                                  </dd>
                                </div>
                              )}
                            </dl>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {(rows.length > 0 || page > 1) && (
        <div className="flex flex-col items-center gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:justify-between">
          <p className="text-xs text-slate-500">
            {/* Bounded count; the controls only need the page and whether there is another. */}
            {t("pageNumber", { page })} · {t("shown", { count: rows.length })}
          </p>
          {/* Numbered pages; pageWindow keeps the control a constant width. */}
          <nav className="flex items-center gap-1" aria-label={t("pagination")}>
            <button
              type="button"
              disabled={page === 1 || isPaging}
              onClick={() => goToPage(page - 1)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              aria-label={t("previousPage")}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>

            {pageWindow(page, totalPages).map((token, index) =>
              token === "gap" ? (
                <span
                  key={`gap-${index}`}
                  aria-hidden
                  className="px-1 text-xs text-slate-400 select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={token}
                  type="button"
                  disabled={isPaging}
                  onClick={() => goToPage(token)}
                  aria-current={token === page ? "page" : undefined}
                  aria-label={t("pageNumber", { page: token })}
                  className={`min-w-8 rounded-md border px-2 py-2 text-xs font-medium tabular-nums disabled:opacity-40 ${
                    token === page
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {token}
                </button>
              ),
            )}

            {/* The count stopped at its ceiling, so there are more pages than
                the numbers show and Next is still the way to reach them. */}
            {countCapped ? (
              <span
                className="px-1 text-xs text-slate-400 select-none"
                aria-hidden
              >
                +
              </span>
            ) : null}

            <button
              type="button"
              disabled={!hasMore || isPaging}
              onClick={() => goToPage(page + 1)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              aria-label={t("nextPage")}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
