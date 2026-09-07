import * as React from 'react';

/**
 * A hasnahena sprig — the decorative flourish the marketing sections are set
 * against.
 *
 * WHY BOTANICAL, ON A SITE WHOSE MOTIF IS GEOMETRIC. The foundation is named
 * after a flower: হাসনাহেনা, night-blooming jasmine. Its bloom is a small
 * five-pointed star, which is why this can sit on the same page as the khatam
 * lattice in `app/globals.css` without the page acquiring a second unrelated
 * visual language — the flower and the tessellation are both stars, at two
 * scales. The stem and leaves are the *islimi* vine that the geometric
 * tradition has always been drawn beside.
 *
 * It is drawn rather than photographed for the same reasons `GeometricPanel`
 * is: a few hundred bytes, no licence, no request, no 404 (the home page used
 * to fetch a `/patterns/grid.svg` that had never existed), and sharp on a cheap
 * Android screen at any density. Inline SVG is markup rather than script, so it
 * is untouched by the Content-Security-Policy ([ADR-024](../../../docs/decisions.md)).
 *
 * COLOUR IS THE CALLER'S. Every stroke and fill is `currentColor`, so the sprig
 * is tinted with an ordinary `text-*` class and follows the theme through the
 * same token everything else does. Baking emerald in here would have meant a
 * second copy of the drawing for the dark theme.
 *
 * It is `aria-hidden` and `pointer-events-none` throughout. It carries nothing
 * the surrounding copy does not, and a screen reader announcing "decorative
 * leaves" between a heading and its verses is noise.
 *
 * SIZE AND PLACEMENT ARE THE CALLER'S TOO — this renders at 100% of whatever
 * box it is given, with `preserveAspectRatio` off the default so it can be
 * stretched into a corner without the leaves distorting. Sections place it
 * absolutely, cropped by their own `overflow-hidden`, which is what keeps it
 * reading as a flourish the page is set on rather than as an illustration the
 * page contains.
 */
export function LeafFlourish({
  className,
  flipped = false,
}: {
  className?: string;
  /** Mirror the sprig, so a pair on opposite corners does not read as a repeat. */
  flipped?: boolean;
}) {
  return (
    <svg
      className={['pointer-events-none select-none', className ?? ''].join(' ')}
      viewBox="0 0 200 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g
        transform={flipped ? 'translate(200 0) scale(-1 1)' : undefined}
        stroke="currentColor"
        fill="none"
        strokeLinecap="round"
      >
        {/*
          The stem. One cubic, curving away from the corner it is anchored in —
          a straight stem reads as a stick, and a stem with more than one
          inflection reads as a doodle.
        */}
        <path d="M26 254 C 44 190, 62 148, 96 108 C 122 78, 150 52, 174 34" strokeWidth="2.5" />

        {/* A single side-shoot, so the sprig has somewhere for the eye to go
            that is not the tip. */}
        <path d="M74 138 C 96 132, 118 138, 138 156" strokeWidth="1.75" />

        {LEAVES.map(({ x, y, angle, scale }, index) => (
          <g key={index} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
            {/*
              A lanceolate leaf: two mirrored cubics from the petiole to the
              tip. The midrib is a separate stroke at half weight, which is the
              whole difference between a leaf and a green blob at this size.
            */}
            <path
              d="M0 0 C 9 -6, 13 -18, 0 -34 C -13 -18, -9 -6, 0 0 Z"
              fill="currentColor"
              fillOpacity="0.16"
              strokeWidth="1.5"
            />
            <path d="M0 -2 L0 -30" strokeWidth="0.9" strokeOpacity="0.7" />
          </g>
        ))}

        {BLOOMS.map(({ x, y, scale }, index) => (
          <g key={index} transform={`translate(${x} ${y}) scale(${scale})`}>
            {/* The five-pointed bloom. Filled a little more strongly than the
                leaves so the sprig has three or four bright points rather than
                an even wash. */}
            <path
              d="M0 -6 L1.5 -2.1 L5.7 -1.9 L2.5 0.8 L3.5 4.9 L0 2.6 L-3.5 4.9 L-2.5 0.8 L-5.7 -1.9 L-1.5 -2.1 Z"
              fill="currentColor"
              fillOpacity="0.34"
              strokeWidth="1"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Where each leaf sits on the stem, and how it is turned.
 *
 * A table rather than ten hand-written `<g>` elements, because the thing that
 * makes a drawn sprig look drawn is that no two leaves are the same size or at
 * the same angle — and that is only readable as a list. They alternate sides
 * along the stem and shrink towards the tip, which is how a real shoot grows.
 */
const LEAVES = [
  { x: 34, y: 222, angle: -52, scale: 1.0 },
  { x: 42, y: 200, angle: 46, scale: 0.9 },
  { x: 52, y: 176, angle: -60, scale: 1.05 },
  { x: 66, y: 152, angle: 40, scale: 0.85 },
  { x: 84, y: 126, angle: -66, scale: 0.95 },
  { x: 104, y: 102, angle: 34, scale: 0.8 },
  { x: 124, y: 80, angle: -72, scale: 0.85 },
  { x: 146, y: 58, angle: 28, scale: 0.7 },
  // The two on the side-shoot.
  { x: 104, y: 136, angle: 78, scale: 0.75 },
  { x: 128, y: 150, angle: 96, scale: 0.62 },
];

/** The blooms — few, and clustered towards the growing tip, as they are on the plant. */
const BLOOMS = [
  { x: 172, y: 34, scale: 1.15 },
  { x: 156, y: 46, scale: 0.85 },
  { x: 140, y: 158, scale: 0.9 },
  { x: 96, y: 108, scale: 0.7 },
];
