/** Brand constants, palette and page geometry shared by both renderers (RGB once). */

import type { OrgSettings } from './types';

export const BRAND_NAME_EN = 'Hasnahena Foundation';
export const BRAND_NAME_BN = 'হাসনাহেনা ফাউন্ডেশন';
export const BRAND_LOGO_PATH = '/images/logo/logo.png';
/**
 * Print-sized lockup, flattened onto white (~160 kB smaller per PDF, no soft
 * masks). Regenerate from logo.png.
 */
export const BRAND_LOGO_PRINT_PATH = '/images/logo/logo-print.png';
/** Intrinsic aspect ratio of the lockup (787 × 442). */
export const BRAND_LOGO_RATIO = 442 / 787;

export const DEFAULT_ORG: OrgSettings = {
  name: BRAND_NAME_BN,
  nameEn: BRAND_NAME_EN,
  address: 'Bhekutia, Sadar, Jashore, Bangladesh',
  phone: '+880 1712-345678',
  email: 'info@hasnahenafoundation.com',
  website: 'hasnahenafoundation.com',
};

export const TAGLINE = 'Interest-free cooperative finance · Qard al-Hasan';

export const LEDGER_NOTICE =
  'The foundation’s official ledger is the final record. This document is generated for member convenience and should be reconciled with the physical passbook.';

export const FOOTER_NOTE = 'Computer-generated document — valid without seal or signature.';

/** English name only — documents are English (ADR-012). */
export const getOrgNameEn = (org: OrgSettings = DEFAULT_ORG): string => {
  const name = org.nameEn?.trim();
  return !name || name.toLowerCase() === 'hasnahena' ? BRAND_NAME_EN : name;
};

export const orgField = (
  org: OrgSettings,
  key: 'address' | 'phone' | 'email' | 'website'
): string => (org[key]?.trim() || DEFAULT_ORG[key]) as string;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export type RGB = readonly [number, number, number];

export const COLORS = {
  ink: [22, 33, 31],
  inkSoft: [85, 101, 95],
  inkFaint: [138, 152, 148],
  brand: [15, 118, 110],
  brandDark: [11, 84, 78],
  brandTint: [242, 249, 247],
  credit: [4, 120, 87],
  debit: [185, 28, 28],
  rule: [219, 229, 226],
  ruleSoft: [237, 242, 240],
  panel: [251, 253, 252],
  paper: [255, 255, 255],
} as const satisfies Record<string, RGB>;

export type ColorName = keyof typeof COLORS;

export const hex = (name: ColorName): string =>
  `#${COLORS[name].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

// ---------------------------------------------------------------------------
// Geometry (millimetres)
// ---------------------------------------------------------------------------

export const PAGE = {
  width: 210,
  height: 297,
  marginX: 16,
  marginTop: 14,
  /** Reserved band at the foot of every page for the document footer. */
  footerHeight: 16,
} as const;

export const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;
export const CONTENT_BOTTOM = PAGE.height - PAGE.footerHeight;
