import { siteOrigin } from '@/lib/seo';
import { getPublicSettings } from '@/lib/system-config';

/**
 * RFC 9116 disclosure contact. Generated so the mandatory `Expires` renews
 * itself. Contact is org.email, the address the site shows. Not
 * locale-prefixed (proxy.ts skips dotted paths).
 */

/** Long enough not to churn caches, short enough to prove the site is tended. */
const VALID_FOR_DAYS = 365;

const FALLBACK_CONTACT = 'info@hasnahenafoundation.com';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const settings = await getPublicSettings();
  const contact = settings['org.email']?.trim() || FALLBACK_CONTACT;

  // Truncated to the start of the day so the body is byte-stable within a day
  // and an intermediary caching it for an hour is not serving a lie.
  const expires = new Date();
  expires.setUTCHours(0, 0, 0, 0);
  expires.setUTCDate(expires.getUTCDate() + VALID_FOR_DAYS);

  const body = [
    '# Hasnahena Foundation — responsible disclosure',
    '#',
    '# This platform holds members’ savings, loan records and national identity',
    '# documents. If you have found something that puts any of it at risk, please',
    '# tell us before telling anyone else, and we will not pursue you for it.',
    '',
    `Contact: mailto:${contact}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    'Preferred-Languages: en, bn',
    `Canonical: ${siteOrigin}/.well-known/security.txt`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
