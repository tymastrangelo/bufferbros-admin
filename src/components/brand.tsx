/* Brand pieces: logo lockups, the spinning car wheel that replaces every boring
   spinner, and the once-per-session splash screen. The logo artwork is white,
   so these live on ink-dark surfaces. */
/* eslint-disable @next/next/no-img-element */

export function LogoFull({ className }: { className?: string }) {
  return <img src="/brand/logo-full.png" alt="Buffer Bros — Professional Detailing" className={className} />;
}

export function LogoCar({ className }: { className?: string }) {
  return <img src="/brand/logo-car.png" alt="" aria-hidden className={className} />;
}

/** A car wheel: the tire stays put, the rim spins. */
export function Wheel({ size = 28, className = "" }: { size?: number; className?: string }) {
  const spokes = Array.from({ length: 5 }, (_, i) => i * 72);
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="status"
      aria-label="Loading"
    >
      {/* tire */}
      <circle cx="24" cy="24" r="20.5" fill="none" stroke="#1d2634" strokeWidth="6.5" />
      {/* tread glint */}
      <circle
        cx="24"
        cy="24"
        r="20.5"
        fill="none"
        stroke="#3b4c63"
        strokeWidth="1.4"
        strokeDasharray="10 119"
        strokeLinecap="round"
      />
      {/* rim + spokes — this part rotates */}
      <g className="wheel-spin" style={{ transformOrigin: "24px 24px" }}>
        <circle cx="24" cy="24" r="14.5" fill="none" stroke="#c9d3df" strokeWidth="2.4" />
        {spokes.map((deg) => (
          <g key={deg} transform={`rotate(${deg} 24 24)`}>
            <path d="M22.9 24 L21.6 10.6 M25.1 24 L26.4 10.6" stroke="#c9d3df" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        ))}
        <circle cx="24" cy="24" r="4.6" fill="#c9d3df" />
        <circle cx="24" cy="24" r="2.2" fill="#2563eb" />
        {/* valve stem so the spin reads at a glance */}
        <circle cx="24" cy="11.4" r="1.5" fill="#8b93a1" />
      </g>
    </svg>
  );
}

// Splash lives in splash.tsx (client component — remount-safe).
