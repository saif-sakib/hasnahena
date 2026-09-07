'use client';

import { useEffect } from 'react';

/**
 * Turns the reveal on. Renders nothing.
 *
 * The rules in `app/globals.css` that hide a `.reveal` element are all scoped
 * to `[data-reveal-js]` on `<html>`, and this is the only thing that ever sets
 * it — deliberately, and it is the whole safety property of the system. If this
 * chunk never loads, if `IntersectionObserver` is missing, if the constructor
 * throws, or if the reader has asked for reduced motion, the attribute is not
 * set, the hiding rules never match, and the page renders in its finished
 * state. A reveal that hides in CSS and waits for a script to show it leaves a
 * blank page when the script does not arrive; this one cannot.
 *
 * WHY THERE IS JAVASCRIPT HERE AT ALL, on a page whose whole design was that
 * there is none. This was `animation-timeline: view()` for two rounds of work:
 * no observer, no listener, off the main thread, zero bytes. It was also
 * reported as doing nothing, twice, in the same words — because scroll-driven
 * animations reached Safari only in 26, the block was written inside
 * `@supports`, and a reader on an older engine got silently nothing. Neither
 * fix in between could have helped: not one line of it was ever applied for
 * them. `IntersectionObserver` has been in every engine since 2019, and it is
 * worth ~700 bytes to have one behaviour instead of one behaviour and one
 * silence.
 *
 * It is also cheaper than it looks. An observer is not a scroll listener: the
 * browser reports intersections from the same work it already does to composite
 * the page, there is no callback per frame, and each element is unobserved the
 * moment it has arrived — so a fully-scrolled page is observing nothing.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;

    // Asked for less motion: do nothing at all, including not hiding anything.
    // The CSS agrees — every rule is inside `prefers-reduced-motion:
    // no-preference` — but the observer would still be built and run, and a
    // reader who wants stillness should not pay for machinery either.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.reveal, .reveal-left, .reveal-right, .reveal-soft, .reveal-row > *, .reveal-row-4 > *',
      ),
    );
    if (elements.length === 0) return;

    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute('data-revealed', '');
            // Once it has arrived it never leaves again — this is an entrance,
            // not a scrubbable effect, and an element that fades back out on
            // the way up is the thing that makes a page feel unstable.
            observer.unobserve(entry.target);
          }
        },
        {
          /*
            The trigger line, 8% up from the foot of the viewport.

            It is a compromise with a measured cost. Pulling it further up
            makes the movement happen while the element is clearly arriving
            rather than at the very edge — but everything BELOW the line is
            hidden, so the band is also a strip of blank page. At -12% a short
            block that came to rest inside it ("Read more", the gallery's "View
            All") stayed at zero opacity while it was fully on screen, which is
            a gap where content should be and the exact complaint this whole
            change exists to answer. 8% of a 900px viewport is 72px, which is
            about the height of a phone's own browser chrome.
          */
          rootMargin: '0px 0px -8% 0px',
          threshold: 0,
        },
      );
    } catch {
      // No observer, no hiding. The page is already correct.
      return;
    }

    /*
      Order matters here, and it is the difference between a reveal and a
      flash.

      Anything already on screen is marked arrived FIRST, and the attribute
      that enables hiding is set SECOND — both in this one synchronous block,
      so the browser computes style once and those elements never paint their
      hidden state. Setting the attribute first would blank every visible
      revealed element for a frame and then animate it back in, which is worse
      than no animation.
    */
    const viewportHeight = window.innerHeight || root.clientHeight;
    for (const element of elements) {
      if (element.getBoundingClientRect().top < viewportHeight * 0.92) {
        element.setAttribute('data-revealed', '');
      }
    }

    root.setAttribute('data-reveal-js', '');

    for (const element of elements) {
      if (!element.hasAttribute('data-revealed')) observer.observe(element);
    }

    return () => {
      observer.disconnect();
      root.removeAttribute('data-reveal-js');
    };
  }, []);

  return null;
}
