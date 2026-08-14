import { describe, expect, it } from "vitest";
import { busyReason, onBusyChange, registerBusy } from "@/lib/busyGuard";

// 업데이트 재시작이 "지금 끊어도 되나"를 물어보는 등록소.

describe("busyGuard", () => {
  it("is idle when nobody registered", () => {
    expect(busyReason()).toBeNull();
  });

  it("reports the reason while something is busy", () => {
    const off = registerBusy(() => "answering");
    expect(busyReason()).toBe("answering");
    off();
    expect(busyReason()).toBeNull();
  });

  /** 등록만으로 바쁜 게 아니라, 그 순간 바쁜지 물어봐야 한다. */
  it("asks each registrant rather than assuming", () => {
    let working = false;
    const off = registerBusy(() => (working ? "still going" : null));
    expect(busyReason()).toBeNull();
    working = true;
    expect(busyReason()).toBe("still going");
    off();
  });

  /** 기다리던 재시작이 깨어나는 통로 — 구독이 없으면 폴링밖에 없다. */
  it("notifies subscribers when registration changes", () => {
    let ticks = 0;
    const stop = onBusyChange(() => {
      ticks += 1;
    });

    const off = registerBusy(() => null);
    expect(ticks).toBe(1);
    off();
    expect(ticks).toBe(2);

    stop();
    registerBusy(() => null)();
    expect(ticks).toBe(2);
  });
});
