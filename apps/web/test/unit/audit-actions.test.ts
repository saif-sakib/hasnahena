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
 * The audit catalogue against what both backends actually write — fails on an
 * uncatalogued action (unstyled on the screen) and on a catalogued action
 * nothing writes (a dead filter chip).
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
 * Every action literal written to audit_logs, in all four spellings (raw Go SQL,
 * insertAuditLogTx, SecurityService.CreateAuditLog, Next createAuditLog).
 */
function actionsWrittenInSource(): Set<string> {
  const found = new Set<string>();

  const goFiles = walk(join(REPO_ROOT, 'apps', 'api'), ['.go']).filter(
    (f) => !f.endsWith('_test.go'),
  );
  for (const file of goFiles) {
    const source = readFileSync(file, 'utf8');
    // INSERT INTO audit_logs (action, ...) VALUES ('ACTION', ... — anchored on
    // what writers still have (the key is a DB sequence since ADR-044).
    for (const [, action] of source.matchAll(
      /INSERT INTO audit_logs[\s\S]{0,400}?VALUES \(\s*'([A-Z_]+)'/g,
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

  // Migrations are a third writer (20260901120000_ids_are_the_numbers).
  const migrationsDir = join(WEB_ROOT, 'prisma', 'migrations');
  for (const file of walk(migrationsDir, ['.sql'])) {
    const source = readFileSync(file, 'utf8');
    for (const [, action] of source.matchAll(
      /INSERT INTO audit_logs[\s\S]{0,400}?(?:VALUES|SELECT)\s*\(?\s*'([A-Z_]+)'/g,
    )) {
      found.add(action);
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
  /** Money, decisions about a person and erasure are permanent — erasure rows prove compliance. */
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
    // An unknown action must still appear.
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
    // Noise is hidden by default; keep the list small.
    expect(NOISE_ACTIONS).toContain('LOGIN');
    expect(NOISE_ACTIONS).toContain('LOGOUT');
    expect(NOISE_ACTIONS).not.toContain('MEMBER_ERASED');
    expect(NOISE_ACTIONS).not.toContain('LOGIN_LOCKOUT_ESCALATED');
    expect(NOISE_ACTIONS.length).toBeLessThan(AUDIT_ACTION_NAMES.length / 3);
  });
});
