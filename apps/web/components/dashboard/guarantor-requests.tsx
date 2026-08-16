'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { getAccessToken } from '@/lib/api';

/**
 * The guarantor's half of FR-11.
 *
 * The endpoint behind this has existed and worked since WO-29; until 2026-08-17
 * nothing in the app called it, so a nominated guarantor had no way to accept or
 * decline and every application sat in PENDING_GUARANTOR forever.
 */

export interface GuarantorRequestItem {
  id: string;
  borrowerName: string;
  loanAmount: number;
  requestDate: string;
}

interface Props {
  requests: GuarantorRequestItem[];
  onResolved: () => void | Promise<void>;
}

export function GuarantorRequests({ requests, onResolved }: Props) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (requests.length === 0) return null;

  const respond = async (loanId: string, accepted: boolean) => {
    setBusyId(loanId);
    setError(null);
    setSuccess(null);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/v1/loans/${encodeURIComponent(loanId)}/guarantor-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ accepted }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? 'Request failed');
      }
      setSuccess(accepted ? t('guarantorAccepted') : t('guarantorDeclined'));
      await onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  return (
    <section className="border border-amber-200 bg-white dark:border-amber-900/50 dark:bg-card">
      <header className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
        <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <h2 className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {t('guarantorRequestsTitle')}
        </h2>
      </header>

      <div className="space-y-3 px-4 py-3">
        {/* Stated before the buttons, not after: accepting puts this member's own
            savings behind someone else's debt, and the default waterfall will
            take them. */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>{t('guarantorRequestsIntro')}</span>
        </p>

        {error && (
          <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            {success}
          </p>
        )}

        <ul className="space-y-3">
          {requests.map((request) => (
            <li key={request.id} className="border border-border p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('guarantorRequestBorrower')}</dt>
                <dd className="text-right font-medium">{request.borrowerName}</dd>

                <dt className="text-muted-foreground">{t('guarantorRequestAmount')}</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatCurrency(request.loanAmount, locale)}
                </dd>

                <dt className="text-muted-foreground">{t('guarantorRequestDate')}</dt>
                <dd className="text-right">{formatDate(request.requestDate)}</dd>
              </dl>

              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => respond(request.id, true)}
                  disabled={busyId !== null}
                >
                  {busyId === request.id ? t('guarantorSubmitting') : t('guarantorAccept')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => respond(request.id, false)}
                  disabled={busyId !== null}
                >
                  {t('guarantorDecline')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
