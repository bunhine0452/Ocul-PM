// Concentric-arc loading spinner — the Ocul-PM brand motif (3 arcs + dot) in
// motion. Each arc rotates at a different speed/direction (the "aperture"
// breathing). Uses `var(--primary)` (green, defined in App.css :root so it
// resolves on both the shadcn dashboard and the ui_v2 shell). Replaces bare
// "불러오는 중…" text spinners. See App.css `@keyframes ocul*` for the motion.

interface OculSpinnerProps {
  size?: number;
  className?: string;
  /** Optional label rendered under the spinner (centered column). */
  label?: string;
}

export function OculSpinner({ size = 28, className, label }: OculSpinnerProps) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={label ?? "불러오는 중"}
      style={{ display: "block" }}
    >
      <g stroke="var(--primary)" strokeWidth={2} strokeLinecap="round">
        <circle className="ocul-spin-arc a1" cx="12" cy="12" r="10" pathLength={100} strokeDasharray="66 34" opacity={0.3} />
        <circle className="ocul-spin-arc a2" cx="12" cy="12" r="6.6" pathLength={100} strokeDasharray="60 40" opacity={0.55} />
        <circle className="ocul-spin-arc a3" cx="12" cy="12" r="3.3" pathLength={100} strokeDasharray="52 48" opacity={0.9} />
      </g>
      <circle cx="12" cy="12" r="1.5" fill="var(--primary)" />
    </svg>
  );

  if (!label) return className ? <span className={className}>{svg}</span> : svg;

  return (
    <div
      className={"ocul-loading" + (className ? " " + className : "")}
    >
      {svg}
      <span className="ocul-loading-label">{label}</span>
    </div>
  );
}
