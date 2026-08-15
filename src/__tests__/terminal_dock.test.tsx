/**
 * 터미널 도크 (2026-08-15) — 어느 화면에서나 뜨는 셸 + 창으로 분리.
 *
 * 프런트에서 검증 가능한 것들:
 *  - 크기 클램프 — 도크가 콘텐츠를 완전히 밀어내지 못한다 (되돌릴 길이 사라짐)
 *  - 세션 소유권 — 분리 창이 떠 있는 동안 이 창은 터미널 탭 목록을 덮지 않고,
 *    돌아올 때 디스크에서 다시 읽는다 (두 창이 같은 영속 키를 쓴다)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import {
  WorkspaceProvider,
  useWorkspace,
  storageKeyFor,
  clampDockSize,
  TERMINAL_DOCK_MIN,
  TERMINAL_DOCK_MIN_REST,
  type TerminalTab,
} from "@/contexts/WorkspaceContext";
import { DEFAULTS, KEYS, keyForField, entriesToSettings } from "@/lib/settings";
import {
  clampTermFont,
  TERM_FONT_MIN,
  TERM_FONT_MAX,
  TERM_FONT_DEFAULT,
} from "@/features/terminal/fontSize";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

// ─── 터미널 글자 크기 (앱 전역 설정) ──────────────────────────────────────

describe("터미널 글자 크기", () => {
  it("범위 밖 입력은 잘라낸다", () => {
    expect(clampTermFont(0)).toBe(TERM_FONT_MIN);
    expect(clampTermFont(999)).toBe(TERM_FONT_MAX);
    expect(clampTermFont(14.6)).toBe(15);
    expect(clampTermFont(Number.NaN)).toBe(TERM_FONT_DEFAULT);
  });

  /**
   * 2026-08-15 — 프로젝트별 워크스페이스(localStorage)에서 앱 전역
   * 설정(SQLite)으로 옮겼다. 설정 화면은 프로젝트가 없을 때도 열리고, 창을
   * 여러 개 띄워도 한 값이어야 한다.
   */
  it("SQLite 설정 키로 왕복한다", () => {
    expect(KEYS.terminalFontSize).toBe("terminal_font_size");
    expect(keyForField("terminalFontSize")).toBe("terminal_font_size");
    expect(DEFAULTS.terminalFontSize).toBe(TERM_FONT_DEFAULT);
    // 저장된 문자열이 숫자로 되돌아온다 (settings 테이블은 전부 문자열이다).
    expect(entriesToSettings([["terminal_font_size", "17"]]).terminalFontSize).toBe(17);
  });

  it("과거 프로젝트 레코드의 키는 읽을 때 버린다 (일방향)", () => {
    localStorage.setItem(
      storageKeyFor(3),
      JSON.stringify({ uiV2View: "today", terminalFontSize: 19 }),
    );
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    const r = render(
      <WorkspaceProvider projectId={3}>
        <Probe onReady={(c) => (ctx = c)} />
      </WorkspaceProvider>,
    );
    expect((ctx!.state as unknown as Record<string, unknown>).terminalFontSize).toBeUndefined();
    r.unmount();
    expect(JSON.parse(localStorage.getItem(storageKeyFor(3))!).terminalFontSize).toBeUndefined();
  });
});

describe("도크 크기 클램프", () => {
  it("하한 밑으로는 못 줄인다 — xterm 이 한 줄도 못 그리는 도크는 고장으로 보인다", () => {
    expect(clampDockSize(0, 800)).toBe(TERMINAL_DOCK_MIN);
    expect(clampDockSize(-500, 800)).toBe(TERMINAL_DOCK_MIN);
  });

  it("화면 쪽 자리를 남긴다 — 끝까지 끌어도 콘텐츠가 사라지지 않는다", () => {
    expect(clampDockSize(10_000, 800)).toBe(800 - TERMINAL_DOCK_MIN_REST);
  });

  it("범위 안이면 그대로 (정수로)", () => {
    expect(clampDockSize(300.4, 800)).toBe(300);
  });

  /** 레이아웃 전(컨테이너 0)에는 상한을 알 수 없다 — 하한만 적용한다. */
  it("컨테이너를 모르면 하한만 본다", () => {
    expect(clampDockSize(9999, 0)).toBe(9999);
    expect(clampDockSize(10, 0)).toBe(TERMINAL_DOCK_MIN);
  });

  /** 창이 아주 작으면 하한과 '남길 자리'가 충돌한다 — 하한이 이긴다. */
  it("컨테이너가 하한보다 작아도 무너지지 않는다", () => {
    expect(clampDockSize(500, 100)).toBe(TERMINAL_DOCK_MIN);
  });

  it("판독 불가능한 값은 하한으로", () => {
    expect(clampDockSize(Number.NaN, 800)).toBe(TERMINAL_DOCK_MIN);
  });
});

// ─── 분리 창과의 세션 소유권 ──────────────────────────────────────────────

function Probe({ onReady }: { onReady: (ctx: ReturnType<typeof useWorkspace>) => void }) {
  const ctx = useWorkspace();
  onReady(ctx);
  return <span data-testid="tabs">{ctx.state.terminalTabs.map((t) => t.id).join(",")}</span>;
}

const tab = (id: string): TerminalTab => ({ id, label: id, shell: "zsh", cwd: "/x" });

function readTabs(projectId: number): string[] {
  const raw = localStorage.getItem(storageKeyFor(projectId));
  return raw ? (JSON.parse(raw).terminalTabs ?? []).map((t: TerminalTab) => t.id) : [];
}

describe("분리 창이 떠 있는 동안의 터미널 세션", () => {
  /**
   * 핵심 회귀: 분리 창이 새 탭을 만들어 저장한 뒤, 앱 창이 (화면 전환 같은)
   * 아무 상태나 저장하면 예전에는 **낡은 탭 목록으로 덮어썼다**. 되돌아왔을 때
   * 분리 창에서 만든 셸이 통째로 사라지는 경로다.
   */
  it("앱 창은 분리 중에 터미널 탭 목록을 덮어쓰지 않는다", () => {
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    const r = render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={(c) => (ctx = c)} />
      </WorkspaceProvider>,
    );

    // 떠나기 전 상태 — 탭 하나.
    act(() => ctx!.setState((prev) => ({ ...prev, terminalTabs: [tab("p9-aaa")] })));
    act(() => ctx!.setTerminalDetached(true));

    // 분리 창이 탭을 하나 더 만들어 디스크에 남겼다 (그쪽이 지금 주인).
    const stored = JSON.parse(localStorage.getItem(storageKeyFor(9)) ?? "{}");
    localStorage.setItem(
      storageKeyFor(9),
      JSON.stringify({ ...stored, terminalTabs: [tab("p9-aaa"), tab("p9-bbb")] }),
    );

    // 앱 창이 관계없는 상태를 바꾼다 → 저장이 돈다.
    act(() => ctx!.setUiV2View("planner"));
    r.unmount(); // 디바운스 flush

    expect(readTabs(9)).toEqual(["p9-aaa", "p9-bbb"]);
    expect(JSON.parse(localStorage.getItem(storageKeyFor(9))!).uiV2View).toBe("planner");
  });

  it("되돌아오면 분리 창이 남긴 탭 목록을 다시 읽는다", () => {
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={(c) => (ctx = c)} />
      </WorkspaceProvider>,
    );

    act(() => ctx!.setState((prev) => ({ ...prev, terminalTabs: [tab("p9-aaa")] })));
    act(() => ctx!.setTerminalDetached(true));

    const stored = JSON.parse(localStorage.getItem(storageKeyFor(9)) ?? "{}");
    localStorage.setItem(
      storageKeyFor(9),
      JSON.stringify({
        ...stored,
        terminalTabs: [tab("p9-aaa"), tab("p9-bbb")],
        terminalActiveId: "p9-bbb",
      }),
    );

    act(() => ctx!.setTerminalDetached(false));

    expect(ctx!.state.terminalTabs.map((t) => t.id)).toEqual(["p9-aaa", "p9-bbb"]);
    expect(ctx!.state.terminalActiveId).toBe("p9-bbb");
    expect(ctx!.state.terminalDetached).toBe(false);
  });

  /**
   * 반대 방향의 같은 사고: 분리 창은 셸만 안다. 통째로 저장하면 사용자가 앱
   * 창에서 옮긴 화면이 **떼어낼 때의 화면으로 되돌아간다.**
   */
  it("분리 창은 터미널 세션만 쓰고 나머지는 디스크 값을 남긴다", () => {
    // 앱 창이 남긴 레코드 — 화면은 플래너, 터미널 탭은 하나.
    localStorage.setItem(
      storageKeyFor(9),
      JSON.stringify({ uiV2View: "planner", terminalTabs: [tab("p9-aaa")] }),
    );

    let win: ReturnType<typeof useWorkspace> | null = null;
    const r = render(
      <WorkspaceProvider projectId={9} persistScope="terminal">
        <Probe onReady={(c) => (win = c)} />
      </WorkspaceProvider>,
    );

    // 그 사이 앱 창이 화면을 옮겼다 (디스크가 최신).
    const disk = JSON.parse(localStorage.getItem(storageKeyFor(9))!);
    localStorage.setItem(storageKeyFor(9), JSON.stringify({ ...disk, uiV2View: "retro" }));

    // 분리 창이 탭을 하나 더 만든다 → 저장이 돈다.
    act(() =>
      win!.setState((prev) => ({
        ...prev,
        terminalTabs: [tab("p9-aaa"), tab("p9-bbb")],
        terminalActiveId: "p9-bbb",
      })),
    );
    r.unmount();

    const saved = JSON.parse(localStorage.getItem(storageKeyFor(9))!);
    expect(saved.uiV2View).toBe("retro");
    expect(readTabs(9)).toEqual(["p9-aaa", "p9-bbb"]);
    expect(saved.terminalActiveId).toBe("p9-bbb");
  });

  /** 창의 존재 여부가 진실이다 — 지난 실행의 값을 믿고 시작하면 안 된다. */
  it("분리 상태는 영속되지 않는다", () => {
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    const r = render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={(c) => (ctx = c)} />
      </WorkspaceProvider>,
    );
    act(() => ctx!.setTerminalDetached(true));
    r.unmount();

    expect(JSON.parse(localStorage.getItem(storageKeyFor(9))!).terminalDetached).toBeUndefined();

    let next: ReturnType<typeof useWorkspace> | null = null;
    render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={(c) => (next = c)} />
      </WorkspaceProvider>,
    );
    expect(next!.state.terminalDetached).toBe(false);
  });

  /** 도크의 자리·크기는 반대로 기억해야 한다 (매번 다시 고르게 하면 안 된다). */
  it("도크의 열림·자리·크기는 영속된다", () => {
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    const r = render(
      <WorkspaceProvider projectId={4}>
        <Probe onReady={(c) => (ctx = c)} />
      </WorkspaceProvider>,
    );
    act(() =>
      ctx!.setState((prev) => ({
        ...prev,
        terminalDockOpen: true,
        terminalDockPos: "left",
        terminalDockWidth: 520,
      })),
    );
    r.unmount();

    let next: ReturnType<typeof useWorkspace> | null = null;
    render(
      <WorkspaceProvider projectId={4}>
        <Probe onReady={(c) => (next = c)} />
      </WorkspaceProvider>,
    );
    expect(next!.state.terminalDockOpen).toBe(true);
    expect(next!.state.terminalDockPos).toBe("left");
    expect(next!.state.terminalDockWidth).toBe(520);
  });
});
