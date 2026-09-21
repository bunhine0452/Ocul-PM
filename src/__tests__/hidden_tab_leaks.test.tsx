/**
 * 숨은 프로젝트 탭으로 새는 것들 (2026-09-21).
 *
 * 크롬식 탭은 한 번 연 프로젝트 탭을 **마운트한 채 숨긴다**(`display:none`). 그래서
 * "창에 하나만 반응해야 하는 것"이 탭 수만큼 발화한다 — 이 파일은 그 두 사건의
 * 회귀 테스트다.
 *
 *  1. 터미널 ⌘D — `always` 스코프가 포커스를 묻지 않아 A 탭의 ⌘D 가 열려 있는
 *     모든 탭의 터미널을 함께 쪼갰다. 이제 레이아웃 사각형이 있는 면만 듣는다.
 *  2. 새 일지 토스트 「열기」 — 숨은 탭(B)의 프로바이더가 띄운 토스트를 누르면 창
 *     전역 `openEntity` 버스를 **활성 탭(A)** 이 받아 A 의 일지 화면으로 갔다. 이제
 *     프로젝트 앞으로 건 요청(`lib/entryJump`) + 그 탭 활성화다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";

// ── 백엔드 이벤트·커맨드 — 테스트가 직접 쏘고 센다 ───────────────────────────
const fx = vi.hoisted(() => ({
  journalAdded: [] as Array<(e: { payload: unknown }) => void>,
  openProjectTab: vi.fn(async (_id: number, _win: string | null) => ({ status: "ok", data: null })),
}));
vi.mock("@/lib/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "openProjectTab"
          ? fx.openProjectTab
          : () => Promise.resolve({ status: "ok", data: null }),
    },
  ),
  events: new Proxy(
    {},
    {
      get: (_t, prop) => ({
        listen: (cb: (e: { payload: unknown }) => void) => {
          if (prop === "oculpmJournalAdded") fx.journalAdded.push(cb);
          return Promise.resolve(() => {});
        },
      }),
    },
  ),
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    getStatus: async () => ({
      initialized: true,
      config_valid: true,
      lock_state: { held_by_us: true },
      current_workday: "20260921",
      watcher_state: "running",
      watcher_dropped_total: 0,
      watcher_user_paused: false,
    }),
  },
}));

import { useTerminalKeys, type TerminalKeyActions } from "@/features/terminal/terminalSurface/useTerminalKeys";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { consumeEntryJump, onEntryJump, resetEntryJump } from "@/lib/entryJump";
import { getToasts } from "@/lib/toast";
import { NAV_BUS } from "@/lib/navRegistry";

function keyActions(over: Partial<TerminalKeyActions> = {}): TerminalKeyActions {
  return {
    addTab: vi.fn(),
    closeFocusedPane: vi.fn(),
    splitFocused: vi.fn(),
    openSearch: vi.fn(),
    closeSearch: vi.fn(),
    clearScreen: vi.fn(),
    gotoBlock: vi.fn(),
    fontDelta: vi.fn(),
    fontReset: vi.fn(),
    toggleZoom: vi.fn(),
    searchOpen: false,
    keyboardScope: "always",
    ownsNewTab: false,
    ...over,
  };
}

/** 터미널 화면 하나 — `visible` 이면 레이아웃 사각형이 있는 척한다 (jsdom 은 늘 비어 있다). */
function Surface({ actions, visible }: { actions: TerminalKeyActions; visible: boolean }) {
  const rootRef = useTerminalKeys(actions);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.getClientRects = (visible ? () => [{}] : () => []) as never;
  }, [rootRef, visible]);
  return <div ref={rootRef} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("terminal ⌘D — only the surface that is laid out splits", () => {
  it("an `always`-scoped surface in a hidden tab (no layout) ignores ⌘D", () => {
    const hidden = keyActions();
    render(<Surface actions={hidden} visible={false} />);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(hidden.splitFocused).not.toHaveBeenCalled();
  });

  it("with two tabs mounted, only the visible one splits", () => {
    const active = keyActions();
    const background = keyActions();
    render(
      <>
        <Surface actions={active} visible />
        <Surface actions={background} visible={false} />
      </>,
    );
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(active.splitFocused).toHaveBeenCalledTimes(1);
    expect(active.splitFocused).toHaveBeenCalledWith("row");
    expect(background.splitFocused).not.toHaveBeenCalled();
    // ⇧⌘D 도 같은 게이트를 지난다.
    fireEvent.keyDown(window, { key: "d", metaKey: true, shiftKey: true });
    expect(active.splitFocused).toHaveBeenLastCalledWith("col");
    expect(background.splitFocused).not.toHaveBeenCalled();
  });

  it("a visible dock (`focused`) still yields when focus is outside it", () => {
    const dock = keyActions({ keyboardScope: "focused" });
    render(<Surface actions={dock} visible />);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(dock.splitFocused).not.toHaveBeenCalled();
  });
});

describe("new-entry toast Open — goes to that project's tab", () => {
  beforeEach(() => {
    resetEntryJump();
    fx.journalAdded.length = 0;
  });

  function added(projectId: number, relativePath: string) {
    act(() => {
      for (const cb of fx.journalAdded) {
        cb({
          payload: {
            project_id: projectId,
            summary: { relative_path: relativePath, title: "T", type: "feature", agent_id: "x" },
          },
        });
      }
    });
  }

  async function mountTwoTabs() {
    render(
      <>
        <WorkspaceProvider projectId={1}>
          <span />
        </WorkspaceProvider>
        <WorkspaceProvider projectId={2}>
          <span />
        </WorkspaceProvider>
      </>,
    );
    // 구독은 마운트 이펙트에서 붙는다.
    await act(async () => {});
    expect(fx.journalAdded.length).toBeGreaterThanOrEqual(2);
  }

  it("an entry in hidden tab B requests B's jump and activates B's tab — never the window bus", async () => {
    await mountTwoTabs();
    const bus = vi.fn();
    window.addEventListener(NAV_BUS.openEntity, bus);
    const tabA = vi.fn();
    const tabB = vi.fn();
    const offA = onEntryJump(1, tabA);
    const offB = onEntryJump(2, tabB);

    added(2, "journal/20260921/Feature/x.md");
    const mine = getToasts().filter((t) => t.actions?.length);
    // 프로젝트 2 의 프로바이더만 띄운다 (1 은 남의 일지라 조용하다).
    expect(mine).toHaveLength(1);
    act(() => mine[0].actions?.[0].onClick());

    expect(tabB).toHaveBeenCalledWith("journal/20260921/Feature/x.md");
    expect(tabA).not.toHaveBeenCalled();
    expect(bus).not.toHaveBeenCalled();
    expect(fx.openProjectTab).toHaveBeenCalledWith(2, null);

    window.removeEventListener(NAV_BUS.openEntity, bus);
    offA();
    offB();
  });

  it("a request with no shell yet stays parked for the mount-time pickup", async () => {
    await mountTwoTabs();
    added(2, "journal/20260921/Bug/y.md");
    const mine = getToasts().filter((t) => t.actions?.length);
    act(() => mine[mine.length - 1].actions?.[0].onClick());
    expect(consumeEntryJump(1)).toBeNull();
    expect(consumeEntryJump(2)).toBe("journal/20260921/Bug/y.md");
  });
});
