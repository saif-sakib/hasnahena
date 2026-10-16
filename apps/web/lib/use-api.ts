'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import useSWR, { type SWRConfiguration } from 'swr';
import { apiGet } from '@/lib/api';
import { localePath } from '@/lib/locale-path';

/**
 * Data loading for dashboard screens via SWR (WO-27): no effect and no
 * setState, which is what clears react-hooks/set-state-in-effect under the
 * React Compiler. Deliberately no polling or revalidate-on-focus — these
 * screens show money; call `refresh()` after a mutation.
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

/** Fetch one endpoint; a null path holds the request (conditional fetch). */
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

/** Fetch several endpoints as one resource; a null in the list holds the group. */
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
 * Redirect to login on the API's 401 — covers a missing AND an expired token.
 * `replace`, so back does not return to a dead session.
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
 * An editable form seeded from server data without an effect: the server value
 * stays derived and only edits are state. Once edited the draft wins over
 * refetches; call `reset` after saving.
 *
 *   const [org, setOrg, resetOrg] = useDraft(serverOrg);
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
