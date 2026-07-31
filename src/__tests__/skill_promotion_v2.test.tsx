import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── 스킬 후보(승격 루프) UI: 후보→초안→승인/거절 계약 — CI4 미러 ────────────
//
// 핵심 고정 사항: **자동 적용 경로 부재**. 후보 렌더·초안 생성까지는 skillsSave
// 가 절대 호출되지 않고, 오직 제안 카드의 "스킬로 저장" 클릭만 저장을
// 트리거한다. 거절/숨기기는 어떤 변이 커맨드도 부르지 않는다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

function candidate(over: Dict = {}): Dict {
  return {
    tag: "migration",
    slug: "migration",
    count: 3,
    last_workday: "20260719",
    sample_titles: ["023 재보정 마이그레이션", "022 retro 캐시 추가"],
    ...over,
  };
}

const DRAFT = {
  tag: "migration",
  slug: "db-migration",
  description: "Use when adding a new SQLite migration.",
  body_markdown: "# 마이그레이션 절차\n\n1. 다음 번호의 0NN_*.sql 을 만든다",
  content:
    '---\nname: db-migration\ndescription: "Use when adding a new SQLite migration."\n---\n\n# 마이그레이션 절차\n\n1. 다음 번호의 0NN_*.sql 을 만든다\n\n<!-- promoted-from: tag:migration -->\n',
  rel_path: ".claude/skills/db-migration/SKILL.md",
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
            case "skillCandidates":
              return () => ok(fx.candidates);
            case "skillDraftGenerate":
              return (...a: unknown[]) => {
                fx.calls.draft.push(a);
                return ok(DRAFT);
              };
            case "skillsSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok({ dir_name: a[2], enabled: true });
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

import { SkillCandidatesPanel } from "@/features/retro/SkillCandidates";

beforeEach(() => {
  fx.candidates = [candidate()];
  fx.calls.draft = [];
  fx.calls.save = [];
});

afterEach(() => {
  cleanup();
});

const renderPanel = () =>
  render(<SkillCandidatesPanel projectId={1} since="20260714" until="20260720" />);

describe("SkillCandidatesPanel", () => {
  it("후보를 그리고, 렌더만으로는 어떤 저장도 일어나지 않는다 + axe", async () => {
    const { container, findByText, getByText } = renderPanel();
    await findByText("migration");
    expect(getByText("반복 3회")).toBeTruthy();
    expect(getByText(/023 재보정 마이그레이션/)).toBeTruthy();
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
      "migration",
      "anthropic",
      "claude-sonnet-5",
    ]);

    const dialog = await waitFor(() => getByRole("dialog", { name: "스킬 초안 제안" }));
    expect(within(dialog).getByText("Use when adding a new SQLite migration.")).toBeTruthy();
    expect(
      (within(dialog).getByLabelText("폴더 이름 (슬러그)") as HTMLInputElement).value,
    ).toBe("db-migration");
    // 초안까지 왔어도 저장은 없다.
    expect(fx.calls.save).toHaveLength(0);
  });

  it("승인 클릭만이 skillsSave(create=true) 를 부른다 — 슬러그 수정이 frontmatter name 에도 반영", async () => {
    const { findByRole, getByRole } = renderPanel();
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "스킬 초안 제안" }));

    const slugInput = within(dialog).getByLabelText("폴더 이름 (슬러그)");
    fireEvent.change(slugInput, { target: { value: "sqlite-migration" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "스킬로 저장" }));

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [pid, scope, dirName, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([pid, scope, dirName, create]).toEqual([1, "project", "sqlite-migration", true]);
    // 폴더명과 frontmatter name 이 어긋나지 않게 첫 name: 줄을 치환한다.
    expect(content).toContain("name: sqlite-migration");
    expect(content).toContain("<!-- promoted-from: tag:migration -->");
    // 저장된 후보는 목록에서 사라진다 (savedTags 필터).
    await waitFor(() => expect(screen.queryByText("반복 3회")).toBeNull());
  });

  it("잘못된 슬러그면 저장 버튼이 비활성화된다", async () => {
    const { findByRole, getByRole } = renderPanel();
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "스킬 초안 제안" }));
    fireEvent.change(within(dialog).getByLabelText("폴더 이름 (슬러그)"), {
      target: { value: "Bad Name" },
    });
    const save = within(dialog).getByRole("button", { name: "스킬로 저장" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/kebab-case/)).toBeTruthy();
    expect(fx.calls.save).toHaveLength(0);
  });

  it("거절과 숨기기는 아무 변이 커맨드도 부르지 않는다", async () => {
    const { findByRole, getByRole, getByLabelText, queryByText } = renderPanel();
    // 거절: 초안을 띄웠다가 닫는다.
    fireEvent.click(await findByRole("button", { name: /초안 생성/ }));
    const dialog = await waitFor(() => getByRole("dialog", { name: "스킬 초안 제안" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "거절" }));
    await waitFor(() => expect(queryByText("스킬로 저장")).toBeNull());
    // 숨기기: 후보 행이 사라진다.
    fireEvent.click(getByLabelText("migration 후보 숨기기"));
    await waitFor(() => expect(queryByText("반복 3회")).toBeNull());

    expect(fx.calls.save).toHaveLength(0);
    expect(fx.calls.draft).toHaveLength(1); // 초안 1회 생성만 — 저장 0
  });
});
