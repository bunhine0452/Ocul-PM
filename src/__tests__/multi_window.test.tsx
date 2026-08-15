/**
 * 멀티 프로젝트 창 + 크롬식 탭 — 01-multi-window.md §6 / 01b-chrome-tabs.md §6.
 *
 * 프런트에서 검증 가능한 것들:
 *  - 라우팅 — 창 갈래는 URL 이 정하고 런타임에 바뀌지 않는다
 *  - R3    — 탭 두 개가 같은 localStorage 레코드를 덮어쓰지 않는다 (키 분리)
 *  - 탭 순서 — 드래그 재배열 산술 (경계에서 조용히 틀리기 쉬운 자리)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import { parseWindowRoute, FIRST_WINDOW } from "@/lib/windowRoute";
import {
  tabDropIndex,
  reorderTabs,
  isDetachGesture,
  DETACH_THRESHOLD_PX,
} from "@/features/shell/tabOrder";
import {
  WorkspaceProvider,
  useWorkspace,
  storageKeyFor,
  migrateSingleKeyToPerProject,
  WORKSPACE_SCHEMA_VERSION,
} from "@/contexts/WorkspaceContext";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

// ─── 창 라우팅 (main.tsx 3갈래 분기) ──────────────────────────────────────

describe("창 라우팅", () => {
  it("?tray=1 은 트레이 갈래", () => {
    expect(parseWindowRoute("?tray=1")).toEqual({ kind: "tray" });
  });

  it("?win=win-2 는 프로젝트 창 갈래 (탭 집합은 백엔드에 묻는다)", () => {
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

  /** 판독 불가능한 라벨을 들고 들어가면 그 창의 모든 탭 커맨드가 빗나간다. */
  it("판독 불가능한 win 값은 첫 창으로 떨어진다", () => {
    for (const bad of ["?win=abc", "?win=", "?win=win-", "?win=window-1", "?win=win-1x"]) {
      expect(parseWindowRoute(bad)).toMatchObject({ kind: "window", label: FIRST_WINDOW });
    }
  });

  it("tray 가 win 보다 우선한다", () => {
    expect(parseWindowRoute("?tray=1&win=win-2")).toEqual({ kind: "tray" });
  });

  /** 도크에서 떼어낸 터미널 전용 창 (2026-08-15). */
  it("?term=3 은 분리 터미널 갈래", () => {
    expect(parseWindowRoute("?term=3")).toEqual({ kind: "terminal", projectId: 3 });
  });

  /**
   * 판독 불가능한 프로젝트 id 로 터미널 갈래에 들어가면 프로젝트 없는
   * 워크스페이스를 마운트하게 된다 — 평범한 탭 창으로 떨어지는 편이 안전하다.
   */
  it("판독 불가능한 term 값은 터미널 갈래로 가지 않는다", () => {
    for (const bad of ["?term=", "?term=abc", "?term=-1", "?term=1.5", "?term=1x"]) {
      expect(parseWindowRoute(bad)).toMatchObject({ kind: "window", label: FIRST_WINDOW });
    }
  });

  it("tray 가 term 보다 우선한다", () => {
    expect(parseWindowRoute("?tray=1&term=3")).toEqual({ kind: "tray" });
  });
});

// ─── 탭 드래그 산술 (01b §4.1) ────────────────────────────────────────────

describe("탭 삽입 인덱스", () => {
  // 중심이 40 / 120 / 200 인 탭 3개.
  const centers = [40, 120, 200];

  it("첫 탭 왼쪽이면 0", () => {
    expect(tabDropIndex(centers, 0)).toBe(0);
    expect(tabDropIndex(centers, 39)).toBe(0);
  });

  it("중심을 넘어야 다음 자리로 넘어간다", () => {
    expect(tabDropIndex(centers, 41)).toBe(1);
    expect(tabDropIndex(centers, 119)).toBe(1);
    expect(tabDropIndex(centers, 121)).toBe(2);
  });

  it("마지막 탭 오른쪽이면 끝", () => {
    expect(tabDropIndex(centers, 999)).toBe(3);
  });

  it("탭이 없으면 항상 0", () => {
    expect(tabDropIndex([], 500)).toBe(0);
  });
});

describe("탭 재배열", () => {
  /** 오른쪽 이동에서 인덱스 보정을 빼먹으면 "한 칸 옮기기"가 무반응이 된다. */
  it("오른쪽으로 한 칸 옮긴다", () => {
    expect(reorderTabs([1, 2, 3], 0, 2)).toEqual([2, 1, 3]);
  });

  it("왼쪽으로 옮긴다", () => {
    expect(reorderTabs([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it("맨 끝으로 옮긴다", () => {
    expect(reorderTabs([1, 2, 3], 0, 3)).toEqual([2, 3, 1]);
  });

  it("제자리면 그대로", () => {
    expect(reorderTabs([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(reorderTabs([1, 2, 3], 1, 2)).toEqual([1, 2, 3]);
  });

  it("원본을 변형하지 않는다", () => {
    const src = [1, 2, 3];
    reorderTabs(src, 0, 2);
    expect(src).toEqual([1, 2, 3]);
  });

  it("범위 밖 from 은 무시한다", () => {
    expect(reorderTabs([1, 2], 5, 0)).toEqual([1, 2]);
    expect(reorderTabs([], 0, 0)).toEqual([]);
  });
});

describe("떼어내기 판정", () => {
  const strip = { top: 6, bottom: 44 };

  it("스트립 안에서 가로로만 움직이면 순서 변경이다", () => {
    expect(isDetachGesture(strip, 6)).toBe(false);
    expect(isDetachGesture(strip, 44)).toBe(false);
    expect(isDetachGesture(strip, 44 + DETACH_THRESHOLD_PX)).toBe(false);
  });

  it("아래로 충분히 벗어나면 떼어내기", () => {
    expect(isDetachGesture(strip, 44 + DETACH_THRESHOLD_PX + 1)).toBe(true);
  });

  /** 창 위쪽(다른 모니터 방향)으로 끌어도 떼어내기여야 한다. */
  it("위로 벗어나도 떼어내기", () => {
    expect(isDetachGesture(strip, 6 - DETACH_THRESHOLD_PX - 1)).toBe(true);
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
      JSON.stringify({ schemaVersion: 3, currentProjectId: 42, uiV2View: "retro" }),
    );
    const r = render(
      <WorkspaceProvider projectId={9}>
        <Probe onReady={() => {}} />
      </WorkspaceProvider>,
    );
    expect(r.getByTestId("view").textContent).toBe("9:retro");
  });
});
