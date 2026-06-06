import { useEffect, useRef, useState } from "react";

// Advanced Today UI — a live "aperture" of today's activity. The Ocul-PM
// concentric arcs surround today's recorded-work count; **each time a new entry
// is recorded** (the count increments via Today's real-time refresh) the ring
// replays a sweep + a ripple ripples outward, so the brand motif visibly
// "reacts" to the agent working. Idle: static (no distracting constant spin).

interface TodayActivityRingProps {
  /** Today's recorded-work count (brief.changedToday). */
  count: number;
  size?: number;
}

export function TodayActivityRing({ count, size = 76 }: TodayActivityRingProps) {
  const prev = useRef<number | null>(null);
  // Bumped on every increment → re-keys the animated layers so their one-shot
  // CSS animations replay (a new record = a fresh sweep + ripple).
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (prev.current !== null && count > prev.current) {
      setPulse((p) => p + 1);
    }
    prev.current = count;
  }, [count]);

  return (
    <div className="today-ring" style={{ width: size, height: size }}>
      {pulse > 0 ? <span key={`ripple-${pulse}`} className="today-ring-ripple" /> : null}
      <svg
        key={`arcs-${pulse}`}
        viewBox="0 0 76 76"
        className="today-ring-svg"
        fill="none"
        aria-hidden="true"
      >
        <g strokeLinecap="round" strokeWidth="5" fill="none">
          <circle className="tra o" cx="38" cy="38" r="31" pathLength={100} strokeDasharray="72 28" stroke="var(--accent)" />
          <circle className="tra m" cx="38" cy="38" r="22" pathLength={100} strokeDasharray="60 40" stroke="var(--accent-strong)" />
          <circle className="tra i" cx="38" cy="38" r="13" pathLength={100} strokeDasharray="46 54" stroke="var(--accent-text)" />
        </g>
      </svg>
      <span className="today-ring-count" aria-label={`오늘 ${count}건 기록`}>
        {count}
      </span>
    </div>
  );
}
