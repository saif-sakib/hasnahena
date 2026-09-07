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

    /*
      Whether the hiding rules are live yet.

      Everything is visible until the observer's FIRST callback has told us what
      is already on screen — see the block after the constructor.
    */
    let armed = false;

    /*
      Whether an element may be un-revealed yet.

      Re-arming exists so that scrolling back up and down again replays the
      entrance. But the observer cannot tell "the reader scrolled up past this"
      from "the page grew underneath it", and at load the page grows a lot: the
      gallery's images arrive without reserved dimensions, the document gets
      taller, and ten elements that were on screen are suddenly a thousand
      pixels below it. The reset then fires on all ten, correctly by its own
      logic, and what a reader sees is a block of cards fading in and then
      vanishing again.

      A reader cannot have scrolled up before the page has finished loading, so
      resets simply do not exist until then. The short delay after `load` covers
      the layout that settles just after it — a late font, a lazy image.
    */
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

            /*
              It arrives again if you come back to it.

              The first version unobserved on arrival — an entrance plays once,
              which is the conventional choice and the wrong one here: "if again
              I go up then there is no animation". So the element is armed again
              once it is BELOW the viewport, which is where scrolling up puts
              it, and it plays the same way the second time as the first.

              Only below. An element that has left through the TOP is left
              alone: re-arming it would mean scrolling up brings it back in from
              above while its animation slides it up from below, which is a
              direction nobody scrolled in.

              The test is `window.innerHeight` and not `entry.rootBounds`,
              deliberately. `rootBounds` has the -8% trigger margin baked into
              it, so an element resting in that band would be un-arming and
              re-arming on every pixel of scroll — a flicker exactly at the
              bottom edge of the screen. Measuring against the real viewport
              leaves that 8% as hysteresis between the two events.
            */
            if (mayReset && entry.boundingClientRect.top >= (window.innerHeight || 0)) {
              entry.target.removeAttribute('data-revealed');
            }
          }

          /*
            Arm on the way out of the first callback, never before.

            Everything above has just been decided from the OBSERVER's geometry,
            which is the only geometry that is right. Setting the attribute here
            means the elements it hides are exactly the ones this pass did not
            mark, and none of them has painted a hidden state.
          */
          if (!armed) {
            armed = true;
            root.setAttribute('data-reveal-js', '');
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
      Observe everything, and hide nothing yet.

      The first version decided what was already on screen itself, with
      `getBoundingClientRect()`, and then set the attribute. That reads as the
      careful order — mark what is visible, only then start hiding — and it is
      wrong for a reason that only shows up in a browser: **the effect runs
      before the page has finished laying out.** The gallery's images had not
      loaded, so the document was short, so ten elements that are really far
      below the fold measured as being near the top and were marked arrived.
      They began fading in; the observer's first callback then measured them
      correctly and took the mark away. A flash of ten cards at every load.

      So the geometry question is asked once, of the observer, which answers it
      from the same layout information the browser uses to composite — and the
      answer arrives in the first callback, where the attribute is set. Until
      then nothing is hidden, which is also the safe direction: a first callback
      that never comes leaves the page finished.
    */
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
