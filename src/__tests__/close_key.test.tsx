// ⌘W (2026-11-03) — with several terminal sessions it closes the chosen session first; the window closes
// only when the screen does not take the key. macOS gets the key from the app menu (`CloseKeyPressed`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ close: vi.fn(async () => {}), closeKey: null as null | (() => void) }));
vi.mock("@/api/window", () => ({
  windowApi: {
    closeThisWindow: h.close,
    newWindow: async () => {},
    onCloseKey: async (cb: () => void) => {
      h.closeKey = cb;
      return () => {
        h.closeKey = null;
      };
    },
  },
}));

import { closeByKey, interceptCloseKey, useWindowKeys } from "@/hooks/useWindowKeys";
import { __setPlatformForTests } from "@/lib/platform";

afterEach(() => {
  cleanup();
  h.close.mockClear();
  __setPlatformForTests(null);
});

describe("close key", () => {
  it("a screen that takes the key keeps the window open; otherwise the window closes", () => {
    let sessions = 2;
    const closed: number[] = [];
    const release = interceptCloseKey(() => {
      if (sessions < 2) return false;
      closed.push(sessions--);
      return true;
    });
    closeByKey();
    expect(closed).toEqual([2]);
    expect(h.close).not.toHaveBeenCalled();
    closeByKey(); // one session left → the window
    expect(h.close).toHaveBeenCalledTimes(1);
    release();
    sessions = 5;
    closeByKey(); // released → straight to the window
    expect(h.close).toHaveBeenCalledTimes(2);
  });

  it("releasing an old interceptor does not drop a newer one", () => {
    const first = interceptCloseKey(() => true);
    const second = interceptCloseKey(() => true);
    first();
    closeByKey();
    expect(h.close).not.toHaveBeenCalled();
    second();
  });

  it("macOS listens for the menu's close key and routes it through closeByKey", async () => {
    __setPlatformForTests("mac");
    const onClose = vi.fn();
    renderHook(() => useWindowKeys({ onClose, onNewWindow: () => {} }));
    await vi.waitFor(() => expect(h.closeKey).not.toBeNull());
    h.closeKey!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
