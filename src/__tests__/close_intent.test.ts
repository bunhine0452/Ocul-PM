import { describe, expect, it } from "vitest";
import { registerCloseHandler, runCloseIntent } from "@/lib/closeIntent";

// ⌘W 의 "안쪽부터 닫기" 사슬.

describe("runCloseIntent", () => {
  it("falls through to the caller when nobody consumes", () => {
    expect(runCloseIntent()).toBe(false);
  });

  /** 나중에 등록한 것이 더 안쪽이다 — 그쪽이 먼저 답해야 한다. */
  it("asks the most recently registered handler first", () => {
    const order: string[] = [];
    const offOuter = registerCloseHandler(() => {
      order.push("outer");
      return false;
    });
    const offInner = registerCloseHandler(() => {
      order.push("inner");
      return true;
    });

    expect(runCloseIntent()).toBe(true);
    expect(order).toEqual(["inner"]);

    offInner();
    offOuter();
  });

  it("stops asking once a handler consumes", () => {
    let outerCalls = 0;
    const offOuter = registerCloseHandler(() => {
      outerCalls += 1;
      return false;
    });
    const offInner = registerCloseHandler(() => true);

    runCloseIntent();
    expect(outerCalls).toBe(0);

    offInner();
    offOuter();
  });

  /** 마지막 세션 탭을 닫으면 그 처리기는 다음부터 빠진다 — 순회 중 목록이
      바뀌어도 남은 처리기를 건너뛰면 안 된다. */
  it("survives a handler that unregisters itself while running", () => {
    const seen: string[] = [];
    const offOuter = registerCloseHandler(() => {
      seen.push("outer");
      return true;
    });
    let offInner = () => {};
    offInner = registerCloseHandler(() => {
      seen.push("inner");
      offInner();
      return false;
    });

    expect(runCloseIntent()).toBe(true);
    expect(seen).toEqual(["inner", "outer"]);

    offOuter();
  });
});
