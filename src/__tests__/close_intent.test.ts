import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("runCloseIntent — 포커스 우선권", () => {
  /**
   * 겹쳐 떠 있는 면(터미널 도크 위/아래)에서 등록 순서만 보면 사용자가 지금
   * 보고 있는 것과 무관한 쪽이 ⌘W 를 먹는다. 포커스를 품은 쪽이 먼저다.
   */
  const mount = () => {
    const el = document.createElement("div");
    const input = document.createElement("input");
    el.appendChild(input);
    document.body.appendChild(el);
    return { el, input };
  };

  // 사슬은 모듈 전역이다 — 정리하지 않으면 앞 테스트의 등록이 뒤 테스트의
  // 순서를 바꾼다 (증상이 "왜 이 처리기가 안 불렸지" 로만 보여 추적이 어렵다).
  const off: Array<() => void> = [];
  const register = (handler: () => boolean, scope?: () => HTMLElement | null) => {
    off.push(registerCloseHandler(handler, scope));
  };

  afterEach(() => {
    off.splice(0).forEach((fn) => fn());
    document.body.innerHTML = "";
  });

  it("포커스를 품은 쪽이 나중에 등록된 쪽을 이긴다", () => {
    const scoped = vi.fn(() => true);
    const later = vi.fn(() => true);
    const { el, input } = mount();
    register(scoped, () => el);
    register(later); // 더 나중 = 평소라면 먼저 답한다
    input.focus();

    expect(runCloseIntent()).toBe(true);
    expect(scoped).toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it("포커스가 밖이면 평소 순서 그대로다 — 뒤 화면이 받는다", () => {
    const scoped = vi.fn(() => true);
    const later = vi.fn(() => true);
    const { el } = mount();
    register(scoped, () => el);
    register(later);
    (document.activeElement as HTMLElement | null)?.blur();

    expect(runCloseIntent()).toBe(true);
    expect(later).toHaveBeenCalled();
    expect(scoped).not.toHaveBeenCalled();
  });

  it("포커스를 품었어도 닫을 것이 없다고 하면 다음으로 넘어간다", () => {
    const scoped = vi.fn(() => false);
    const other = vi.fn(() => true);
    const { el, input } = mount();
    register(other);
    register(scoped, () => el);
    input.focus();

    expect(runCloseIntent()).toBe(true);
    expect(scoped).toHaveBeenCalled();
    expect(other).toHaveBeenCalled();
  });

  it("scope 가 사라진 등록은 포커스 우선권을 잃는다 (언마운트된 면)", () => {
    const scoped = vi.fn(() => true);
    register(scoped, () => null);
    expect(runCloseIntent()).toBe(true);
    expect(scoped).toHaveBeenCalled();
  });
});
