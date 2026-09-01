'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useLocale, useTranslations } from 'next-intl';
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_RETENTION_DAYS,
  auditActionSpec,
  type AuditCategory,
  type AuditSeverity,
} from '@/lib/audit-actions';

/**
 * The audit trail as a screen.
 *
 * ---
 *
 * **What an admin is actually doing here.** Not browsing. They arrive with a
 * question — "who processed Rahim's withdrawal on Tuesday", "why is this member
 * suspended", "did anyone touch this before the balance went wrong" — and the
 * screen is good exactly to the degree that it answers one of those in a few
 * seconds. That shapes every decision below:
 *
 * - **A timeline, grouped by day.** The question is almost always anchored in
 *   time, and a flat table of ISO timestamps makes the reader do the grouping.
 * - **Colour carries importance, not category.** A rose rail means *somebody
 *   should be able to explain this*: an erasure, a default, a lockout, a
 *   dispute. Tinting by category instead would make a routine deposit as loud as
 *   a member being erased, which is how colour-coded screens stop being read.
 * - **Routine sign-ins are hidden until asked for.** They are the majority of
 *   rows and almost never the answer. Hiding them is a real editorial decision
 *   and it is reversible in one click, with the control visible rather than
 *   buried in a menu — a filter the reader cannot see is a screen that is
 *   lying about what it contains.
 * - **The subject is spelled out.** `entityId` is a cuid; the API resolves it to
 *   `Rahim Uddin (ACC-KH-33001)`. An audit trail whose rows have to be looked up
 *   elsewhere is one nobody opens twice.
 *
 * **Phone first** (rule 10). Most staff reach this on a 412 px Android screen,
 * so the timeline is a single column of cards at every width and the filters
 * collapse behind one button; the desktop view is the same cards with more room.
 * There is no horizontal table to scroll, in either language — Bengali labels are
 * the wider ones and a table would have overflowed on them first.
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
const SEVERITY_STYLES: Record<AuditSeverity, { rail: string; dot: string; chip: string }> = {
  critical: {
    rail: 'bg-rose-500',
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  notable: {
    rail: 'bg-amber-400',
    dot: 'bg-amber-400',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  routine: {
    rail: 'bg-slate-300',
    dot: 'bg-slate-300',
    chip: 'bg-slate-50 text-slate-600 border-slate-200',
  },
};

/** Category is the quiet channel: the icon chip only. */
const CATEGORY_TINTS: Record<AuditCategory, string> = {
  money: 'bg-emerald-50 text-emerald-700',
  lending: 'bg-blue-50 text-blue-700',
  membership: 'bg-violet-50 text-violet-700',
  staff: 'bg-cyan-50 text-cyan-700',
  security: 'bg-orange-50 text-orange-700',
  data: 'bg-rose-50 text-rose-700',
  system: 'bg-slate-100 text-slate-600',
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
  pagination: { page: number; limit: number; hasMore: boolean };
}

const CATEGORIES = Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[];
const SEVERITIES: AuditSeverity[] = ['critical', 'notable', 'routine'];
/**
 * How many entries the screen asks for at a time.
 *
 * Twenty, and more only when the reader asks. The trail grows for ever — it is
 * append-only by construction (DATA-08) and most of it is kept permanently — so
 * "how many entries are there" is a question whose answer only gets larger and
 * whose only use was the word "of" in a caption. What an admin opening this
 * screen wants is the last few things that happened, on a phone, over a
 * connection in Jessore.
 */
const PAGE_SIZE = 20;

async function fetchAudit(url: string): Promise<AuditResponse> {
  // Same-origin Next route, so a plain fetch rather than `useApi`, which
  // resolves against the Go API base. The token is attached the way every other
  // Next-route caller in the dashboard attaches it.
  const token = typeof window !== 'undefined' ? localStorage.getItem('hn_access_token') : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const payload = (await res.json().catch(() => null)) as AuditResponse | null;
  if (!res.ok || !payload?.ok) throw new Error('load-failed');
  return payload;
}

/** `2026-08-27` — the grouping key, in the reader's own timezone. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AuditScreen() {
  const locale = useLocale();
  const t = useTranslations('dashboard.audit');
  const isBn = locale === 'bn';

  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [severity, setSeverity] = useState<AuditSeverity | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeNoise, setIncludeNoise] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const urlForPage = useMemo(() => {
    return (pageNumber: number) => {
      const params = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_SIZE) });
      if (query) params.set('q', query);
      if (category !== 'all') params.set('category', category);
      if (severity !== 'all') params.set('severity', severity);
      if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
      // Inclusive of the whole end day. A reader picking the same date for both
      // means "that day", not "the first instant of it".
      if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
      if (includeNoise) params.set('includeNoise', 'true');
      return `/api/v1/admin/audit-logs?${params.toString()}`;
    };
  }, [query, category, severity, from, to, includeNoise]);

  /**
   * One page at a time, replaced — the owner's decision, 2026-09-02.
   *
   * This was `useSWRInfinite`, appending each page to the ones already read, on
   * the reasoning that an admin reading down a timeline does not want the part
   * they have read to disappear. What that costs is that the screen only grows:
   * by the fourth press it is holding eighty rows, re-grouping all of them by
   * day on every keystroke in the search box, and a reader who wanted something
   * from last week had to keep loading until it appeared.
   *
   * Numbered pages fetch exactly one page and drop the last, so the work is
   * constant however deep somebody goes.
   *
   * There is still **no `COUNT(*)`**, so there is no "of 12" — that was a full
   * scan of every matching row per keystroke, against a database that bills for
   * being awake (ADR-035), to render two words. `hasMore` comes from asking for
   * one row more than fits, which is what Next actually needs to know.
   *
   * `keepPreviousData` is what stops the list blanking to a spinner and back on
   * every press; the page that is leaving stays on screen until its replacement
   * has arrived.
   */
  const [page, setPage] = useState(1);

  const { data, error, isLoading, isValidating, mutate } = useSWR<AuditResponse, Error>(
    urlForPage(page),
    fetchAudit,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: true,
    },
  );

  // Memoised, not a fresh literal every render: the grouping below would then
  // re-run on every keystroke in the search box.
  const rows = useMemo(() => data?.data ?? [], [data]);
  const hasMore = data?.pagination.hasMore ?? false;
  // True while a *different* page is in flight, so the buttons disable without
  // the rows underneath them vanishing.
  const isPaging = isValidating && !isLoading;

  /** Back to the first page whenever the filter set changes. Without this,
   *  changing a filter would keep however many pages were open and quietly ask
   *  for that many again. */
  const applyFilter = <T,>(setter: (value: T) => void) => (value: T) => {
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

  // One reading of the clock per render, and "yesterday" derived by calendar
  // rather than by subtracting 86,400,000 milliseconds — the arithmetic version
  // is wrong on any day that is not 24 hours long, and it is also the impure
  // call the React Compiler refuses during render.
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = dayKey(yesterdayDate.toISOString());

  const dayLabel = (key: string) => {
    const today = todayKey;
    const yesterday = yesterdayKey;
    if (key === today) return t('today');
    if (key === yesterday) return t('yesterday');
    return new Date(`${key}T00:00:00`).toLocaleDateString(isBn ? 'bn-BD' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(isBn ? 'bn-BD' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const retentionLabel = (action: string) => {
    const spec = auditActionSpec(action);
    if (spec.retention === 'permanent') return t('retentionPermanent');
    return t(spec.retention === 'long' ? 'retentionLong' : 'retentionShort', {
      days: AUDIT_RETENTION_DAYS[spec.retention],
    });
  };

  const hasFilters =
    Boolean(query) || category !== 'all' || severity !== 'all' || Boolean(from) || Boolean(to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('refresh')}
        </button>
      </div>

      {/* Append-only is a property worth stating on the screen, not only in the
          schema: it is the reason this list can be trusted at all, and an admin
          who does not know it has no reason to prefer it to their memory. */}
      <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('appendOnly')}
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
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t('search')}
        </button>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            hasFilters
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('filters')}
        </button>
      </form>

      {filtersOpen && (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyFilter(setCategory)('all')}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                category === 'all'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t('allCategories')}
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
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {isBn ? AUDIT_CATEGORY_LABELS[name].bn : AUDIT_CATEGORY_LABELS[name].en}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              {t('severity')}
              <select
                value={severity}
                onChange={(e) => applyFilter(setSeverity)(e.target.value as AuditSeverity | 'all')}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              >
                <option value="all">{t('allSeverities')}</option>
                {SEVERITIES.map((name) => (
                  <option key={name} value={name}>
                    {t(name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('from')}
              <input
                type="date"
                value={from}
                onChange={(e) => applyFilter(setFrom)(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('to')}
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
              {t('showRoutine')}
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setQuery('');
                  setCategory('all');
                  setSeverity('all');
                  setFrom('');
                  setTo('');
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {t('clear')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('loadFailed')}
        </p>
      )}

      {isLoading && !data && <p className="py-8 text-center text-sm text-slate-500">{t('loading')}</p>}

      {!isLoading && rows.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">{t('noResults')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('noResultsHint')}</p>
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
                  : t('system');

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
                          {/* The time is its own column, not the last item of a
                              wrapping row. As one it dropped onto a line of its
                              own whenever the label was long — which in Bengali
                              is most of them, since "অতি গুরুত্বপূর্ণ" is three
                              times the width of "CRITICAL". */}
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
                            <p className="mt-0.5 text-xs text-slate-500">{row.details}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-400">
                            {t('by')} {actorName}
                            {row.actor?.accountNo ? ` · ${row.actor.accountNo}` : ''}
                          </p>

                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : row.id)}
                            aria-expanded={isOpen}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                            {isOpen ? t('hideDetails') : t('details')}
                          </button>

                          {isOpen && (
                            <dl className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-2.5 text-xs">
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">{t('record')}</dt>
                                <dd className="min-w-0 break-all font-mono text-slate-700">
                                  {row.entityType} · {row.entityId}
                                </dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">{t('ipAddress')}</dt>
                                <dd className="font-mono text-slate-700">
                                  {row.userIp || '—'}
                                </dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0 text-slate-500">{t('retention')}</dt>
                                <dd className="text-slate-700">{retentionLabel(row.action)}</dd>
                              </div>
                              {row.oldValue != null && (
                                <div>
                                  <dt className="text-slate-500">{t('before')}</dt>
                                  <dd className="mt-0.5 overflow-x-auto">
                                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">
                                      {JSON.stringify(row.oldValue, null, 2)}
                                    </pre>
                                  </dd>
                                </div>
                              )}
                              {row.newValue != null && (
                                <div>
                                  <dt className="text-slate-500">{t('after')}</dt>
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
            {/* No total: counting every matching row to render "of 12" is a
                full scan per keystroke against a database that bills for being
                awake (ADR-035). The page number and whether there is another
                are what the controls actually need. */}
            {t('pageNumber', { page })} · {t('shown', { count: rows.length })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 1 || isPaging}
              onClick={() => {
                setPage((n) => Math.max(1, n - 1));
                setExpanded(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {t('previousPage')}
            </button>
            <button
              type="button"
              disabled={!hasMore || isPaging}
              onClick={() => {
                setPage((n) => n + 1);
                setExpanded(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              {t('nextPage')}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
