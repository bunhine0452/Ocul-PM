import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";

import {
  migrateUiV2View,
  UI_V2_VIEWS,
  storageKeyFor,
  useWorkspace,
  WorkspaceProvider,
} from "@/contexts/WorkspaceContext";

/**
 * v3-surface `{#uiv2view-migrate}` · `{#known-views-persist}`.
 *
 * `uiV2View` 는 프로젝트마다 영속되는데 검증이 하나도 없었다. 모르는 값이면
 * ShellV2 라우터의 ternary 사슬이 전부 빗나가 `null` 로 끝나 — 툴바도 콘텐츠도
 * 없는 빈 본문이 남는다. 화면 id 를 하나라도 없애는 순간(IA 재편) 그 화면에
 * 머물던 사용자의 저장된 값이 곧장 그 상태다.
 */
describe("uiV2View — 영속값도 허용 목록을 지난다", () => {
  it("현재 화면 이름은 그대로 통과한다", () => {
    for (const view of UI_V2_VIEWS) {
      expect(migrateUiV2View(view)).toBe(view);
    }
  });

  it("없어진 화면 이름은 today 로 떨어진다", () => {
    // IA 재편이 화면을 합치면 저장된 값이 이 모양이 된다.
    expect(migrateUiV2View("claudecode-legacy")).toBe("today");
    expect(migrateUiV2View("overview")).toBe("today");
  });

  it("빠졌거나 타입이 어긋난 값도 today 로 떨어진다", () => {
    expect(migrateUiV2View(undefined)).toBe("today");
    expect(migrateUiV2View(null)).toBe("today");
    expect(migrateUiV2View(7)).toBe("today");
    expect(migrateUiV2View({ view: "today" })).toBe("today");
  });
});

describe("uiV2View — 저장된 레코드를 읽을 때 걸린다", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("모르는 화면이 저장돼 있으면 today 로 열린다", () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ schemaVersion: 4, uiV2View: "화면-없음" }),
    );
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: ({ children }) =>
        React.createElement(WorkspaceProvider, { projectId: 1, children }),
    });
    expect(result.current.state.uiV2View).toBe("today");
  });

  it("살아 있는 화면이 저장돼 있으면 그대로 연다", () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ schemaVersion: 4, uiV2View: "planner" }),
    );
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: ({ children }) =>
        React.createElement(WorkspaceProvider, { projectId: 1, children }),
    });
    expect(result.current.state.uiV2View).toBe("planner");
  });
});
