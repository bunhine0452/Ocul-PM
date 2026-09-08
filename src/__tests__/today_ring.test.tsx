import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// Advanced Today UI — the concentric-arc activity ring pulses (ripple) only
// when today's recorded-work count *increments* (a new entry recorded), not on
// equal/decreasing re-renders. The center shows the journal count; the three
// rings (journals / files / line-churn) are hover-only detail.

import { TodayActivityRing } from "@/features/today/TodayActivityRing";

afterEach(() => cleanup());

/** Build ring props from a journal count, holding the other metrics fixed so
 *  the ripple/center assertions stay focused on `changedToday`. */
function props(changedToday: number) {
  return {
    changedToday,
    filesTouched: 3,
    linesAdded: 40,
    linesRemoved: 10,
    errorCycles: 0,
  };
}

describe("TodayActivityRing", () => {
  it("shows the count and no ripple initially", () => {
    const { container, getByText } = render(<TodayActivityRing {...props(2)} />);
    expect(getByText("2")).toBeInTheDocument();
    expect(container.querySelector(".today-ring-ripple")).toBeNull();
  });

  it("ripples when the count increments (new record)", async () => {
    const { container, rerender, getByText } = render(<TodayActivityRing {...props(2)} />);
    rerender(<TodayActivityRing {...props(3)} />);
    await waitFor(() => {
      expect(container.querySelector(".today-ring-ripple")).not.toBeNull();
    });
    expect(getByText("3")).toBeInTheDocument();
  });

  it("does not ripple on an unchanged or lower count", async () => {
    const { container, rerender } = render(<TodayActivityRing {...props(4)} />);
    rerender(<TodayActivityRing {...props(4)} />); // same
    rerender(<TodayActivityRing {...props(1)} />); // lower (e.g. workday rollover)
    await waitFor(() => {
      expect(container.querySelector(".today-ring-ripple")).toBeNull();
    });
  });


  // 2026-08-25 — salvaged from fix/today-ring-line-delta-and-audit. That branch
  // was abandoned when main redid the line-delta work on a different schema
  // (69b1cc5); these four findings landed in neither.

  it("names itself with role=img — aria-label is ignored on a bare div", () => {
    const { container } = render(<TodayActivityRing {...props(2)} />);
    const ring = container.querySelector(".today-ring");
    // `aria-label` is prohibited on the implicit `generic` role, so without an
    // explicit role the whole widget is silent: the svg is aria-hidden and the
    // tooltip is mouse-only. axe does not flag the bare-div case.
    expect(ring?.getAttribute("role")).toBe("img");
    expect(ring?.getAttribute("aria-label")).toBeTruthy();
  });

  it("keeps the hover tooltip out of the a11y tree (not a live region)", () => {
    const { container } = render(<TodayActivityRing {...props(2)} />);
    fireEvent.mouseEnter(container.querySelectorAll(".tr-hit")[0]);
    const tip = container.querySelector(".today-ring-tip");
    expect(tip).not.toBeNull();
    // As role="status" this announced on every pointer sweep across the ring.
    expect(tip?.getAttribute("role")).toBeNull();
    expect(tip?.getAttribute("aria-hidden")).toBe("true");
  });

  // The ripple's animationend unmount is NOT covered here. jsdom runs no CSS
  // animations so animationend never fires naturally, and a synthesized one
  // never reaches React 19's onAnimationEnd (measured: fireEvent default,
  // fireEvent with bubbles:true, and a manual dispatchEvent all invoked the
  // handler zero times). The implementation is onAnimationEnd → setPulse(null)
  // in TodayActivityRing; only a real browser can verify it.

  it("groups thousands in the hover values", () => {
    const { container, getByText } = render(
      <TodayActivityRing {...props(2)} linesAdded={12345} linesRemoved={6789} />,
    );
    fireEvent.mouseEnter(container.querySelectorAll(".tr-hit")[2]); // outer → inner: lines last
    expect(getByText("+12,345 / −6,789")).toBeInTheDocument();
  });

  it("draws one arc per non-zero metric, and none for a zero one", () => {
    // A zero metric used to still emit its arc <circle> with a zero-length
    // dash — under the group's round linecap SVG renders that as a dot, so a
    // day with no recorded line churn showed a stray dot at 12 o'clock.
    const { container, rerender } = render(<TodayActivityRing {...props(2)} />);
    expect(container.querySelectorAll(".tr-arc")).toHaveLength(3);

    rerender(<TodayActivityRing {...props(2)} linesAdded={0} linesRemoved={0} />);
    expect(container.querySelectorAll(".tr-arc")).toHaveLength(2);
    // the faint tracks + hit areas stay — only the value arc goes away.
    expect(container.querySelectorAll(".tr-track")).toHaveLength(3);
    expect(container.querySelectorAll(".tr-hit")).toHaveLength(3);

    rerender(
      <TodayActivityRing {...props(0)} filesTouched={0} linesAdded={0} linesRemoved={0} />,
    );
    expect(container.querySelectorAll(".tr-arc")).toHaveLength(0);
  });

  it("shows an error badge only when there are error cycles", () => {
    const { container, rerender } = render(
      <TodayActivityRing {...props(2)} errorCycles={0} />,
    );
    expect(container.querySelector(".today-ring-err")).toBeNull();
    rerender(<TodayActivityRing {...props(2)} errorCycles={2} />);
    // 경고 표시는 맨 글리프(⚠)가 아니라 선화 아이콘 + 숫자다 ({#glyph-to-icon}) —
    // 텍스트로 단언하면 아이콘을 글자로 되돌리는 순간 통과해 버린다.
    const badge = container.querySelector(".today-ring-err");
    expect(badge).not.toBeNull();
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.textContent).toContain("2");
  });

  it("keeps the count out of the badge's box so it stays centred", () => {
    // The two used to share an inline-flex row, so the *pair* was centred and
    // the number drifted left by half the badge on any day with an error cycle.
    // The badge is absolutely positioned now; the number is the lone grid item.
    const { container } = render(<TodayActivityRing {...props(17)} errorCycles={3} />);
    const num = container.querySelector(".today-ring-num");
    expect(num?.textContent).toBe("17");
    expect(num?.querySelector(".today-ring-err")).toBeNull();
    expect(container.querySelector(".today-ring-center > .today-ring-err")).not.toBeNull();
  });

  // --- arc geometry -------------------------------------------------------
  // `stroke-dasharray` is not the whole arc: the group's `stroke-linecap:
  // round` paints half a stroke width past *each* dash end, a real length in
  // the 0-100 viewBox. Converted into the pathLength=100 space that overshoot
  // scales with 1/r, so the same dash closes a small ring long before a big
  // one. `.tr-arc.on` widens the hovered stroke to 8.5, which is the worst
  // case the clamp has to survive.
  const CAP_SW = 8.5;

  /** Visible arc length in pathLength=100 units, caps included. */
  function paintedLength(arc: Element): number {
    const dash = Number(arc.getAttribute("stroke-dasharray")?.split(" ")[0]);
    const r = Number(arc.getAttribute("r"));
    return dash + 2 * ((CAP_SW / 2) / (2 * Math.PI * r)) * 100;
  }

  it("never paints a full circle, however large the metrics get", () => {
    // At the old flat 0.97 clamp the innermost ring painted 102.1% of its own
    // circle: the tail cap rode over the head cap and it rendered as a solid
    // ring. Every day past ~7,500 lines of churn then looked identical.
    const { container } = render(
      <TodayActivityRing
        changedToday={100_000}
        filesTouched={100_000}
        linesAdded={5_000_000}
        linesRemoved={5_000_000}
        errorCycles={0}
      />,
    );
    const arcs = [...container.querySelectorAll(".tr-arc")];
    expect(arcs).toHaveLength(3);
    for (const arc of arcs) {
      // 10° of track must survive — a hairline gap still reads as closed.
      expect(paintedLength(arc)).toBeLessThanOrEqual(100 - (10 / 360) * 100 + 1e-9);
    }
  });

  it("clamps each ring by its own radius, not one shared ceiling", () => {
    const { container } = render(
      <TodayActivityRing
        changedToday={100_000}
        filesTouched={100_000}
        linesAdded={5_000_000}
        linesRemoved={5_000_000}
        errorCycles={0}
      />,
    );
    const [outer, mid, inner] = [...container.querySelectorAll(".tr-arc")].map((a) =>
      Number(a.getAttribute("stroke-dasharray")?.split(" ")[0]),
    );
    // Smaller radius → costlier caps → a strictly lower dash ceiling.
    expect(outer).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(inner);
    // …yet all three land on the same painted length, so a saturated day reads
    // as three concentric arcs that stop together rather than a closing coil.
    const painted = [...container.querySelectorAll(".tr-arc")].map(paintedLength);
    for (const p of painted) expect(p).toBeCloseTo(painted[0], 6);
  });
});
