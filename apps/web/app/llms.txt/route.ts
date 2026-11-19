import { ORG_FACEBOOK_URL } from '@/lib/contact-details';
import {
  getLocalizedUrl,
  publicPagePaths,
  siteOrigin,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_NAME_BN,
} from '@/lib/seo';
import { PUBLIC_PAGE_LABELS } from '@/lib/structured-data';

export const dynamic = 'force-static';

export function GET(): Response {
  const englishLinks = publicPagePaths
    .map((path) => `- [${PUBLIC_PAGE_LABELS[path].en}](${getLocalizedUrl('en', path)})`)
    .join('\n');

  const bengaliLinks = publicPagePaths
    .map((path) => `- [${PUBLIC_PAGE_LABELS[path].bn}](${getLocalizedUrl('bn', path)})`)
    .join('\n');

  const body = [
    `# ${SITE_NAME} (${SITE_NAME_BN})`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    '## Key Facts',
    `- **Organization:** ${SITE_NAME} (${SITE_NAME_BN}), an interest-free Islamic cooperative finance organization in Bhekutia, Sadar, Jashore (Jessore), Khulna Division, Bangladesh.`,
    '- **Lending Model:** Qard al-Hasan (কর্জে হাসানা) — 100% interest-free loans with zero interest rate, zero profit markup, and zero late fees.',
    '- **Office Expenses:** A flat ৳500 non-refundable office expense applies at member registration and once at loan application; it is never added to the loan and stays the same regardless of loan amount.',
    `- **Official Website:** ${siteOrigin}`,
    `- **Official Facebook Page:** ${ORG_FACEBOOK_URL}`,
    '',
    '## Public Pages (English)',
    englishLinks,
    '',
    '## Public Pages (Bengali / বাংলা)',
    bengaliLinks,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
