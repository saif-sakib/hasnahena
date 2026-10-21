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
 * The lockup's HEIGHT per size (width follows the aspect ratio) — never
 * `h-auto w-auto`, which ignores the size entirely. Large enough that the
 * Bengali tagline stays legible; phone gets the smaller step of each pair.
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
  // The intrinsic size is the largest the class pair renders, so srcset never upscales.
  const height = maxHeight[size];
  const width = Math.round(height / (mark ? MARK_RATIO : LOCKUP_RATIO));

  return (
    <Image
      src={source}
      // The full name in both scripts — one of the most-crawled strings.
      alt="হাসনাহেনা ফাউন্ডেশন / Hasnahena Foundation"
      width={width}
      height={height}
      className={cn(
        // Height class decides size; max-w guards a very wide uploaded logo at 412px.
        'w-auto max-w-[45vw] object-contain',
        heightClass[size],
        variant === 'light' && 'brightness-0 invert',
        className
      )}
      priority={priority}
    />
  );
}
