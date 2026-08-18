import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// WO-59. Three notification writes were started and never awaited:
//
//   prisma.notification.create({ … }).catch((err) => console.error(err));
//   return NextResponse.json({ ok: true, user: created }, { status: 201 });
//
// On Vercel the function can be frozen the moment the response is returned, so
// a promise that has not settled is not "background work" — it is work that may
// simply never happen, with no error, no retry and no log. The admin was never
// told a registration was waiting, and the member waited for an approval nobody
// knew to give.
//
// `.catch()` on the end makes it look handled. It is not: it handles the
// rejection, not the truncation.

const WEB = process.cwd();
const API = join(WEB, 'app', 'api');

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * A call is floating when it starts a statement.
 *
 * The distinction that matters is with a call passed as an argument —
 * `await Promise.all([ prisma.a.count(), prisma.b.count() ])` — which is
 * awaited collectively and is the common shape in these routes. An argument's
 * previous line ends in `[`, `(` or `,`; a statement's ends in `;`, `{` or `}`.
 */
function floatingCalls(source: string): string[] {
  const lines = source.split('\n');
  const floating: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*(?:prisma|db)\s*\.\s*\w+\s*\.\s*\w+\s*\(/.test(line)) continue;

    let previous = '';
    for (let j = i - 1; j >= 0; j--) {
      const candidate = lines[j].replace(/\/\/.*$/, '').trimEnd();
      if (candidate.trim() !== '') {
        previous = candidate;
        break;
      }
    }
    if (/[[(,]$/.test(previous)) continue;

    floating.push(`${i + 1}: ${line.trim()}`);
  }
  return floating;
}

describe('WO-59 — no route starts a database write it does not wait for', () => {
  for (const file of routeFiles(API)) {
    const rel = relative(WEB, file);
    it(rel, () => {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(
        floatingCalls(source),
        `${rel} starts a Prisma call as a statement without awaiting it. ` +
          'The response may return first and the runtime may freeze before it settles. ' +
          'Await it; catch and log if the request must succeed regardless.',
      ).toEqual([]);
    });
  }
});

describe('the detector itself', () => {
  it('finds a floating call', () => {
    const source = [
      'const created = await prisma.user.create({ data });',
      "prisma.notification.create({ data: { title: 'x' } }).catch((e) => console.error(e));",
      'return NextResponse.json({ ok: true });',
    ].join('\n');
    expect(floatingCalls(source)).toHaveLength(1);
  });

  it('does not flag a call passed to Promise.all', () => {
    const source = [
      'const [rows, total] = await Promise.all([',
      '  prisma.auditLog.findMany({ where }),',
      '  prisma.auditLog.count({ where }),',
      ']);',
    ].join('\n');
    expect(floatingCalls(source)).toEqual([]);
  });

  it('does not flag an awaited call', () => {
    expect(floatingCalls('  await prisma.notification.create({ data });')).toEqual([]);
  });
});
