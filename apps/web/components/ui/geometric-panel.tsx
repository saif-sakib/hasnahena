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
 */
export function GeometricPanel({ className }: { className?: string }) {
  return (
    <div
      className={[
        'relative aspect-square w-full overflow-hidden rounded-[2rem]',
        'bg-linear-to-br from-emerald-600 via-emerald-500 to-teal-500',
        'shadow-2xl shadow-emerald-900/20 ring-1 ring-white/20',
        className ?? '',
      ].join(' ')}
      // Decorative: it carries no information the surrounding copy does not.
      // Announcing "geometric pattern" to a screen reader adds noise to a page
      // whose headline is two lines below it.
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
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
              strokeOpacity="0.28"
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
              strokeOpacity="0.28"
              strokeWidth="1.5"
              fill="none"
              transform="rotate(45 50 50)"
            />
            {/* The small linking diamond at each corner of the tile. */}
            <path
              d="M0 0 L8 0 L0 8 Z M100 0 L92 0 L100 8 Z M0 100 L8 100 L0 92 Z M100 100 L92 100 L100 92 Z"
              fill="white"
              fillOpacity="0.14"
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

        {/* A single large rosette, centred, as the focal point. */}
        <g
          stroke="white"
          strokeOpacity="0.55"
          strokeWidth="2"
          fill="none"
          transform="translate(200 200)"
        >
          <circle r="96" strokeOpacity="0.25" />
          <circle r="72" strokeOpacity="0.35" />
          {[0, 45, 90, 135].map((angle) => (
            <rect key={angle} x="-64" y="-64" width="128" height="128" transform={`rotate(${angle})`} />
          ))}
        </g>
      </svg>

      {/* A soft highlight in the top-left corner, for depth. */}
      <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
    </div>
  );
}
