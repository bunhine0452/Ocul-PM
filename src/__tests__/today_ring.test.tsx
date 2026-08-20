import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

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
