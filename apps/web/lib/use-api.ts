'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import useSWR, { type SWRConfiguration } from 'swr';
import { apiGet } from '@/lib/api';
import { localePath } from '@/lib/locale-path';

/**
 * Data loading for dashboard screens — WO-27.
 *
 * ## Why this exists
 *
 * Every screen used to load with the same shape:
 *
 * ```tsx
 * const [items, setItems] = useState<T[]>([]);
 * const [isLoading, setIsLoading] = useState(true);
 * const refresh = async () => {
 *   setIsLoading(true);            // ← the finding
 *   try { setItems(await apiGet(path)); }
 *   finally { setIsLoading(false); }
 * };
 * useEffect(() => { void refresh(); }, []);
 * ```
 *
 * That is twenty `react-hooks/set-state-in-effect` findings across fifteen
 * screens, and none of them clears by rearranging the effect: the React
 * Compiler follows the call graph into the callee and cannot prove `apiGet`
 * will not throw *synchronously* into the `finally`. WO-27 measured that
 * attempt and recorded it as a dead end. The rule only goes quiet when the
 * effect body contains no reachable setState at all, which means the fetch has
 * to stop being an effect.
 *
 * SWR owns the request, the loading flag and the error. The component reads
 * them. There is no effect and no setState, so the compiler has nothing to bail
 * on — and with `experimental.reactCompiler` now on in next.config.js, that
 * matters at runtime rather than only in the lint output.
 *
 * ## What it deliberately does NOT do
 *
 * No polling and no revalidate-on-focus. These screens show money. A balance
 * that changes while somebody is reading it, with no action of theirs behind
 * it, is alarming rather than helpful — and the confirm-a-posting flows read a
 * figure, ask the member about it, and then act on it. Refresh is explicit:
 * call `refresh()` after a mutation.
 */

/** What every migrated screen consumes. */
export interface ApiResource<T> {
  data: T | undefined;
  /** A message ready to render, or null. SWR errors arrive as Error. */
  error: string | null;
  /** True only on the first load, so a refresh does not blank the screen. */
  isLoading: boolean;
  /** Re-fetch, e.g. after a mutation. Resolves when the new data is in. */
  refresh: () => Promise<void>;
}

const SHARED: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshInterval: 0,
  shouldRetryOnError: false,
};

/**
 * Fetch one endpoint.
 *
 * Pass `null` as the path to hold the request — the conditional-fetch idiom for
 * a screen that has to wait for an id or a session. A hook cannot be called
 * conditionally, so this is how "not yet" is expressed.
 */
export function useApi<T>(path: string | null, config?: SWRConfiguration): ApiResource<T> {
  const { data, error, isLoading, mutate } = useSWR<T, Error>(
    path,
    (key: string) => apiGet<T>(key),
    { ...SHARED, ...config },
  );

  return {
    data,
    error: error ? error.message : null,
    isLoading,
    refresh: async () => {
      await mutate();
    },
  };
}

/**
 * Fetch several endpoints as one resource, for screens that need two or three
 * calls before they can render anything.
 *
 * The key is the joined paths, so two screens asking for the same set share a
 * cache entry. `null` in the list holds the whole group, matching useApi.
 */
export function useApiAll<T extends unknown[]>(
  paths: (string | null)[],
  config?: SWRConfiguration,
): ApiResource<T> {
  const ready = paths.every((p) => p !== null);
  const key = ready ? paths.join('|') : null;

  const { data, error, isLoading, mutate } = useSWR<T, Error>(
    key,
    async (joined: string) => {
      const list = joined.split('|');
      return Promise.all(list.map((p) => apiGet<unknown>(p))) as Promise<T>;
    },
    { ...SHARED, ...config },
  );

  return {
    data,
    error: error ? error.message : null,
    isLoading,
    refresh: async () => {
      await mutate();
    },
  };
}

/**
 * Send the reader to the login page when the API says their session is gone.
 *
 * The screens used to check `localStorage` for a token before fetching and
 * redirect if it was missing. That covered exactly one of the two ways a
 * session ends — it said nothing about a token that is present and expired,
 * which is the far more common case and used to leave a member looking at an
 * error banner on an empty screen.
 *
 * Keying off the API's own 401 covers both, and costs one request when there is
 * no token at all.
 *
 * `router.replace` rather than `push`: a dead session is not somewhere the back
 * button should return to. This is an effect, but it writes no state, so it is
 * not the shape WO-27 exists to remove.
 */
export function useRedirectOnUnauthorized(error: string | null): void {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    if (error === 'Unauthorized') {
      router.replace(localePath(locale, '/login'));
    }
  }, [error, locale, router]);
}

/**
 * An editable form seeded from server data, without an effect copying one into
 * the other.
 *
 * The settings screen is the awkward case for WO-27: it is not just displaying
 * what it fetched, it is *editing* it. The old shape fetched in an effect and
 * called five setters to seed five pieces of form state — the exact pattern the
 * rule exists to flag, and one SWR alone does not remove.
 *
 * So the server value stays derived, and only the reader's edits are state. The
 * returned setter has the same signature `useState` gives, so call sites do not
 * change:
 *
 * ```tsx
 * const [org, setOrg, resetOrg] = useDraft(serverOrg);
 * setOrg((prev) => ({ ...prev, name }));   // unchanged
 * ```
 *
 * Once anything is edited the draft wins outright, and a later refetch will not
 * overwrite it — losing somebody's half-typed address because a background
 * revalidation landed is worse than showing a slightly stale baseline. Call
 * `reset` after a successful save to hand control back to the server value.
 */
export function useDraft<T>(serverValue: T): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [draft, setDraft] = useState<T | null>(null);

  const setValue = useCallback((update: SetStateAction<T>) => {
    setDraft((previous) => {
      const current = previous ?? serverValue;
      return typeof update === 'function' ? (update as (p: T) => T)(current) : update;
    });
  }, [serverValue]);

  const reset = useCallback(() => setDraft(null), []);

  return [draft ?? serverValue, setValue, reset];
}
