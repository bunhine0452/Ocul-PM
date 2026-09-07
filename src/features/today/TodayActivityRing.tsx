import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

// Advanced Today UI — a live "aperture" of today's activity. Three concentric,
// independently-hoverable arcs each encode one of today's metrics (work
// journals / changed files / line churn — the churn is counted from the
// per-entry diff sidecars, not frontmatter); the center shows today's recorded-work
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
  /** Σ lines added / removed across today's entries (from the diff sidecars). */
  linesAdded: number;
  linesRemoved: number;
  /** Count of today's error-cycle entries (brief.errorCycles). */
  errorCycles: number;
  size?: number;
}

type RingId = "journals" | "files" | "lines";

// Arc geometry. Radii are in the 0-100 viewBox; the dash lives in a
// pathLength=100 space, but the group's round linecap paints *past* both dash
// ends by half the stroke width — a real length in viewBox units. The smaller
// the ring, the larger that overshoot is as a share of its own circumference
// (r=22 pays 2.5 dash-units per cap, r=44 only 1.3), so one flat clamp cannot
// keep all three arcs open. At the old shared 0.97 the innermost ring drew
// 102% of its circle: the tail rode over the head and it rendered as a solid
// closed ring, so every day past ~7.5k lines of churn looked identical.
const R_OUTER = 44;
const R_MID = 33;
const R_INNER = 22;
const ARC_SW = 7;
/** `.tr-arc.on` thickens the hovered arc and the cap grows with it, so the
 *  clamp is computed at the widest stroke — otherwise hover alone closes it. */
const ARC_SW_HOVER = 8.5;
/** Track the two caps must leave unpainted. "Almost everything" has to stay
 *  visibly short of "everything"; 10° is ~10px of track at the default size. */
const MIN_GAP_DEG = 10;

/** Dash length one round cap adds beyond its end, in pathLength=100 units. */
function capUnits(r: number): number {
  return ((ARC_SW_HOVER / 2) / (2 * Math.PI * r)) * 100;
}

/** Largest dash fraction that still leaves MIN_GAP_DEG of visible track on a
 *  ring of radius `r`, once both caps are paid for. */
function maxFraction(r: number): number {
  return Math.max(0, (100 - 2 * capUnits(r) - (MIN_GAP_DEG / 360) * 100) / 100);
}

/** Saturating 0→~1 mapping so bigger values read as a fuller arc without
 *  needing a historical maximum. `k` is the value at which the ring is ~half. */
function fillFraction(value: number, k: number, r: number): number {
  if (value <= 0) return 0;
  return Math.min(maxFraction(r), value / (value + k));
}

export function TodayActivityRing({
  changedToday,
  filesTouched,
  linesAdded,
  linesRemoved,
  errorCycles,
  size = 128,
}: TodayActivityRingProps) {
  const prev = useRef<number | null>(null);
  // Monotonic sequence → a fresh `key` per pulse so the one-shot CSS animation
  // replays. `pulse` is cleared on animationend so the span actually leaves the
  // DOM instead of lingering forever at opacity 0 (animation-fill-mode:
  // forwards). Under prefers-reduced-motion the span is `display: none`, so no
  // animationend fires and it stays mounted-but-hidden — harmless.
  const seq = useRef(0);
  const [pulse, setPulse] = useState<number | null>(null);
  const [hover, setHover] = useState<RingId | null>(null);

  useEffect(() => {
    if (prev.current !== null && changedToday > prev.current) {
      seq.current += 1;
      setPulse(seq.current);
    }
    prev.current = changedToday;
  }, [changedToday]);

  const lineChurn = linesAdded + linesRemoved;
  const n = (v: number) => v.toLocaleString();

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
      r: R_OUTER,
      cls: "o",
      fraction: fillFraction(changedToday, 4, R_OUTER),
      label: t("today.ring.entries"),
      value: n(changedToday),
    },
    {
      id: "files",
      r: R_MID,
      cls: "m",
      fraction: fillFraction(filesTouched, 8, R_MID),
      label: t("today.ring.files"),
      value: n(filesTouched),
    },
    {
      id: "lines",
      r: R_INNER,
      cls: "i",
      fraction: fillFraction(lineChurn, 400, R_INNER),
      label: t("today.ring.lines"),
      value: `+${n(linesAdded)} / −${n(linesRemoved)}`,
    },
  ];

  const active = rings.find((r) => r.id === hover) ?? null;

  return (
    <div
      className="today-ring"
      style={{ width: size, height: size }}
      /* `role="img"` is load-bearing, not decoration: `aria-label` is *prohibited*
         on a bare <div> (implicit role `generic`), so without it the whole ring —
         svg aria-hidden, tooltip mouse-only — is silent to a screen reader. axe
         does not flag the bare-div case, which is why this slipped through a
         green a11y suite. `img` also prunes the descendants, so the label below
         is the single announced string for the widget. */
      role="img"
      aria-label={t("today.ring.aria", { entries: changedToday, files: filesTouched, added: linesAdded, removed: linesRemoved })}
    >
      {pulse !== null ? (
        <span
          key={`ripple-${pulse}`}
          className="today-ring-ripple"
          onAnimationEnd={() => setPulse(null)}
        />
      ) : null}
      <svg viewBox="0 0 100 100" className="today-ring-svg" fill="none" aria-hidden="true">
        <g transform="rotate(-90 50 50)" strokeLinecap="round" fill="none">
          {rings.map((ring) => (
            <g key={ring.id}>
              {/* faint full-circle track */}
              <circle className="tr-track" cx="50" cy="50" r={ring.r} strokeWidth={ARC_SW} />
              {/* value arc — dash encodes the fraction (pathLength 100).
                  Skipped entirely at zero: a zero-length dash under the group's
                  round linecap renders as a *dot* (the SVG dotted-line trick),
                  which read as a stray artifact floating at 12 o'clock on any
                  metric that was 0. Nothing is the honest zero. */}
              {ring.fraction > 0 ? (
                <circle
                  className={"tr-arc " + ring.cls + (hover === ring.id ? " on" : "")}
                  cx="50"
                  cy="50"
                  r={ring.r}
                  strokeWidth={ARC_SW}
                  pathLength={100}
                  strokeDasharray={`${ring.fraction * 100} 100`}
                />
              ) : null}
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

      {/* The count owns the geometric centre. It used to share an inline-flex row
          with the error badge, so the *pair* was centred and the number itself
          drifted left by half the badge (~10px of a 128px ring) on any day that
          had an error cycle. The badge is out of flow now — it hangs under the
          number, inside the innermost arc — so the number sits dead centre
          whether or not the badge is there. */}
      <span className="today-ring-center">
        <span className="today-ring-num">{changedToday}</span>
        {errorCycles > 0 ? (
          <span className="today-ring-err" title={t("today.ring.errorCycles", { n: errorCycles })}>
            ⚠{errorCycles}
          </span>
        ) : null}
      </span>

      {/* Mouse-only detail — `role="status"` made this a live region, so merely
          sweeping the pointer across the ring fired a screen reader
          announcement. The numbers reach assistive tech through the container's
          aria-label (and again as text in the stat row below). */}
      {active ? (
        <div className="today-ring-tip" aria-hidden="true">
          <span className="today-ring-tip-label">{active.label}</span>
          <span className="today-ring-tip-value">{active.value}</span>
        </div>
      ) : null}
    </div>
  );
}
