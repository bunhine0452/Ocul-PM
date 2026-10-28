/**
 * 멀티 프로젝트 창 — 창 하나 = 프로젝트 하나 (4.0).
 *
 * 프런트에서 검증 가능한 것들:
 *  - 라우팅 — 창 갈래는 URL 이 정하고 런타임에 바뀌지 않는다
 *  - R3    — 창 두 개가 같은 localStorage 레코드를 덮어쓰지 않는다 (키 분리)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import { parseWindowRoute, FIRST_WINDOW } from "@/lib/windowRoute";
import {
  WorkspaceProvider,
  useWorkspace,
  storageKeyFor,
  migrateSingleKeyToPerProject,
  WORKSPACE_SCHEMA_VERSION,
  SIDEBAR_KEY,
} from "@/contexts/WorkspaceContext";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

// ─── 창 라우팅 (main.tsx 3갈래 분기) ──────────────────────────────────────

describe("창 라우팅", () => {
  it("?tray=1 은 트레이 갈래", () => {
    expect(parseWindowRoute("?tray=1")).toEqual({ kind: "tray" });
  });

  it("?win=win-2 는 앱 창 갈래 (프로젝트는 백엔드에 묻는다)", () => {
    expect(parseWindowRoute("?win=win-2")).toEqual({
      kind: "window",
      label: "win-2",
      view: null,
      entryPath: null,
    });
  });

  it("트레이 딥링크로 열린 창은 목적지를 URL 로 받는다", () => {
    expect(
      parseWindowRoute("?win=win-1&view=journal&entry=journal%2F20260812%2FBugs%2Fa.md"),
    ).toEqual({
      kind: "window",
      label: "win-1",
      view: "journal",
      entryPath: "journal/20260812/Bugs/a.md",
    });
  });

  /** 첫 창(`main`)은 URL 파라미터 없이 뜬다 — tauri.conf.json 이 만든다. */
  it("파라미터가 없으면 첫 창", () => {
    expect(parseWindowRoute("")).toEqual({
      kind: "window",
      label: FIRST_WINDOW,
      view: null,
      entryPath: null,
    });
  });

  /** 판독 불가능한 라벨을 들고 들어가면 그 창의 프로젝트 조회가 빗나간다. */
  it("판독 불가능한 win 값은 첫 창으로 떨어진다", () => {
    for (const bad of ["?win=abc", "?win=", "?win=win-", "?win=window-1", "?win=win-1x"]) {
      expect(parseWindowRoute(bad)).toMatchObject({ kind: "window", label: FIRST_WINDOW });
    }
  });

  it("tray 가 win 보다 우선한다", () => {
    expect(parseWindowRoute("?tray=1&win=win-2")).toEqual({ kind: "tray" });
  });

});

// ─── 영속 키 분리 (R3) ────────────────────────────────────────────────────

describe("워크스페이스 영속 키", () => {
  it("프로젝트마다 다른 키를 쓴다", () => {
    expect(storageKeyFor(1)).not.toBe(storageKeyFor(2));
    expect(storageKeyFor(3)).toBe("aipm:workspace:v2:p3");
  });
});

describe("v1 단일 키 → 프로젝트별 키 이관", () => {
  it("currentProjectId 가 있으면 그 프로젝트의 키로 옮기고 원본을 지운다", () => {
    const record = JSON.stringify({ schemaVersion: 3, currentProjectId: 7, uiV2View: "planner" });
    localStorage.setItem("aipm:workspace:v1", record);

    expect(migrateSingleKeyToPerProject()).toBe(7);

    expect(localStorage.getItem("aipm:workspace:v1")).toBeNull();
    expect(localStorage.getItem(storageKeyFor(7))).toBe(record);
  });

  it("currentProjectId 가 null 이면 (런처 상태) 이관하지 않고 버린다", () => {
    localStorage.setItem(
      "aipm:workspace:v1",
      JSON.stringify({ schemaVersion: 3, currentProjectId: null, uiV2View: "planner" }),
    );

    expect(migrateSingleKeyToPerProject()).toBeNull();
    expect(localStorage.getItem("aipm:workspace:v1")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("이미 새 레코드가 있으면 덮어쓰지 않는다", () => {
    localStorage.setItem(storageKeyFor(7), JSON.stringify({ uiV2View: "diff" }));
    localStorage.setItem(
      "aipm:workspace:v1",
      JSON.stringify({ currentProjectId: 7, uiV2View: "planner" }),
    );

    migrateSingleKeyToPerProject();

    expect(JSON.parse(localStorage.getItem(storageKeyFor(7))!).uiV2View).toBe("diff");
  });

  it("멱등 — 원본 키가 없으면 아무 일도 하지 않는다", () => {
    expect(migrateSingleKeyToPerProject()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

// ─── 프로바이더 격리 (창 두 개) ───────────────────────────────────────────

function Probe({ onReady }: { onReady: (ctx: ReturnType<typeof useWorkspace>) => void }) {
  const ctx = useWorkspace();
  onReady(ctx);
  return <span data-testid="view">{`${ctx.state.currentProjectId}:${ctx.state.uiV2View}`}</span>;
}

describe("WorkspaceProvider(projectId)", () => {
  it("서로 다른 두 탭으로 마운트하면 상태가 격리된다", async () => {
    let ctxA: ReturnType<typeof useWorkspace> | null = null;
    const a = render(<WorkspaceProvider projectId={1}><Probe onReady={(c) => (ctxA = c)} /></WorkspaceProvider>);
    act(() => ctxA!.setUiV2View("planner"));
    expect(a.getByTestId("view").textContent).toBe("1:planner");
    // 디바운스(300ms) 저장을 언마운트 flush 로 확정시킨다.
    a.unmount();

    let ctxB: ReturnType<typeof useWorkspace> | null = null;
    const b = render(<WorkspaceProvider projectId={2}><Probe onReady={(c) => (ctxB = c)} /></WorkspaceProvider>);
    // 탭 B 는 탭 A 의 화면을 물려받지 않는다 — 기본값에서 시작한다.
    expect(b.getByTestId("view").textContent).toBe("2:today");
    act(() => ctxB!.setUiV2View("diff"));
    b.unmount();

    // 그리고 B 의 저장이 A 의 레코드를 덮어쓰지 않았다 (R3 의 핵심).
    expect(JSON.parse(localStorage.getItem(storageKeyFor(1))!).uiV2View).toBe("planner");
    expect(JSON.parse(localStorage.getItem(storageKeyFor(2))!).uiV2View).toBe("diff");
  });

  it("프로젝트 신원은 영속되지 않는다 — 탭이 단일 진실 (I3)", () => {
    let ctx: ReturnType<typeof useWorkspace> | null = null;
    const r = render(<WorkspaceProvider projectId={5}><Probe onReady={(c) => (ctx = c)} /></WorkspaceProvider>);
    act(() => ctx!.setProjectMeta("aurora", "/x/aurora"));
    r.unmount();

    const saved = JSON.parse(localStorage.getItem(storageKeyFor(5))!);
    expect(saved.currentProjectId).toBeUndefined();
    expect(saved.currentProjectName).toBeUndefined();
    expect(saved.currentProjectRoot).toBeUndefined();
    expect(saved.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
  });

  it("과거 레코드에 남은 currentProjectId 가 탭의 프로젝트를 덮어쓰지 못한다", () => {
    localStorage.setItem(
      storageKeyFor(9),
      JSON.stringify({ schemaVersion: 3, currentProjectId: 42, uiV2View: "diff" }),
    );
    const r = render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={() => {}} />
      </WorkspaceProvider>,
    );
    expect(r.getByTestId("view").textContent).toBe("9:diff");
  });
});

// ─── 사이드바 접힘 — 격리의 예외 ──────────────────────────────────────────
//
// 나머지 워크스페이스 상태와 정반대다: 프로젝트마다 달라야 하는 게 아니라
// 탭·창을 가로질러 **하나여야** 한다. 프로젝트별 레코드에 있던 시절엔 탭을
// 옮길 때마다 사이드바가 제멋대로 열리고 닫혔다.

function SidebarProbe({ id }: { id: number }) {
  const { state, setState } = useWorkspace();
  return (
    <button
      data-testid={`sb-${id}`}
      onClick={() => setState((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }))}
    >
      {state.sidebarCollapsed ? "collapsed" : "open"}
    </button>
  );
}

describe("사이드바 접힘 (탭·창 공유)", () => {
  it("한 탭에서 접으면 같은 창의 다른 탭도 즉시 접힌다", () => {
    const r = render(
      <>
        <WorkspaceProvider projectId={1}><SidebarProbe id={1} /></WorkspaceProvider>
        <WorkspaceProvider projectId={2}><SidebarProbe id={2} /></WorkspaceProvider>
      </>,
    );
    expect(r.getByTestId("sb-2").textContent).toBe("open");
    act(() => r.getByTestId("sb-1").click());
    expect(r.getByTestId("sb-1").textContent).toBe("collapsed");
    expect(r.getByTestId("sb-2").textContent).toBe("collapsed");
  });

  it("나중에 연 탭도 저장된 취향으로 시작한다", () => {
    const a = render(<WorkspaceProvider projectId={1}><SidebarProbe id={1} /></WorkspaceProvider>);
    act(() => a.getByTestId("sb-1").click());
    a.unmount();

    const b = render(<WorkspaceProvider projectId={7}><SidebarProbe id={7} /></WorkspaceProvider>);
    expect(b.getByTestId("sb-7").textContent).toBe("collapsed");
  });

  it("프로젝트별 레코드에는 남기지 않는다 — 다시 갈라지지 않게", () => {
    const r = render(<WorkspaceProvider projectId={3}><SidebarProbe id={3} /></WorkspaceProvider>);
    act(() => r.getByTestId("sb-3").click());
    r.unmount(); // 디바운스 저장 flush
    expect(JSON.parse(localStorage.getItem(storageKeyFor(3))!).sidebarCollapsed).toBeUndefined();
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("1");
  });

  it("전역 취향이 없으면 예전 레코드의 값을 한 번 승격시킨다", () => {
    localStorage.setItem(
      storageKeyFor(4),
      JSON.stringify({ schemaVersion: WORKSPACE_SCHEMA_VERSION, sidebarCollapsed: true }),
    );
    const r = render(<WorkspaceProvider projectId={4}><SidebarProbe id={4} /></WorkspaceProvider>);
    expect(r.getByTestId("sb-4").textContent).toBe("collapsed");
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("1");
  });
});

// ─── {#localstorage-guard} 저장소가 던져도 앱은 뜬다 (2026-09-04) ──────────
//
// 웹뷰의 `localStorage` 는 **읽기만 해도 던진다** (쿼터 초과·프라이빗 모드·
// 사이트 데이터 차단). 이 앱은 저장을 `WorkspaceContext` 한 곳에 모아 놨으므로
// (lint 가 강제한다) 그 한 번의 throw 는 한 곳이 아니라 **전부**를 무너뜨렸다 —
// 프로바이더 초기화가 던지면 그 위엔 화면 경계가 없어 창이 통째로 흰 화면이다.

function ViewProbe() {
  const { state, setUiV2View } = useWorkspace();
  return (
    <button type="button" data-testid="view" onClick={() => setUiV2View("planner")}>
      {state.uiV2View}
    </button>
  );
}

describe("저장소 고장", () => {
  it("읽기가 던져도 기본값으로 뜨고, 쓰기가 던져도 계속 쓸 수 있다", () => {
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      let r!: ReturnType<typeof render>;
      expect(() => {
        r = render(
          <WorkspaceProvider projectId={9}>
            <ViewProbe />
          </WorkspaceProvider>,
        );
      }).not.toThrow();

      // 기본 화면으로 떴고 — 상태 변경도 그대로 동작한다 (저장만 안 될 뿐).
      expect(r.getByTestId("view").textContent).toBe("today");
      act(() => r.getByTestId("view").click());
      expect(r.getByTestId("view").textContent).toBe("planner");
      // 언마운트의 flush 저장도 던지지만 삼켜야 한다.
      expect(() => r.unmount()).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
