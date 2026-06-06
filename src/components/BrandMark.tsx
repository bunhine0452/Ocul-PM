// Brand mark — the Ocul-PM app icon (public/icon.svg) rendered inline as a
// self-contained logo tile (green rounded bg + concentric arcs + dot). Single
// source of truth shared with the OS/dock icon, so the in-app brand never
// drifts from the installed icon. Use for header/brand spots (sidebar, hero,
// wizard). For loading/activity motifs see OculSpinner / TodayActivityRing.

interface BrandMarkProps {
  /** Rendered px (square). */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <img
      src="/icon.svg"
      width={size}
      height={size}
      alt="Ocul-PM"
      draggable={false}
      className={className}
      style={{ display: "block", borderRadius: Math.round(size * 0.24) }}
    />
  );
}
