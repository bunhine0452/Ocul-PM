import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-R2 (C1) — 첫 실행 온보딩 ──────────────────────────────────────────
//
// StartScreen (프로젝트 미선택 진입 화면) shows a "how it works" guide only when
// the user has no projects yet — the moment a brand-new user needs the mental
// model (passive recording via external agents). These tests assert it appears
// for new users, hides once a project exists, and the CTA expands the add flow.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

vi.mock("@/lib/bindings", () => ({
  commands: {
    listBlueprints: () => Promise.resolve({ status: "ok", data: [] }),
    deleteBlueprint: () => Promise.resolve({ status: "ok", data: null }),
  },
}));

import { StartScreen } from "@/features/onboarding/StartScreen";

function project(over: Partial<Record<string, unknown>> = {}) {
  return { id: 1, name: "aurora-web", root_path: "/x/aurora-web", created_at: 0, ...over };
}

function renderStart(over: Partial<React.ComponentProps<typeof StartScreen>> = {}) {
  const props = {
    projects: [],
    stats: {},
    indexingId: null,
    error: null,
    onSelectProject: vi.fn(),
    onAddProject: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onStartGreenfield: vi.fn(),
    onResumeBlueprint: vi.fn(),
    ...over,
  };
  return { ...render(<StartScreen {...props} />), props };
}

afterEach(() => cleanup());

describe("PR-R2 (C1) — StartScreen 온보딩", () => {
  it("프로젝트가 없으면 '이렇게 동작해요' 가이드를 보여준다", () => {
    const { getByText } = renderStart({ projects: [] });
    expect(getByText("Ocul-PM 은 이렇게 동작해요")).toBeInTheDocument();
    expect(getByText("평소처럼 에이전트로 코딩")).toBeInTheDocument();
    expect(getByText("자동으로 기록·정리")).toBeInTheDocument();
  });

  it("프로젝트가 있으면 가이드를 숨긴다", () => {
    const { queryByText } = renderStart({ projects: [project()] as never });
    expect(queryByText("Ocul-PM 은 이렇게 동작해요")).toBeNull();
  });

  it("'프로젝트 추가하고 시작하기' → 추가 옵션(기존/새) 노출", () => {
    const { getByLabelText, getByText } = renderStart({ projects: [] });
    fireEvent.click(getByLabelText("프로젝트 추가하고 시작하기"));
    expect(getByText("기존 폴더")).toBeInTheDocument();
    expect(getByText("새 프로젝트")).toBeInTheDocument();
  });

  it("axe 위반 0 (온보딩 표시 상태)", async () => {
    const { container, getByText } = renderStart({ projects: [] });
    expect(getByText("Ocul-PM 은 이렇게 동작해요")).toBeInTheDocument();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
