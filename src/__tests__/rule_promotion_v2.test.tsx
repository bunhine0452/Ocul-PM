import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-CI4 — 규칙 후보(승격 루프) UI: 후보→초안→승인/거절 계약 ─────────────
//
// 핵심 고정 사항: **자동 적용 경로 부재**. 후보 렌더·초안 생성까지는 rulesSave
// 가 절대 호출되지 않고, 오직 제안 카드의 "규칙으로 저장" 클릭만 저장을
// 트리거한다. 거절/숨기기는 어떤 변이 커맨드도 부르지 않는다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

function candidate(over: Dict = {}): Dict {
  return {
    key: "area:src/api",
    area: "src/api",
    entry_count: 3,
    kinds: ["bug", "error"],
    sample_titles: ["검증 누락으로 500", "auth 헤더 파싱 실패"],
    entry_rels: ["20260719/Bugs/b1.md", "20260718/Errors/e1.md"],
    suggested_paths: ["src/api/**"],
    last_workday: "20260719",
    ...over,
  };
}

const DRAFT = {
  candidate_key: "area:src/api",
  slug: "api-input-validation",
  title: "API 입력 검증 규칙",
  paths: ["src/api/**/*.ts"],
  body_markdown: "# API 입력 검증 규칙\n\n- 모든 핸들러는 입력을 검증한다",
  content:
    '---\npaths:\n  - "src/api/**/*.ts"\n---\n<!-- oculpm:promoted-from area:src/api -->\n\n# API 입력 검증 규칙\n\n- 모든 핸들러는 입력을 검증한다\n',
  rel_path: ".claude/rules/api-input-validation.md",
};

const fx = {
  candidates: [] as Dict[],
  calls: {
    draft: [] as unknown[][],
    save: [] as unknown[][],
  },
};

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "ruleCandidates":
              return () => ok(fx.candidates);
            case "ruleDraftGenerate":
              return (...a: unknown[]) => {
                fx.calls.draft.push(a);
                return ok(DRAFT);
              };
            case "rulesSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok({ entry: { rel_path: a[2] }, mirror: null });
              };
            case "settingsGet":
              return (key: string) =>
                ok(key === "default_provider" ? "anthropic" : "claude-sonnet-5");
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { RuleCandidatesPanel } from "@/features/retro/RuleCandidates";

beforeEach(() => {
  fx.candidates = [candidate()];
  fx.calls.draft = [];
  fx.calls.save = [];
});

afterEach(() => {
  cleanup();
});

const renderPanel = () =>
  render(<RuleCandidatesPanel projectId={1} since="20260714" until="20260720" />);

describe("RuleCandidatesPanel", () => {
  it("후보를 그리고, 렌더만으로는 어떤 저장도 일어나지 않는다 + axe", async () => {
    const { container, findByText, getByText } = renderPanel();
    await findByText("src/api");
    expect(getByText("버그·에러 3건")).toBeTruthy();
    expect(getByText("src/api/**")).toBeTruthy();
    expect(getByText(/검증 누락으로 500/)).toBeTruthy();
    // 자동 적용 경로 부재 — 렌더는 조회만 한다.
    expect(fx.calls.save).toHaveLength(0);
    expect(fx.calls.draft).toHaveLength(0);

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("후보가 없으면 섹션 자체를 그리지 않는다", async () => {
    fx.candidates = [];
    const { container } = renderPanel();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("초안 생성 → LLM 커맨드 계약 + 제안 카드 표시, 이 단계에서도 저장 없음", async () => {
    const { findByRole, getByRole } = renderPanel();
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));

    await waitFor(() => expect(fx.calls.draft).toHaveLength(1));
    expect(fx.calls.draft[0]).toEqual([
      1,
      "20260714",
      "20260720",
      "area:src/api",
      "anthropic",
      "claude-sonnet-5",
    ]);

    const dialog = await waitFor(() => getByRole("dialog", { name: "규칙 초안 제안" }));
    expect(within(dialog).getByText("API 입력 검증 규칙")).toBeTruthy();
    expect(within(dialog).getByText("src/api/**/*.ts")).toBeTruthy();
    expect(
      (within(dialog).getByLabelText("파일 이름 (슬러그)") as HTMLInputElement).value,
    ).toBe("api-input-validation");
    // 초안까지 왔어도 저장은 없다.
    expect(fx.calls.save).toHaveLength(0);
  });

  it("승인 클릭만이 rulesSave(create=true) 를 부른다 — 슬러그 수정 반영", async () => {
    const { findByRole, getByRole } = renderPanel();
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "규칙 초안 제안" }));

    const slugInput = within(dialog).getByLabelText("파일 이름 (슬러그)");
    fireEvent.change(slugInput, { target: { value: "api-guard" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "규칙으로 저장" }));

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [pid, scope, relPath, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([pid, scope, relPath, create]).toEqual([1, "project", ".claude/rules/api-guard.md", true]);
    expect(content).toBe(DRAFT.content);
    // 저장된 후보는 **목록에서** 사라진다 (savedKeys 필터). 다이얼로그 내부를
    // 물으면 setDraft(null) 로 이미 분리된 노드라 항상 null 이어서 아무것도
    // 검증하지 못했다 — 목록 컨테이너를 직접 단언한다 (2026-07-20 리뷰 #11).
    await waitFor(() => expect(screen.queryByText("src/api")).toBeNull());
    expect(screen.queryByText("src/api/**")).toBeNull();
  });

  it("잘못된 슬러그면 저장 버튼이 비활성화된다", async () => {
    const { findByRole, getByRole } = renderPanel();
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "규칙 초안 제안" }));
    fireEvent.change(within(dialog).getByLabelText("파일 이름 (슬러그)"), {
      target: { value: "Bad Name" },
    });
    const save = within(dialog).getByRole("button", { name: "규칙으로 저장" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/kebab-case/)).toBeTruthy();
    expect(fx.calls.save).toHaveLength(0);
  });

  it("거절과 숨기기는 아무 변이 커맨드도 부르지 않는다", async () => {
    const { findByRole, getByRole, getByLabelText, queryByText } = renderPanel();
    // 거절: 초안을 띄웠다가 닫는다.
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "규칙 초안 제안" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "거절" }));
    await waitFor(() => expect(queryByText("규칙으로 저장")).toBeNull());
    // 숨기기: 후보 행이 사라진다.
    fireEvent.click(getByLabelText("src/api 후보 숨기기"));
    await waitFor(() => expect(queryByText("src/api/**")).toBeNull());

    expect(fx.calls.save).toHaveLength(0);
    expect(fx.calls.draft).toHaveLength(1); // 초안 1회 생성만 — 저장 0
  });
});
