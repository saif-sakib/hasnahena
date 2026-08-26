import * as React from 'react';

/**
 * The hero's illustration — an eight-point *khatam* tessellation, drawn.
 *
 * Why this exists at all. The hero's right-hand column used to hold four
 * statistic cards, and those figures moved into `system_config` on 2026-08-26
 * because they had been invented — so on a foundation that has not typed its own
 * numbers in yet, half the hero was **empty**. A page whose layout depends on an
 * admin having filled a box in is a page that looks broken on the day it
 * launches.
 *
 * So the hero always has a visual, and the figures became a band of their own
 * below it that appears when there are figures to show.
 *
 * Why a drawing rather than a photograph. A stock photo of somebody counting
 * money is the visual language of a lender, and this is a Qard al-Hasan fund;
 * the geometry is the tradition the foundation actually belongs to, it carries
 * no licence, it weighs nothing, and it is sharp on the cheap Android screens
 * most members use. It is authored here as inline SVG rather than a file so it
 * inherits the theme's colours and adds no request — and inline SVG is markup,
 * not a script, so it is untouched by the Content-Security-Policy
 * ([ADR-024](../../../docs/decisions.md)).
 *
 * The construction is the classic one: a square grid, each cell carrying an
 * eight-point star made of two overlaid squares, with the interstitial
 * quadrilaterals left open. Everything is drawn from one `<pattern>`, so the
 * whole panel is a few hundred bytes whatever size it renders at.
 *
 * It is the **fallback**, and only that. The hero normally shows the
 * foundation's four figures as floating cards; this renders in their place when
 * all four have been cleared, so a deployment that has said nothing about
 * itself gets an illustration rather than a hole. The caller supplies the
 * aspect ratio: a fixed `aspect-square` here made it a full phone screen of
 * scrolling for decoration.
 *
 * It briefly carried the figures itself, on the emerald field. That version was
 * legible and correct and less elegant than the frosted cards it had replaced,
 * which is why the cards came back (owner, 2026-08-26).
 */
export function GeometricPanel({ className }: { className?: string }) {
  return (
    <div
      className={[
        'relative w-full overflow-hidden rounded-[2rem]',
        'bg-linear-to-br from-emerald-600 via-emerald-500 to-teal-600',
        'shadow-2xl shadow-emerald-900/25 ring-1 ring-white/20',
        className ?? '',
      ].join(' ')}
      // Decorative: it carries no information the surrounding copy does not,
      // and announcing "geometric pattern" two lines under the headline is
      // noise. Safe on the root again because nothing is rendered inside it —
      // when it briefly held the figures, this attribute was hiding all four
      // from every screen reader.
      aria-hidden="true"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 400 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/*
            One tile, repeated. 100×100 with the star inscribed in the middle
            80×80 leaves a margin so adjacent tiles read as a lattice rather
            than a solid mesh.
          */}
          <pattern id="hn-khatam" width="100" height="100" patternUnits="userSpaceOnUse">
            {/* The upright square. */}
            <rect
              x="22"
              y="22"
              width="56"
              height="56"
              stroke="white"
              strokeOpacity="0.20"
              strokeWidth="1.5"
              fill="none"
            />
            {/* The same square at 45°, which together make the eight points. */}
            <rect
              x="22"
              y="22"
              width="56"
              height="56"
              stroke="white"
              strokeOpacity="0.20"
              strokeWidth="1.5"
              fill="none"
              transform="rotate(45 50 50)"
            />
            {/* The small linking diamond at each corner of the tile. */}
            <path
              d="M0 0 L8 0 L0 8 Z M100 0 L92 0 L100 8 Z M0 100 L8 100 L0 92 Z M100 100 L92 100 L100 92 Z"
              fill="white"
              fillOpacity="0.10"
            />
          </pattern>

          {/* Fades the lattice out towards the lower right so the panel reads as
              lit from the top left rather than as flat wallpaper. */}
          <radialGradient id="hn-fade" cx="30%" cy="26%" r="82%">
            <stop offset="0%" stopColor="white" stopOpacity="0.95" />
            <stop offset="60%" stopColor="white" stopOpacity="0.45" />
            <stop offset="100%" stopColor="white" stopOpacity="0.05" />
          </radialGradient>

          <mask id="hn-mask">
            <rect width="400" height="400" fill="url(#hn-fade)" />
          </mask>
        </defs>

        <rect width="400" height="400" fill="url(#hn-khatam)" mask="url(#hn-mask)" />

        {/*
          One large rosette, anchored off the bottom-right corner and cropped by
          it. Centred, it sat directly behind the figures — "BDT 4,796,100" read
          across two circles and a rotated square, and no amount of opacity
          fixes type crossing a line at right angles to it. Cropped at the
          corner it does what a focal point is for: it gives the eye somewhere
          to rest *away* from the words.
        */}
        <g
          stroke="white"
          strokeWidth="1.75"
          fill="none"
          transform="translate(352 356)"
        >
          <circle r="104" strokeOpacity="0.16" />
          <circle r="78" strokeOpacity="0.22" />
          {[0, 45, 90, 135].map((angle) => (
            <rect
              key={angle}
              x="-70"
              y="-70"
              width="140"
              height="140"
              strokeOpacity="0.24"
              transform={`rotate(${angle})`}
            />
          ))}
        </g>
      </svg>

      {/*
        Depth, from a lit top-left and a shaded bottom-right. The highlight is
        emerald rather than white: white sat exactly where the figures are and
        took the contrast under them below what white type needs.
      */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-emerald-900/30 blur-3xl" />

    </div>
  );
}
