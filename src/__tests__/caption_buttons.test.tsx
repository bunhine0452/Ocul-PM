// Windows caption buttons (2026-11-10) — the window has no OS title bar, so the app draws
// minimize · maximize/restore · close. macOS keeps the OS traffic lights; Linux the native bar.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";

const h = vi.hoisted(() => ({
  maximized: false,
  asks: 0,
  resized: [] as Array<() => void>,
  unlistened: 0,
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    minimize: h.minimize,
    toggleMaximize: h.toggleMaximize,
    closeThisWindow: h.close,
    isMaximized: async () => {
      h.asks += 1;
      return h.maximized;
    },
    onResized: async (cb: () => void) => {
      h.resized.push(cb);
      return () => {
        h.unlistened += 1;
      };
    },
  },
}));

import { CaptionButtons, MAXIMIZED_SYNC_DEBOUNCE_MS } from "@/windows/CaptionButtons";
import { ko } from "@/i18n/ko";
import { __setPlatformForTests } from "@/lib/platform";

afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
  h.maximized = false;
  h.asks = 0;
  h.resized = [];
  h.unlistened = 0;
  h.minimize.mockClear();
  h.toggleMaximize.mockClear();
  h.close.mockClear();
});

describe("caption buttons", () => {
  it("mac (OS traffic lights) and Linux (native title bar) draw nothing", () => {
    for (const os of ["mac", "linux"] as const) {
      __setPlatformForTests(os);
      const { container, unmount } = render(<CaptionButtons />);
      expect(container.innerHTML, os).toBe("");
      unmount();
    }
  });

  it("Windows draws minimize · maximize · close, out of the tab order", async () => {
    __setPlatformForTests("windows");
    const { container } = render(<CaptionButtons />);
    const group = screen.getByRole("group", { name: ko["caption.group"] });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      ko["caption.minimize"],
      ko["caption.maximize"],
      ko["caption.close"],
    ]);
    expect(buttons.map((b) => b.dataset.caption)).toEqual(["min", "max", "close"]);
    for (const b of buttons) expect(b.tabIndex).toBe(-1);
    // jsdom has no layout for color-contrast; the row floats over the window, not inside a landmark.
    const res = await axe(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });

  it("each button drives the window; close goes through the guarded close command", () => {
    __setPlatformForTests("windows");
    render(<CaptionButtons />);
    fireEvent.click(screen.getByRole("button", { name: ko["caption.minimize"] }));
    fireEvent.click(screen.getByRole("button", { name: ko["caption.maximize"] }));
    fireEvent.click(screen.getByRole("button", { name: ko["caption.close"] }));
    expect(h.minimize).toHaveBeenCalledTimes(1);
    expect(h.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("follows the window: maximized shows restore, a resize back shows maximize", async () => {
    __setPlatformForTests("windows");
    h.maximized = true;
    const { unmount } = render(<CaptionButtons />);
    const restore = await screen.findByRole("button", { name: ko["caption.restore"] });
    expect(restore.dataset.caption).toBe("restore");

    // snapped back / restored by double-click — no button press, only a resize event
    h.maximized = false;
    await act(async () => {
      for (const cb of h.resized) cb();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: ko["caption.maximize"] }).dataset.caption).toBe("max"));

    unmount();
    await waitFor(() => expect(h.unlistened).toBe(1));
  });

  it("a window drag (a resize event per frame) asks the window once, after it settles", async () => {
    __setPlatformForTests("windows");
    vi.useFakeTimers();
    try {
      render(<CaptionButtons />);
      await act(async () => {});
      expect(h.asks).toBe(1); // first paint asks at once
      await act(async () => {
        for (let frame = 0; frame < 60; frame++) {
          for (const cb of h.resized) cb();
          vi.advanceTimersByTime(16);
        }
      });
      expect(h.asks).toBe(1);
      await act(async () => void vi.advanceTimersByTime(MAXIMIZED_SYNC_DEBOUNCE_MS));
      expect(h.asks).toBe(2); // was 61 (one isMaximized IPC per resize event)
    } finally {
      vi.useRealTimers();
    }
  });
});
