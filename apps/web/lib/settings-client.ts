/**
 * The browser's single way to read `GET /api/v1/settings`.
 *
 * WO-77 made that endpoint answer according to who is asking: a stranger gets
 * branding and organisation details, a signed-in member gets the loan policy
 * governing their own money as well, and an admin gets everything. The token is
 * what distinguishes them — so a dashboard screen that fetches this URL with a
 * bare `fetch` silently drops to the anonymous tier and renders the hardcoded
 * defaults compiled into the component.
 *
 * That is not a hypothetical: four call sites did exactly that on the day this
 * was written, and one of them sizes a member's loan eligibility. Hence one
 * function rather than a note asking people to remember the header.
 *
 * Anonymous callers are still first-class — the login page and the marketing
 * pages call this with no token at all, and get the public tier.
 */

import { getValidatedClientToken } from '@/lib/client-auth';

export async function fetchSettings(
  init?: { cache?: RequestCache },
): Promise<Record<string, string> | null> {
  const token = getValidatedClientToken();
  const response = await fetch('/api/v1/settings', {
    cache: init?.cache ?? 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.ok ? ((await response.json()) as Record<string, string>) : null;
}
