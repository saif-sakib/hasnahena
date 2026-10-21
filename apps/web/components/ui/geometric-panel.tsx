/**
 * The hero's fallback illustration — an eight-point khatam tessellation in
 * inline SVG (theme colours, no request, no licence). Shown only when all four
 * hero figures are blank; the caller sets the aspect ratio.
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
      // Decorative only.
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
          {/* One 100×100 tile with an inscribed 80×80 star, so tiles read as a lattice. */}
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

        {/* One rosette cropped at the corner, away from any text. */}
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

      {/* Depth: emerald highlight top-left (white would cut contrast under text). */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-emerald-900/30 blur-3xl" />

    </div>
  );
}
