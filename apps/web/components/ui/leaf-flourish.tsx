/**
 * A hasnahena (night-blooming jasmine) sprig, the decorative flourish behind
 * marketing sections — its five-point bloom echoes the khatam stars. Inline SVG,
 * coloured by `currentColor`, aria-hidden; size and placement are the caller's
 * (placed absolutely and cropped by the section).
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
        {/* The stem: one cubic. */}
        <path d="M26 254 C 44 190, 62 148, 96 108 C 122 78, 150 52, 174 34" strokeWidth="2.5" />

        {/* A single side-shoot, so the sprig has somewhere for the eye to go
            that is not the tip. */}
        <path d="M74 138 C 96 132, 118 138, 138 156" strokeWidth="1.75" />

        {LEAVES.map(({ x, y, angle, scale }, index) => (
          <g key={index} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
            {/* A lanceolate leaf with a half-weight midrib. */}
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
            {/* The bloom, filled slightly stronger than the leaves. */}
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

/** Leaf positions: alternating sides, shrinking towards the tip, no two alike. */
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
