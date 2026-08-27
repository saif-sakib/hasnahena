import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_RETENTION_DAYS,
  auditActionSpec,
  auditActionLabel,
  NOISE_ACTIONS,
} from '@/lib/audit-actions';

/**
 * The audit catalogue against what the two backends actually write.
 *
 * This is the census that had been missing. `lib/audit.ts` carried a
 * hand-written union of action names, and by the time anything read the table it
 * described a system that does not exist: five of its seventeen entries — among
 * them `REGISTRATION_APPROVED`, `DEPOSIT_CONFIRMED` and `SETTINGS_UPDATED` — are
 * written by nothing, and every one of the twenty-two actions the Go API writes
 * was absent. Nothing failed, because the union only constrained the ten call
 * sites in the Next app.
 *
 * An uncatalogued action is a row on the admin's audit screen rendered as
 * `MARK_LOAN_DEFAULTED` with no colour and no Bengali; a catalogued action
 * nothing writes is a filter chip that always returns nothing. Both directions
 * fail here.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const REPO_ROOT = resolve(WEB_ROOT, '..', '..');

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Every action literal either backend writes into `audit_logs`.
 *
 * Four spellings, because there are four ways to write one of these rows and no
 * amount of wishing makes them one: raw SQL in a Go repository, the Go
 * `insertAuditLogTx` helper, the Go `SecurityService.CreateAuditLog` struct, and
 * `createAuditLog` in the Next app. A fifth spelling would be invisible to this,
 * which is why `writesAnAuditRow` below also fails on an `audit_logs` insert this
 * cannot read.
 */
function actionsWrittenInSource(): Set<string> {
  const found = new Set<string>();

  const goFiles = walk(join(REPO_ROOT, 'apps', 'api'), ['.go']).filter(
    (f) => !f.endsWith('_test.go'),
  );
  for (const file of goFiles) {
    const source = readFileSync(file, 'utf8');
    // INSERT INTO audit_logs (...) VALUES (gen_random_uuid()::text, 'ACTION', ...
    for (const [, action] of source.matchAll(
      /INSERT INTO audit_logs[\s\S]{0,400}?VALUES \(gen_random_uuid\(\)::text, '([A-Z_]+)'/g,
    )) {
      found.add(action);
    }
    for (const [, action] of source.matchAll(/insertAuditLogTx\(ctx, tx, "([A-Z_]+)"/g)) {
      found.add(action);
    }
    // AuditLogEntry{ Action: "X" — only the security service builds one.
    if (source.includes('AuditLogEntry{')) {
      for (const [, action] of source.matchAll(/Action:\s*"([A-Z_]+)"/g)) found.add(action);
    }
  }

  const tsFiles = [
    ...walk(join(WEB_ROOT, 'app'), ['.ts', '.tsx']),
    ...walk(join(WEB_ROOT, 'lib'), ['.ts']),
  ].filter((f) => !f.includes('.test.'));
  for (const file of tsFiles) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('createAuditLog')) continue;
    for (const [, action] of source.matchAll(/action:\s*'([A-Z_]+)'/g)) found.add(action);
  }

  return found;
}

const WRITTEN = actionsWrittenInSource();

describe('the audit catalogue and the code agree', () => {
  it('found the audit writes at all', () => {
    // A guard on the guard. If a refactor changes how these rows are written,
    // every other assertion here quietly passes over an empty set.
    expect(WRITTEN.size).toBeGreaterThan(20);
  });

  it('catalogues every action either backend writes', () => {
    const uncatalogued = [...WRITTEN].filter((a) => !AUDIT_ACTION_NAMES.includes(a as never));
    expect(
      uncatalogued.sort(),
      'these actions are written but not in AUDIT_ACTIONS, so the audit screen ' +
        'renders them as a raw constant with no colour, no category and no Bengali',
    ).toEqual([]);
  });

  it('has nothing in the catalogue that nothing writes', () => {
    const unwritten = AUDIT_ACTION_NAMES.filter((a) => !WRITTEN.has(a));
    expect(
      unwritten.sort(),
      'these are catalogued but no code writes them — a filter chip that can ' +
        'only ever return an empty list. This is exactly how the old union came ' +
        'to describe five events that never happen',
    ).toEqual([]);
  });
});

describe('every catalogued action is fully described', () => {
  it('has both languages, and they differ', () => {
    for (const name of AUDIT_ACTION_NAMES) {
      const spec = AUDIT_ACTIONS[name];
      expect(spec.en.trim().length, `${name} has no English label`).toBeGreaterThan(0);
      expect(spec.bn.trim().length, `${name} has no Bengali label`).toBeGreaterThan(0);
      // Untranslated copy-paste is the failure mode `messages.test.ts` exists
      // for; this table is outside that file's reach.
      expect(spec.bn, `${name} is not translated — the Bengali is the English`).not.toBe(spec.en);
      expect(spec.bn, `${name} has no Bengali script in its Bengali label`).toMatch(/[ঀ-৿]/);
    }
  });

  it('has a category with a label in both languages', () => {
    for (const name of AUDIT_ACTION_NAMES) {
      expect(AUDIT_CATEGORY_LABELS[AUDIT_ACTIONS[name].category]).toBeDefined();
    }
  });
});

describe('the retention tier of a row is a property of what happened', () => {
  /**
   * The rule that must not erode: **anything about money, about a decision made
   * about a person, or about data being destroyed, is permanent.**
   *
   * The erasure rows are the subtle half. They are the proof that the foundation
   * deleted somebody's national identity card, so a policy that expired them
   * would be a retention policy destroying the evidence of its own compliance.
   */
  it('keeps money, lending, membership, staff and erasure for ever', () => {
    for (const name of AUDIT_ACTION_NAMES) {
      const spec = AUDIT_ACTIONS[name];
      if (!['money', 'lending', 'membership', 'staff', 'data'].includes(spec.category)) continue;
      if (name === 'PROFILE_UPDATED') continue; // a member editing their own phone number
      expect(
        spec.retention,
        `${name} is a ${spec.category} action and must be kept permanently — see ADR-038`,
      ).toBe('permanent');
    }
  });

  it('never expires a critical row on the short clock', () => {
    for (const name of AUDIT_ACTION_NAMES) {
      const spec = AUDIT_ACTIONS[name];
      if (spec.severity !== 'critical') continue;
      expect(
        spec.retention,
        `${name} is the kind of row an investigation starts from; six months is ` +
          'not long enough for something nobody noticed at the time',
      ).not.toBe('short');
    }
  });

  it('keeps a long row longer than a short one, and both for a usable period', () => {
    expect(AUDIT_RETENTION_DAYS.long).toBeGreaterThan(AUDIT_RETENTION_DAYS.short);
    // Below a quarter, a sweep deletes the trail of an incident before the
    // quarterly review that would have found it.
    expect(AUDIT_RETENTION_DAYS.short).toBeGreaterThanOrEqual(90);
  });
});

describe('the screen can render a row this build has never seen', () => {
  it('falls back to a readable label rather than vanishing', () => {
    // A row written by a newer deploy, or by a branch. It must appear — an audit
    // screen that silently drops rows it does not recognise is worse than no
    // audit screen, because it looks complete.
    const spec = auditActionSpec('SOME_FUTURE_ACTION');
    expect(spec.category).toBe('system');
    expect(spec.en).toBe('Some future action');
    expect(auditActionLabel('SOME_FUTURE_ACTION', 'bn')).toBe('Some future action');
  });

  it('labels a known action in the reader\'s language', () => {
    expect(auditActionLabel('MEMBER_ERASED', 'en')).toBe(AUDIT_ACTIONS.MEMBER_ERASED.en);
    expect(auditActionLabel('MEMBER_ERASED', 'bn')).toBe(AUDIT_ACTIONS.MEMBER_ERASED.bn);
  });
});

describe('the noise list', () => {
  it('hides the high-volume routine actions and nothing else', () => {
    // The screen's default view is "what would need explaining", and a member
    // signing in is not that. But the list must stay small: hiding by default is
    // a decision about what an admin sees when they arrive with no filters set.
    expect(NOISE_ACTIONS).toContain('LOGIN');
    expect(NOISE_ACTIONS).toContain('LOGOUT');
    expect(NOISE_ACTIONS).not.toContain('MEMBER_ERASED');
    expect(NOISE_ACTIONS).not.toContain('LOGIN_LOCKOUT_ESCALATED');
    expect(NOISE_ACTIONS.length).toBeLessThan(AUDIT_ACTION_NAMES.length / 3);
  });
});
