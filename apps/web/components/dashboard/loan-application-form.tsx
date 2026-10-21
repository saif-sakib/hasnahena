'use client';

import { useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { HandCoins, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, parseWholeTaka } from '@/lib/utils';
import { getAccessToken } from '@/lib/api';

/**
 * A member's own loan application (FR-10). Mirrors the server: a guarantor only
 * above loan.guarantorThresholdAmount, nominated by account number and confirmed
 * by name (members cannot browse each other, SEC-13).
 */

interface Props {
  maxLoanAmount: number;
  maxInstallmentMonths: number;
  guarantorThreshold: number;
  onSubmitted: (hadGuarantor: boolean) => void | Promise<void>;
  onCancel: () => void;
}

interface ConfirmedGuarantor {
  id: string;
  accountNo: string;
  name: string;
}

export function LoanApplicationForm({
  maxLoanAmount,
  maxInstallmentMonths,
  guarantorThreshold,
  onSubmitted,
  onCancel,
}: Props) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState('12');
  const [purpose, setPurpose] = useState('');
  const [guarantorIdInput, setGuarantorIdInput] = useState('');
  const [guarantor, setGuarantor] = useState<ConfirmedGuarantor | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Whole taka or nothing (rule 1): a fraction is refused, never rounded.
  const amountValue = parseWholeTaka(amount) ?? 0;
  const hasAmount = amountValue > 0;
  const installmentCount = Number.parseInt(installments, 10);
  const hasInstallments = Number.isFinite(installmentCount) && installmentCount > 0;

  // Mirrors the server check, live as the member types.
  const guarantorRequired = hasAmount && amountValue > guarantorThreshold;

  const estimatedInstallment =
    hasAmount && hasInstallments ? Math.floor(amountValue / installmentCount) : null;

  const lookupGuarantor = async () => {
    const candidate = guarantorIdInput.trim().toUpperCase();
    if (!candidate) return;

    setLookupBusy(true);
    setLookupError(null);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/v1/members/lookup?accountNo=${encodeURIComponent(candidate)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => null);

      if (res.status === 429) {
        setLookupError(t('applyGuarantorRateLimited'));
        return;
      }
      if (!res.ok || !payload?.ok) {
        setLookupError(t('applyGuarantorNotFound'));
        return;
      }

      const name = locale === 'bn' ? (payload.data.nameBn || payload.data.nameEn) : payload.data.nameEn;
      setGuarantor({ id: payload.data.id, accountNo: payload.data.accountNo, name });
    } catch {
      setLookupError(t('applyGuarantorNotFound'));
    } finally {
      setLookupBusy(false);
    }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    setError(null);

    if (!hasAmount) return setError(t('applyErrorAmount'));
    if (amountValue > maxLoanAmount) {
      return setError(t('applyErrorMax', { max: formatCurrency(maxLoanAmount, locale) }));
    }
    if (!hasInstallments || installmentCount > maxInstallmentMonths) {
      return setError(t('applyErrorInstallments', { max: maxInstallmentMonths }));
    }
    if (purpose.trim().length < 3) return setError(t('applyErrorPurpose'));
    if (guarantorRequired && !guarantor) return setError(t('applyErrorGuarantor'));

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/v1/loans/applications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount: amountValue,
          installments: installmentCount,
          purpose: purpose.trim(),
          // Omitted entirely below the threshold — the server treats absent and
          // "not required" as the same thing.
          ...(guarantor ? { guarantorId: guarantor.id } : {}),
        }),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.ok) {
        const code = payload?.error;
        if (code === 'DUPLICATE_LOAN_APPLICATION') return setError(t('applyErrorDuplicate'));
        if (code === 'GUARANTOR_REQUIRED') return setError(t('applyErrorGuarantor'));
        if (code === 'GUARANTOR_HAS_NO_SAVINGS') return setError(t('applyGuarantorNoSavings'));
        if (code === 'GUARANTOR_IS_SELF') return setError(t('applyGuarantorSelf'));
        if (code === 'LOAN_ELIGIBILITY_FAILED') {
          return setError(t('applyErrorMax', { max: formatCurrency(maxLoanAmount, locale) }));
        }
        if (code === 'INSTALLMENT_LIMIT_EXCEEDED') {
          return setError(t('applyErrorInstallments', { max: maxInstallmentMonths }));
        }
        return setError(typeof code === 'string' ? code : 'Request failed');
      }

      await onSubmitted(Boolean(guarantor));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
        <HandCoins className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-medium">{t('applyTitle')}</h2>
      </header>

      <div className="space-y-4 px-4 py-4">
        <p className="text-xs text-muted-foreground">{t('applyIntro')}</p>

        {error && (
          <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="loan-amount">{t('applyAmount')}</Label>
          <Input
            id="loan-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxLoanAmount}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t('applyErrorMax', { max: formatCurrency(maxLoanAmount, locale) })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="loan-installments">{t('applyInstallments')}</Label>
          <Input
            id="loan-installments"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxInstallmentMonths}
            value={installments}
            onChange={(e) => setInstallments(e.target.value)}
          />
          {estimatedInstallment !== null && (
            <p className="text-xs text-muted-foreground">
              {t('applyEstimate')}: <span className="tabular-nums font-medium text-foreground">
                {formatCurrency(estimatedInstallment, locale)}
              </span>
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="loan-purpose">{t('applyPurpose')}</Label>
          <Textarea
            id="loan-purpose"
            rows={3}
            value={purpose}
            placeholder={t('applyPurposePlaceholder')}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="loan-guarantor">{t('applyGuarantor')}</Label>

          {!guarantorRequired && hasAmount && (
            <p className="text-xs text-muted-foreground">{t('applyGuarantorNotNeeded')}</p>
          )}

          {guarantorRequired && !guarantor && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('applyGuarantorRequired', {
                  threshold: formatCurrency(guarantorThreshold, locale),
                })}
              </p>
              <div className="flex gap-2">
                <Input
                  id="loan-guarantor"
                  value={guarantorIdInput}
                  placeholder="ACC-KH-33001"
                  onChange={(e) => setGuarantorIdInput(e.target.value)}
                  aria-describedby="loan-guarantor-hint"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={lookupGuarantor}
                  disabled={lookupBusy || !guarantorIdInput.trim()}
                >
                  {lookupBusy ? t('applyGuarantorChecking') : t('applyGuarantorCheck')}
                </Button>
              </div>
              <p id="loan-guarantor-hint" className="text-xs text-muted-foreground">
                {t('applyGuarantorIdHint')}
              </p>
              {lookupError && (
                <p role="alert" className="text-xs text-red-700 dark:text-red-400">{lookupError}</p>
              )}
            </>
          )}

          {guarantorRequired && guarantor && (
            <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <span className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>
                  <span className="font-medium">{guarantor.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                    {guarantor.accountNo}
                  </span>
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setGuarantor(null);
                  setGuarantorIdInput('');
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {t('applyGuarantorChange')}
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? t('applySubmitting') : t('applySubmit')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t('applyCancel')}
          </Button>
        </div>
      </div>
    </section>
  );
}
