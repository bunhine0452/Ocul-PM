import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

// Advanced Today UI — a live "aperture" of today's activity. Three concentric,
// independently-hoverable arcs each encode one of today's metrics (work
// journals / changed files / line churn); the center shows today's recorded-work
// count with an error-cycle badge. **Each time a new entry is recorded** (the
// journal count increments) the ring replays a ripple so the brand motif
// visibly "reacts" to the agent working. Idle: static (no distracting spin).
//
// Arc fill uses a saturating curve (value / (value + k)) rather than a strict
// ratio — there's no reliable per-metric historical max for files/line-churn,
// and the exact number lives in each ring's hover tooltip anyway. Busier day →
// fuller ring, which is the read we want.

interface TodayActivityRingProps {
  /** Today's recorded-work count (brief.changedToday). */
  changedToday: number;
  /** Σ files touched across today's entries (brief.filesTouched). */
  filesTouched: number;
  /** Σ bytes added / removed across today's entries. */
  bytesAdded: number;
  bytesRemoved: number;
  /** Count of today's error-cycle entries (brief.errorCycles). */
  errorCycles: number;
  size?: number;
}

type RingId = "journals" | "files" | "lines";

/** Saturating 0→~1 mapping so bigger values read as a fuller arc without
 *  needing a historical maximum. `k` is the value at which the ring is ~half. */
function fillFraction(value: number, k: number): number {
  if (value <= 0) return 0;
  return Math.min(0.97, value / (value + k));
}

export function TodayActivityRing({
  changedToday,
  filesTouched,
  bytesAdded,
  bytesRemoved,
  errorCycles,
  size = 128,
}: TodayActivityRingProps) {
  const prev = useRef<number | null>(null);
  // Bumped on every increment → re-keys the ripple so its one-shot CSS
  // animation replays (a new record = a fresh ripple).
  const [pulse, setPulse] = useState(0);
  const [hover, setHover] = useState<RingId | null>(null);

  useEffect(() => {
    if (prev.current !== null && changedToday > prev.current) {
      setPulse((p) => p + 1);
    }
    prev.current = changedToday;
  }, [changedToday]);

  const lineChurn = bytesAdded + bytesRemoved;

  // Outer → inner. r/sw are in the 0–100 viewBox; arcs start at 12 o'clock via
  // the group rotate(-90).
  const rings: {
    id: RingId;
    r: number;
    cls: string;
    fraction: number;
    label: string;
    value: string;
  }[] = [
    {
      id: "journals",
      r: 44,
      cls: "o",
      fraction: fillFraction(changedToday, 4),
      label: t("today.ring.entries"),
      value: `${changedToday}`,
    },
    {
      id: "files",
      r: 33,
      cls: "m",
      fraction: fillFraction(filesTouched, 8),
      label: t("today.ring.files"),
      value: `${filesTouched}`,
    },
    {
      id: "lines",
      r: 22,
      cls: "i",
      fraction: fillFraction(lineChurn, 160),
      label: t("today.ring.lines"),
      value: `+${bytesAdded} / −${bytesRemoved}`,
    },
  ];

  const active = rings.find((r) => r.id === hover) ?? null;

  return (
    <div
      className="today-ring"
      style={{ width: size, height: size }}
      aria-label={t("today.ring.aria", { entries: changedToday, files: filesTouched, added: bytesAdded, removed: bytesRemoved })}
    >
      {pulse > 0 ? <span key={`ripple-${pulse}`} className="today-ring-ripple" /> : null}
      <svg viewBox="0 0 100 100" className="today-ring-svg" fill="none" aria-hidden="true">
        <g transform="rotate(-90 50 50)" strokeLinecap="round" fill="none">
          {rings.map((ring) => (
            <g key={ring.id}>
              {/* faint full-circle track */}
              <circle className="tr-track" cx="50" cy="50" r={ring.r} strokeWidth={7} />
              {/* value arc — dash encodes the fraction (pathLength 100) */}
              <circle
                className={"tr-arc " + ring.cls + (hover === ring.id ? " on" : "")}
                cx="50"
                cy="50"
                r={ring.r}
                strokeWidth={7}
                pathLength={100}
                strokeDasharray={`${ring.fraction * 100} 100`}
              />
              {/* wide transparent hit area so the whole band is hoverable. No
                  <title> here — the custom .today-ring-tip carries hover detail
                  and the container aria-label covers screen readers; a <title>
                  would also duplicate the "N개/건" text into the a11y tree. */}
              <circle
                className="tr-hit"
                cx="50"
                cy="50"
                r={ring.r}
                strokeWidth={11}
                onMouseEnter={() => setHover(ring.id)}
                onMouseLeave={() => setHover((h) => (h === ring.id ? null : h))}
              />
            </g>
          ))}
        </g>
      </svg>

      <span className="today-ring-center">
        {changedToday}
        {errorCycles > 0 ? (
          <span className="today-ring-err" title={t("today.ring.errorCycles", { n: errorCycles })}>
            ⚠{errorCycles}
          </span>
        ) : null}
      </span>

      {active ? (
        <div className="today-ring-tip" role="status">
          <span className="today-ring-tip-label">{active.label}</span>
          <span className="today-ring-tip-value">{active.value}</span>
        </div>
      ) : null}
    </div>
  );
}
