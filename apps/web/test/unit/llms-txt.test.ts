import { describe, expect, it } from 'vitest';
import { locales } from '@/i18n';
import { ORG_FACEBOOK_URL } from '@/lib/contact-details';
import { getLocalizedUrl, publicPagePaths, SITE_NAME, SITE_NAME_BN } from '@/lib/seo';
import { GET } from '@/app/llms.txt/route';

describe('/llms.txt', () => {
  it('serves plain-text factual organization and bilingual page links', async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).toContain(SITE_NAME);
    expect(body).toContain(SITE_NAME_BN);
    expect(body).toContain('Qard al-Hasan');
    expect(body).toContain('৳500');
    expect(body).toContain(ORG_FACEBOOK_URL);

    for (const locale of locales) {
      for (const path of publicPagePaths) {
        expect(body, `missing ${locale}${path}`).toContain(getLocalizedUrl(locale, path));
      }
    }
  });
});
