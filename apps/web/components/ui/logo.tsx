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
 * How **tall** the lockup renders — a Tailwind height class, with the width left
 * to follow the aspect ratio.
 *
 * Two corrections live in this map, in order.
 *
 * **The size prop used to do nothing at all.** It named a *width*, handed it to
 * `next/image`, and the className then said `h-auto w-auto` — which overrides
 * both, because a replaced element sized `auto`/`auto` renders at its intrinsic
 * dimensions. Every call site got the same picture: `sm` and `md` both measured
 * 192 × 108, inside a 64 px header, so the leaf spilled over the hero and
 * covered the tagline badge at 412 px.
 *
 * **Then the fix went too far the other way.** Constraining `md` to 40 px made
 * the lockup obey its header and made the wordmark unreadable — the tagline
 * under হাসনাহেনা is two lines of small Bengali type, and at 40 px tall those
 * lines are about eight pixels each. The owner reads this on a phone in
 * sunlight. So the header grew to hold a lockup at a size somebody can actually
 * read, rather than the lockup shrinking to fit a header nobody chose.
 *
 * Classes rather than an inline style so the height can be responsive: a phone
 * gets the smaller step of each pair, a desktop the larger.
 */
const heightClass = {
  sm: 'h-9 md:h-10',
  md: 'h-14 md:h-16',
  lg: 'h-16 md:h-20',
  xl: 'h-20 md:h-24',
} as const;

/** The largest CSS pixel height each step can reach, for `next/image` sizing. */
const maxHeight = { sm: 40, md: 64, lg: 80, xl: 96 } as const;

export function Logo({
  size = 'md',
  variant = 'default',
  mark = false,
  className,
  src,
  priority = false,
}: LogoProps) {
  const source = src ?? (mark ? LOGO_MARK_SRC : LOGO_LOCKUP_SRC);
  // The intrinsic size handed to `next/image` is the *largest* the class pair
  // can render, so the srcset it picks is never upscaled. The CSS below is what
  // actually decides the size on screen.
  const height = maxHeight[size];
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
      className={cn(
        // `w-auto` and never `h-auto`: the height class is the size, the width
        // follows. `max-w-[45vw]` is the guard for an uploaded `branding.logo`
        // of an unexpected shape — a very wide one must not push the language
        // switcher off a 412 px screen.
        'w-auto max-w-[45vw] object-contain',
        heightClass[size],
        variant === 'light' && 'brightness-0 invert',
        className
      )}
      priority={priority}
    />
  );
}
