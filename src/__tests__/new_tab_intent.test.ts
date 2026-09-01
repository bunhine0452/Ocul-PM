/**
 * ⌘T 의 "안쪽부터 열기" 사슬 (2026-09-01).
 *
 * 회귀 방지의 핵심: `⌘T` 는 앱 메뉴 액셀러레이터라 macOS 가 웹뷰보다 먼저
 * 먹어치운다 — 터미널이 걸어 둔 keydown 은 한 번도 돌지 않았고, 셸에
 * 타이핑하다 ⌘T 를 눌러도 **프로젝트 탭**이 열렸다. 그래서 판정은 keydown 이
 * 아니라 이 사슬에 있어야 한다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNewTabHandler, runNewTabIntent } from "@/lib/newTabIntent";
import { registerCloseHandler } from "@/lib/closeIntent";

const off: Array<() => void> = [];
const register = (handler: () => boolean, scope?: () => HTMLElement | null) => {
  off.push(registerNewTabHandler(handler, scope));
};

afterEach(() => {
  off.splice(0).forEach((fn) => fn());
  document.body.innerHTML = "";
});

describe("runNewTabIntent", () => {
  it("아무도 안 받으면 false — 창이 평소대로 시작 탭을 연다", () => {
    expect(runNewTabIntent()).toBe(false);
  });

  it("포커스를 품은 면이 먼저 답한다 (도크는 다른 화면 위에 얹혀 있다)", () => {
    const el = document.createElement("div");
    const input = document.createElement("input");
    el.appendChild(input);
    document.body.appendChild(el);

    const terminal = vi.fn(() => true);
    const later = vi.fn(() => true);
    register(terminal, () => el);
    register(later); // 더 나중 = 평소라면 먼저 답한다
    input.focus();

    expect(runNewTabIntent()).toBe(true);
    expect(terminal).toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it("포커스가 터미널 밖이면 소비하지 않는다 — 프로젝트 탭이 열려야 한다", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // 터미널이 실제로 거는 조건 그대로: 포커스가 자기 안에 없으면 사양한다.
    register(() => el.contains(document.activeElement), () => el);
    (document.activeElement as HTMLElement | null)?.blur();

    expect(runNewTabIntent()).toBe(false);
  });

  /** ⌘W 와 ⌘T 는 다른 사슬이다 — 섞이면 한쪽 키가 남의 처리기를 부른다. */
  it("닫기 사슬과 섞이지 않는다", () => {
    const closer = vi.fn(() => true);
    const offClose = registerCloseHandler(closer);
    expect(runNewTabIntent()).toBe(false);
    expect(closer).not.toHaveBeenCalled();
    offClose();
  });
});

describe("⌘T 는 keydown 이 아니라 인텐트로 온다", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

  /**
   * 소스 가드. keydown 분기를 되살리면 macOS 에서는 여전히 죽어 있고(메뉴가
   * 먼저 먹는다) 다른 플랫폼에서는 인텐트와 겹쳐 **탭이 두 개** 열린다.
   */
  it("터미널은 ⌘T keydown 을 잡지 않고 사슬에 등록한다", () => {
    const src = read("features/terminal/TerminalSurface.tsx");
    expect(src).toContain("registerNewTabHandler");
    expect(src).not.toMatch(/k === "t"/);
  });

  it("창은 인텐트를 듣고, 아무도 안 받을 때만 시작 탭을 연다", () => {
    const src = read("windows/TabbedWindow.tsx");
    expect(src).toContain("events.newTabIntent");
    expect(src).toContain("if (runNewTabIntent()) return;");
  });

  it("분리 터미널 창도 인텐트를 듣는다 (그 창엔 프로젝트 탭이 없다)", () => {
    const src = read("windows/TerminalWindow.tsx");
    expect(src).toContain("events.newTabIntent");
    expect(src).toContain("ownsNewTab");
  });
});
