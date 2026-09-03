import { siteOrigin } from '@/lib/seo';
import { getPublicSettings } from '@/lib/system-config';

/**
 * RFC 9116 vulnerability disclosure contact, at `/.well-known/security.txt`.
 *
 * Why a route handler rather than a file in `public/`: RFC 9116 makes `Expires`
 * mandatory and says a file past it should be treated as invalid. A static
 * file's expiry is a date somebody has to remember to move, and nothing here
 * would fail when they didn't — the exact shape of promise this project keeps
 * finding broken silently. Generated, it renews itself and cannot go stale.
 *
 * The contact is `org.email`, the same address the footer and `/contact` show,
 * because a disclosure address nobody reads is worse than none: it converts a
 * researcher who would have found another way into one who reasonably concludes
 * they reported it. The fallback matches the Go mailer's own default sender.
 *
 * Not locale-prefixed, and it must not be — `proxy.ts` skips any path
 * containing a dot, so this is reached directly in both languages.
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
