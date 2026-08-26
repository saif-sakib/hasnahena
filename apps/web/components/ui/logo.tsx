import * as React from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

/** Full lockup: leaf mark + হাসনাহেনা wordmark + tagline. Transparent PNG. */
export const LOGO_LOCKUP_SRC = '/images/logo/logo.png';
/** Square leaf mark only — favicons, avatars, tight spaces. */
export const LOGO_MARK_SRC = '/images/logo/logo-mark.png';

/** Intrinsic aspect ratios of the shipped assets (787x442 and 512x512). */
const LOCKUP_RATIO = 442 / 787;
const MARK_RATIO = 1;

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** `light` renders a white silhouette for dark backgrounds. */
  variant?: 'default' | 'light';
  /** Show the square leaf mark instead of the full lockup. */
  mark?: boolean;
  className?: string;
  /** Override the asset, e.g. an uploaded `branding.logo` URL. */
  src?: string;
  priority?: boolean;
}

/**
 * How **tall** the lockup renders, in CSS pixels.
 *
 * Height rather than width, and this is the whole fix from T-10. The size map
 * used to name widths and hand them to `next/image` as the `width` prop — while
 * the className said `h-auto w-auto`, which overrides both. A replaced element
 * with `width:auto;height:auto` renders at its *intrinsic* size, so every call
 * site got the same picture whatever `size` it asked for: `sm` and `md` both
 * measured **192 × 108**, inside a **64 px** header.
 *
 * What that looked like: the leaf spilling 44 px below the header on every
 * public page, covering the hero badge at 412 px; and the privacy page's own
 * header growing to 141 px on a phone because it has no fixed height to spill
 * out of. The `size` prop had no effect anywhere, so nobody could have fixed one
 * call site without discovering this.
 *
 * The header is `h-16`, so `md` is 40 px — the lockup sits inside it with room
 * above and below at every width.
 */
const heightMap = { sm: 28, md: 40, lg: 56, xl: 72 } as const;

/** The mark is square, so it reads smaller at the same height beside text. */
const MARK_SCALE = 0.9;

export function Logo({
  size = 'md',
  variant = 'default',
  mark = false,
  className,
  src,
  priority = false,
}: LogoProps) {
  const source = src ?? (mark ? LOGO_MARK_SRC : LOGO_LOCKUP_SRC);
  const height = Math.round(heightMap[size] * (mark ? MARK_SCALE : 1));
  const width = Math.round(height / (mark ? MARK_RATIO : LOCKUP_RATIO));

  return (
    <Image
      src={source}
      // Named in full, in both scripts. This renders in the header of every
      // public page, so it is one of the most-crawled strings on the site —
      // "Hasnahena" alone is a crowded name and omits the word people search.
      alt="হাসনাহেনা ফাউন্ডেশন / Hasnahena Foundation"
      width={width}
      height={height}
      // The height is fixed and the width follows the aspect ratio, so an
      // uploaded `branding.logo` of any shape still fits the space it is given
      // rather than deciding it. `max-w-full` keeps a very wide upload from
      // pushing the language switcher off a 412 px screen.
      style={{ height: `${height}px`, width: 'auto' }}
      className={cn(
        'max-w-full object-contain',
        variant === 'light' && 'brightness-0 invert',
        className
      )}
      priority={priority}
    />
  );
}
