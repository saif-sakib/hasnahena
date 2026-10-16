import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Admission hands out a NUMBER, never a password: the handler must not return
 * it and the approvals screen must not render it. Members without email get one
 * via the staff-assisted reset (ADR-036, ADR-042).
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const API_ROOT = resolve(WEB_ROOT, '..', 'api');

const HANDLER = readFileSync(
  join(API_ROOT, 'internal', 'handlers', 'dashboard_handler.go'),
  'utf8',
);
const APPROVALS_SCREEN = readFileSync(
  join(WEB_ROOT, 'components', 'dashboard', 'screens', 'approvals-screen.tsx'),
  'utf8',
);
const RESET_ROUTE = readFileSync(
  join(WEB_ROOT, 'app', 'api', 'v1', 'admin', 'members', '[id]', 'reset-password', 'route.ts'),
  'utf8',
);

/** The body of `ApproveRegistration` in the Go handler, up to the next function. */
function approveRegistrationBody(): string {
  const start = HANDLER.indexOf('func (h *DashboardHandler) ApproveRegistration(');
  expect(start, 'ApproveRegistration has been renamed or moved').toBeGreaterThan(-1);
  const end = HANDLER.indexOf('\nfunc ', start + 1);
  return HANDLER.slice(start, end === -1 ? undefined : end);
}

describe('approving a registration', () => {
  it('does not return the temporary password', () => {
    const body = approveRegistrationBody();
    // The password still exists in there — it is generated, hashed and emailed.
    // What must not exist is a response key carrying it.
    expect(body, 'the approval still has to generate a password to hash and email')
      .toContain('generateTempPassword()');
    expect(
      body,
      'the approval response must not carry a working credential; issue one from ' +
        'the staff-assisted reset on the member’s own page instead (ADR-036)',
    ).not.toMatch(/"temporaryPassword"\s*:/);
  });

  it('does return the account number it has just allocated', () => {
    // Nothing else shows it to the admin who allocated it: it is null until
    // approval (ADR-039), and most members get no email.
    expect(approveRegistrationBody()).toMatch(/"accountNo"\s*:\s*accountNo/);
  });

  it('assigns the office the admin chose, and refuses a closed one', () => {
    const body = approveRegistrationBody();
    expect(body, 'the branch must be part of the approval request').toContain('BranchID string');
    expect(body).toContain('req.BranchID');
    // Rule 2b: an office that has been closed is the admin picking from a stale
    // list, not a fault. It must not surface as a 500 naming a foreign key.
    expect(body).toContain('repositories.ErrBranchNotAssignable');
    expect(body).toContain('http.StatusBadRequest');
  });
});

describe('the approvals screen', () => {
  it('shows the account number and the office, and no password', () => {
    expect(APPROVALS_SCREEN).toContain('approvedMember.accountNo');
    expect(APPROVALS_SCREEN).toContain('approvedMember.branchName');
    expect(
      APPROVALS_SCREEN,
      'the approvals screen must not display a temporary password',
    ).not.toContain('temporaryPassword');
  });

  it('tells the admin what to do for a member with no email', () => {
    // Without this the screen is a dead end for the majority case: the member
    // has no email, no password was sent, and nothing says where one comes from.
    expect(APPROVALS_SCREEN).toMatch(/issue a password from their page/);
  });
});

describe('the staff-assisted reset is where a password comes from', () => {
  it('still hands one back, once', () => {
    expect(RESET_ROUTE).toContain('temporaryPassword');
    // And revokes every live session in the same transaction as the password —
    // ADR-031. A reset that leaves the old token working is not a reset.
    expect(RESET_ROUTE).toContain('revokeAllTokens');
  });
});
