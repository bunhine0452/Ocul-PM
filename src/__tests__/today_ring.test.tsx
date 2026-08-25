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
    const { container, rerender, getByText } = render(
      <TodayActivityRing {...props(2)} errorCycles={0} />,
    );
    expect(container.querySelector(".today-ring-err")).toBeNull();
    rerender(<TodayActivityRing {...props(2)} errorCycles={2} />);
    expect(getByText("⚠2")).toBeInTheDocument();
  });
});
