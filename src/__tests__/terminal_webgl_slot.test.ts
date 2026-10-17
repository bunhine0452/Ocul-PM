/**
 * 안 보이는 터미널의 WebGL 컨텍스트 반납 (2026-10-18).
 *
 * 설치본 3.5일 가동에서 WebContent 의 그래픽 메모리가 1.2~1.5GB 였다. 터미널은
 * 비활성 탭·다른 프로젝트 탭·확대에 가려진 페인으로 숨어도 마운트를 유지하고,
 * 한 번 열린 페인은 WebGL 컨텍스트(드로잉 버퍼 + 아틀라스 페이지 텍스처 사본)를
 * 언마운트될 때까지 쥐고 있었다. `WebglSlot` 이 지켜야 할 것:
 *
 *  1) 숨은 지 `HIDE_RELEASE_MS` 가 지나면 컨텍스트를 반납한다
 *  2) 그 전에 다시 보이면 아무것도 바꾸지 않는다 (탭 왕복에 재생성 비용 없음)
 *  3) 다시 보이면 다시 붙인다 — 컨텍스트를 잃었던 경우도 여기서 되살아난다
 *  4) 불러오는 사이 숨거나 정리되면 붙이지 않는다 (숨은 채 컨텍스트를 쥐지 않게)
 *  5) dispose 예외는 삼킨다 (A0d — 정리에서 throw 하면 앱이 빈 화면이 된다)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { HIDE_RELEASE_MS, WebglSlot, type WebglAddonLike } from "@/features/terminal/webglRenderer";

function fakeAddon() {
  let lost: (() => void) | null = null;
  const addon: WebglAddonLike & { disposed: number; lose(): void } = {
    disposed: 0,
    activate() {},
    dispose() {
      addon.disposed += 1;
    },
    onContextLoss(cb: () => void) {
      lost = cb;
      return { dispose() {} };
    },
    lose() {
      lost?.();
    },
  };
  return addon;
}

function setup() {
  const made: ReturnType<typeof fakeAddon>[] = [];
  const term = { element: {} as HTMLElement | undefined, loadAddon: vi.fn() };
  const slot = new WebglSlot(async () => {
    const a = fakeAddon();
    made.push(a);
    return a;
  });
  return { made, term, slot };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("WebglSlot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("보이면 붙이고, 이미 붙어 있으면 다시 만들지 않는다", async () => {
    const { made, term, slot } = setup();
    slot.show(term);
    await flush();
    slot.show(term);
    await flush();
    expect(made).toHaveLength(1);
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(slot.active).toBe(true);
  });

  it("숨은 지 한참 지나면 컨텍스트를 반납한다", async () => {
    const { made, term, slot } = setup();
    slot.show(term);
    await flush();
    slot.hide();
    vi.advanceTimersByTime(HIDE_RELEASE_MS - 1);
    expect(made[0]!.disposed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(made[0]!.disposed).toBe(1);
    expect(slot.active).toBe(false);
  });

  it("반납 전에 다시 보이면 그대로 둔다 — 탭 왕복에 재생성 비용이 없다", async () => {
    const { made, term, slot } = setup();
    slot.show(term);
    await flush();
    slot.hide();
    vi.advanceTimersByTime(HIDE_RELEASE_MS / 2);
    slot.show(term);
    vi.advanceTimersByTime(HIDE_RELEASE_MS * 2);
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0]!.disposed).toBe(0);
  });

  it("반납한 뒤 다시 보이면 새로 붙인다", async () => {
    const { made, term, slot } = setup();
    slot.show(term);
    await flush();
    slot.hide();
    vi.advanceTimersByTime(HIDE_RELEASE_MS);
    slot.show(term);
    await flush();
    expect(made).toHaveLength(2);
    expect(slot.active).toBe(true);
  });

  it("컨텍스트를 잃으면 놓고(DOM 렌더러), 다음에 보일 때 되살린다", async () => {
    const { made, term, slot } = setup();
    slot.show(term);
    await flush();
    made[0]!.lose();
    expect(made[0]!.disposed).toBe(1);
    expect(slot.active).toBe(false);
    slot.show(term);
    await flush();
    expect(made).toHaveLength(2);
  });

  it("불러오는 사이 숨어 반납 시점이 지났거나 정리됐으면 붙이지 않는다", async () => {
    const { term } = setup();
    let release: (a: WebglAddonLike) => void = () => {};
    const slot = new WebglSlot(() => new Promise((r) => (release = r)));
    slot.show(term);
    slot.dispose();
    const late = fakeAddon();
    release(late);
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
    expect(slot.active).toBe(false);
  });

  it("정리의 dispose 예외는 삼킨다", async () => {
    const { term } = setup();
    const slot = new WebglSlot(async () => ({
      activate() {},
      dispose() {
        throw new Error("_core._store");
      },
      onContextLoss: () => ({ dispose() {} }),
    }));
    slot.show(term);
    await flush();
    expect(() => slot.dispose()).not.toThrow();
    expect(slot.active).toBe(false);
  });

  it("열리지 않은(element 없는) 터미널에는 붙이지 않는다", async () => {
    const { made, term, slot } = setup();
    term.element = undefined;
    slot.show(term);
    await flush();
    expect(made).toHaveLength(0);
  });

  it("반납할 때 컨텍스트를 바로 잃게 한다 — 드로잉 버퍼를 GC 까지 쥐지 않게", async () => {
    const { term, slot } = setup();
    const loseContext = vi.fn();
    const gl = { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext } : null) };
    const webglCanvas = { getContext: (t: string) => (t === "webgl2" ? gl : null) };
    const layer2d = { getContext: () => null };
    term.element = { querySelectorAll: () => [webglCanvas, layer2d] } as unknown as HTMLElement;
    slot.show(term);
    await flush();
    slot.hide();
    vi.advanceTimersByTime(HIDE_RELEASE_MS);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
