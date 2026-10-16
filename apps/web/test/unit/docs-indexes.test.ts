import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// docs/traps.md promises "this page alone answers 'is my problem already
// known?'" — true only while it lists every entry verbatim. Hand-maintained,
// it had dropped ~30 traps and seven sections read `· 0`.

const DOCS = resolve(process.cwd(), '..', '..', 'docs');
const read = (rel: string) => readFileSync(join(DOCS, rel), 'utf8');

/** A trap entry is a top-level `- **Title.** body` bullet. */
function trapTitles(file: string): string[] {
  return [...read(file).matchAll(/^- \*\*([\s\S]+?)\*\*/gm)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

describe('docs/traps.md', () => {
  const index = read('traps.md');
  const sections = [...index.matchAll(/^### \[[^\]]+\]\((traps\/[^)]+)\) · (\d+)\n\n((?:- .*\n?)*)/gm)];

  it('has one section per file in docs/traps/', () => {
    expect(sections.map((s) => s[1]).sort()).toEqual(
      readdirSync(join(DOCS, 'traps')).map((f) => `traps/${f}`).sort(),
    );
  });

  it.each(sections.map((s) => [s[1], Number(s[2]), s[3]] as const))(
    '%s lists every entry verbatim, with its count',
    (file, count, body) => {
      const listed = body.trim().split('\n').filter(Boolean).map((l) => l.slice(2));
      const actual = trapTitles(file);
      expect(listed).toEqual(actual);
      expect(count).toBe(actual.length);
      // An entry written as a bare `**Title.**` paragraph is invisible to the index.
      expect(read(file)).not.toMatch(/^\*\*/m);
    },
  );

  it('states the true total', () => {
    const total = sections.reduce((n, s) => n + trapTitles(s[1]).length, 0);
    expect(index).toContain(`${total} traps in ${sections.length} files`);
  });
});

describe('docs/decisions.md', () => {
  it('has exactly one row per ADR file', () => {
    const rows = [...read('decisions.md').matchAll(/^\| \[ADR-\d{3}\]\(decisions\/(adr-\d{3}-[^)]+\.md)\)/gm)].map((m) => m[1]);
    expect(rows.sort()).toEqual(readdirSync(join(DOCS, 'decisions')).sort());
  });
});
