'use client';

import { useEffect } from 'react';

/**
 * Turns the reveal on; renders nothing. The CSS that hides `.reveal` elements is
 * scoped to `[data-reveal-js]`, which only this sets — so no script, no
 * IntersectionObserver or reduced motion means a fully visible page.
 * IntersectionObserver rather than `animation-timeline: view()`, which older
 * Safari silently ignored.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;

    // Reduced motion: build nothing.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.reveal, .reveal-left, .reveal-right, .reveal-soft, .reveal-row > *, .reveal-row-4 > *',
      ),
    );
    if (elements.length === 0) return;

    /* Nothing is hidden until the observer's FIRST callback reports what is on screen. */
    let armed = false;

    // No un-reveals until the page has loaded (+ a short delay): images arriving
    // push on-screen elements below the fold, which would otherwise reset them.
    let mayReset = false;
    let resetTimer: number | undefined;
    const allowResets = () => {
      resetTimer = window.setTimeout(() => {
        mayReset = true;
      }, 300);
    };
    if (document.readyState === 'complete') {
      allowResets();
    } else {
      window.addEventListener('load', allowResets, { once: true });
    }

    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.setAttribute('data-revealed', '');
              continue;
            }

            // Re-arm only once BELOW the viewport (scrolled back up), so the
            // entrance replays. innerHeight, not rootBounds, so the -8% margin is
            // hysteresis rather than flicker.
            if (mayReset && entry.boundingClientRect.top >= (window.innerHeight || 0)) {
              entry.target.removeAttribute('data-revealed');
            }
          }

          // Arm after the first callback, from the observer's (correct) geometry.
          if (!armed) {
            armed = true;
            root.setAttribute('data-reveal-js', '');
          }
        },
        {
          // Trigger 8% above the viewport foot; deeper left short blocks hidden
          // while fully on screen.
          rootMargin: '0px 0px -8% 0px',
          threshold: 0,
        },
      );
    } catch {
      // No observer, no hiding. The page is already correct.
      return;
    }

    // Observe everything, hide nothing yet. Measuring ourselves ran before
    // layout settled (images unloaded) and flashed cards; the observer's first
    // callback answers from real layout, and a missing callback leaves the page visible.
    for (const element of elements) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('load', allowResets);
      window.clearTimeout(resetTimer);
      root.removeAttribute('data-reveal-js');
    };
  }, []);

  return null;
}
