import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getPublicSettings } = vi.hoisted(() => ({ getPublicSettings: vi.fn() }));

vi.mock('@/lib/system-config', () => ({ getPublicSettings }));
vi.mock('@/lib/seo', () => ({ siteOrigin: 'https://www.hasnahenafoundation.com' }));

const { GET } = await import('../../app/.well-known/security.txt/route');

async function body(): Promise<string> {
  const response = await GET();
  return response.text();
}

function field(text: string, name: string): string | undefined {
  return text
    .split('\n')
    .find((line) => line.startsWith(`${name}:`))
    ?.slice(name.length + 1)
    .trim();
}

describe('/.well-known/security.txt', () => {
  beforeEach(() => {
    getPublicSettings.mockReset();
    getPublicSettings.mockResolvedValue({ 'org.email': 'contact@hasnahenafoundation.com' });
  });

  // RFC 9116: Contact and Expires are mandatory.
  it('carries every field RFC 9116 requires', async () => {
    const text = await body();

    expect(field(text, 'Contact')).toBe('mailto:contact@hasnahenafoundation.com');
    expect(field(text, 'Expires')).toBeDefined();
    expect(field(text, 'Canonical')).toBe(
      'https://www.hasnahenafoundation.com/.well-known/security.txt',
    );
    expect(field(text, 'Preferred-Languages')).toBe('en, bn');
  });

  // Generated so the expiry never lapses.
  it('expires in the future, and says so in UTC', async () => {
    const expires = field(await body(), 'Expires');

    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(new Date(expires!).getTime()).toBeGreaterThan(Date.now());
  });

  // The address a researcher is told to use is the address members are told to
  // use, so it cannot rot separately from the one on every public page.
  it('takes its contact from org.email', async () => {
    getPublicSettings.mockResolvedValue({ 'org.email': ' someone@example.org ' });

    expect(field(await body(), 'Contact')).toBe('mailto:someone@example.org');
  });

  // Contact is mandatory, so an unconfigured deployment must still produce a
  // valid file rather than one a parser throws out.
  it('falls back rather than emitting a Contact-less file', async () => {
    getPublicSettings.mockResolvedValue({});

    expect(field(await body(), 'Contact')).toBe('mailto:info@hasnahenafoundation.com');
  });

  it('is served as plain text', async () => {
    const response = await GET();

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });
});
