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

const widthMap = { sm: 140, md: 180, lg: 240, xl: 320 } as const;

export function Logo({
  size = 'md',
  variant = 'default',
  mark = false,
  className,
  src,
  priority = false,
}: LogoProps) {
  const source = src ?? (mark ? LOGO_MARK_SRC : LOGO_LOCKUP_SRC);
  const width = mark ? Math.round(widthMap[size] * 0.42) : widthMap[size];
  const height = Math.round(width * (mark ? MARK_RATIO : LOCKUP_RATIO));

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
        'h-auto w-auto object-contain',
        variant === 'light' && 'brightness-0 invert',
        className
      )}
      priority={priority}
    />
  );
}
