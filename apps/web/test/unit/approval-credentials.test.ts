import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Admitting a member hands out a **number**, never a password.
 *
 * Approving a registration generates a temporary password, hashes it, emails it
 * if there is an address, and forgets it. For a while it also came back in the
 * response and was printed on the approvals screen, on the reasoning that most
 * members of this cooperative have no email address (ADR-036) so the screen was
 * the only delivery there was.
 *
 * That reasoning is right about the problem and wrong about the place. An
 * account number is a name — it is read aloud at the counter for the rest of a
 * membership, and the admin who just allocated it is the only person who can
 * see it. A password is a key. Putting a working key for a brand-new account on
 * a queue screen in a shared office, in a response body, at a moment when its
 * owner is usually not in the room, is a different act from showing a number.
 *
 * The member with no email is served deliberately instead:
 * `POST /api/v1/admin/members/{id}/reset-password` — the staff-assisted reset
 * (ADR-036) — which an admin runs from that member's own page, revokes every
 * session in the same transaction, and shows the password once on a screen that
 * is about one person.
 *
 * Both halves are asserted, in both directions, because either one alone
 * silently stops being true: a handler that returns it again with no screen to
 * show it is a secret in a response nobody reads, and a screen reaching for a
 * field the handler no longer sends renders an empty box under a heading that
 * says "Temporary password".
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
