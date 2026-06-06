import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// Advanced Today UI — the concentric-arc activity ring pulses (ripple) only
// when today's recorded-work count *increments* (a new entry recorded), not on
// equal/decreasing re-renders.

import { TodayActivityRing } from "@/features/today/TodayActivityRing";

afterEach(() => cleanup());

describe("TodayActivityRing", () => {
  it("shows the count and no ripple initially", () => {
    const { container, getByText } = render(<TodayActivityRing count={2} />);
    expect(getByText("2")).toBeInTheDocument();
    expect(container.querySelector(".today-ring-ripple")).toBeNull();
  });

  it("ripples when the count increments (new record)", async () => {
    const { container, rerender, getByText } = render(<TodayActivityRing count={2} />);
    rerender(<TodayActivityRing count={3} />);
    await waitFor(() => {
      expect(container.querySelector(".today-ring-ripple")).not.toBeNull();
    });
    expect(getByText("3")).toBeInTheDocument();
  });

  it("does not ripple on an unchanged or lower count", async () => {
    const { container, rerender } = render(<TodayActivityRing count={4} />);
    rerender(<TodayActivityRing count={4} />); // same
    rerender(<TodayActivityRing count={1} />); // lower (e.g. workday rollover)
    await waitFor(() => {
      expect(container.querySelector(".today-ring-ripple")).toBeNull();
    });
  });
});
