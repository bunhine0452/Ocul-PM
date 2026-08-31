import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── AD-3 — 에이전트 컨텍스트 화면의 **스킬 쪽** 계약 + a11y ────────────────
//
// 3존 화면으로 접히면서 두 가지가 바뀌었다: (1) 스코프별 두 섹션이 아니라 한
// 목록에 종류 배지로 서고, (2) 자동 선택이 없어져 행을 눌러야 편집기가 열린다.
// 비활성 스킬은 로드되지 않으므로 **휴면**으로 자동 강등된다 — 목록이 스스로
// 청소되는 규약을 여기서 고정한다.
//
// 백엔드(skills_* 커맨드)는 Proxy mock 으로 대체하고, 변이 커맨드는 호출
// 인자를 수집해 "UI 조작 → 올바른 커맨드 계약" 을 검증한다 (tools_v2 패턴).

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

function entry(over: Record<string, unknown> = {}) {
  return {
    scope: "project",
    dir_name: "review-checklist",
    name: "review-checklist",
    description: "PR 리뷰 체크리스트",
    enabled: true,
    display_path: ".claude/skills/review-checklist",
    extra_files: 1,
    ...over,
  };
}

const CONTENT = `---
name: review-checklist
description: PR 리뷰 체크리스트
---

# review-checklist

본문 지침입니다.
`;

// Mutable fixtures + 변이 호출 수집.
const fx = {
  overview: {
    project: [entry()],
    global: [
      entry({
        scope: "global",
        dir_name: "standup",
        name: "standup",
        description: "",
        enabled: false,
        display_path: "~/.claude/skills/.disabled/standup",
        extra_files: 0,
      }),
    ],
    project_skills_dir: "/tmp/proj/.claude/skills",
    global_skills_dir: "/home/u/.claude/skills",
  },
  calls: {
    setEnabled: [] as unknown[][],
    save: [] as unknown[][],
    del: [] as unknown[][],
  },
};

// Markdown 리치 렌더(MarkdownImpl)는 ThemeProvider 에 의존 — 여기 관심사가
// 아니므로 plain text 로 스텁한다 (journal_v2 와 동일 패턴).
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
            case "skillsList":
              return () => ok(fx.overview);
            case "skillsRead":
              return (_pid: number, scope: string, dirName: string) => {
                const all = [...fx.overview.project, ...fx.overview.global];
                const e = all.find((x) => x.scope === scope && x.dir_name === dirName) ?? entry();
                return ok({
                  entry: e,
                  content: CONTENT,
                  files: e.extra_files > 0 ? ["references/guide.md"] : [],
                  skill_md_path: `/abs/${dirName}/SKILL.md`,
                });
              };
            case "skillsSetEnabled":
              return (...a: unknown[]) => {
                fx.calls.setEnabled.push(a);
                return ok(entry({ enabled: a[3] }));
              };
            case "skillsSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok(entry({ dir_name: a[2], name: a[2] }));
              };
            case "skillsDelete":
              return (...a: unknown[]) => {
                fx.calls.del.push(a);
                return ok(null);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SkillsScreenV2 } from "@/features/skills/SkillsScreenV2";
import { _resetAgentContextIntent, requestAgentContext } from "@/lib/agentContextNav";
import { isValidSkillName, skillTemplate, splitFrontmatter } from "@/features/skills/skillsModel";

beforeEach(() => {
  _resetAgentContextIntent();
  fx.calls.setEnabled = [];
  fx.calls.save = [];
  fx.calls.del = [];
});

afterEach(() => {
  cleanup();
});

describe("SkillsScreenV2 — 3존 화면 (스킬)", () => {
  it("한 목록에 스킬이 서고, 비활성은 휴면으로 강등되며, 행을 누르면 편집기가 열린다 + axe", async () => {
    const { container, getByText, getAllByText, getByRole, queryByText } = render(
      <SkillsScreenV2 projectId={1} />,
    );

    await waitFor(() => expect(getAllByText("review-checklist").length).toBeGreaterThan(0));
    expect(getAllByText("스킬").length).toBeGreaterThan(0);
    // 비활성 스킬은 접힌 휴면 섹션 안 — 기본 목록에는 없다.
    expect(queryByText("standup")).toBeNull();
    fireEvent.click(getByRole("button", { name: /휴면 1개/ }));
    expect(getByText("standup")).toBeTruthy();
    expect(getAllByText("비활성").length).toBeGreaterThan(0);

    // 자동 선택은 없다 — 행을 눌러야 상세가 열린다.
    fireEvent.click(getAllByText("review-checklist")[0]);
    await waitFor(() =>
      expect(getByText(/\.claude\/skills\/review-checklist\/SKILL\.md/)).toBeTruthy(),
    );
    await waitFor(() => expect(getByText(/본문 지침입니다/)).toBeTruthy());
    expect(getByRole("button", { name: /목록으로/ })).toBeTruthy();

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("비활성화 버튼이 skillsSetEnabled(enabled=false) 를 호출한다", async () => {
    const { getByRole, getAllByText } = render(<SkillsScreenV2 projectId={1} />);
    fireEvent.click(await waitFor(() => getAllByText("review-checklist")[0]));
    const toggle = await waitFor(() => getByRole("button", { name: "비활성화" }));
    fireEvent.click(toggle);
    await waitFor(() => expect(fx.calls.setEnabled).toHaveLength(1));
    expect(fx.calls.setEnabled[0]).toEqual([1, "project", "review-checklist", false]);
  });

  it("생성 모달 — kebab 검증 후 skillsSave(create=true) 를 템플릿과 함께 호출한다", async () => {
    const { getByRole, getByLabelText } = render(<SkillsScreenV2 projectId={1} />);
    fireEvent.click(await waitFor(() => getByRole("button", { name: /새 스킬/ })));

    const dialog = getByRole("dialog", { name: "새 스킬 만들기" });
    const name = getByLabelText("이름 (폴더명)");
    const submit = within(dialog).getByRole("button", { name: "만들기" });

    // 잘못된 이름 → 비활성 + 안내.
    fireEvent.change(name, { target: { value: "Bad Name" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/kebab-case/)).toBeTruthy();

    // 올바른 이름 + 설명 → 저장 호출.
    fireEvent.change(name, { target: { value: "pr-review" } });
    fireEvent.change(getByLabelText(/설명/), { target: { value: "PR 만들 때" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [pid, scope, dirName, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([pid, scope, dirName, create]).toEqual([1, "project", "pr-review", true]);
    expect(content).toContain("name: pr-review");
    expect(content).toContain('description: "PR 만들 때"');
  });

  it("삭제는 확인 모달을 거쳐 skillsDelete 를 호출한다", async () => {
    const { getByRole, getAllByText } = render(<SkillsScreenV2 projectId={1} />);
    fireEvent.click(await waitFor(() => getAllByText("review-checklist")[0]));
    fireEvent.click(await waitFor(() => getByRole("button", { name: /삭제/ })));

    const dialog = getByRole("dialog", { name: "스킬 삭제 확인" });
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(fx.calls.del).toHaveLength(1));
    expect(fx.calls.del[0]).toEqual([1, "project", "review-checklist"]);
  });

  it("AD-4 — 팔레트/사건 화면의 요청이 화면 마운트 시 생성 모달로 회수된다", async () => {
    requestAgentContext({ kind: "createSkill", seed: { name: "from-terminal" } });
    const { getByRole, getByLabelText } = render(<SkillsScreenV2 projectId={1} />);
    await waitFor(() => getByRole("dialog", { name: "새 스킬 만들기" }));
    expect((getByLabelText("이름 (폴더명)") as HTMLInputElement).value).toBe("from-terminal");
  });
});

describe("skillsModel (순수 헬퍼)", () => {
  it("isValidSkillName — kebab-case 만 허용", () => {
    for (const good of ["a", "pr-review", "review_2", "x9"]) {
      expect(isValidSkillName(good), good).toBe(true);
    }
    for (const bad of ["", "Bad", "한글", "-lead", "a b", "a/b", ".hidden", "x".repeat(65)]) {
      expect(isValidSkillName(bad), bad).toBe(false);
    }
  });

  it("splitFrontmatter — 메타/본문 분리 + frontmatter 없으면 그대로", () => {
    const { meta, body } = splitFrontmatter("---\nname: a\n---\n\n# 제목\n본문");
    expect(meta).toBe("name: a");
    expect(body).toBe("# 제목\n본문");
    expect(splitFrontmatter("그냥 본문")).toEqual({ meta: null, body: "그냥 본문" });
    // 닫는 --- 가 없는 경우 통짜 본문으로 취급 (관대).
    expect(splitFrontmatter("---\nname: a\n").meta).toBeNull();
  });

  it("skillTemplate — 설명의 따옴표/개행을 YAML 한 줄로 안전 처리", () => {
    const t = skillTemplate("pr-review", 'PR "최종" 점검\n두 줄째');
    expect(t).toContain("name: pr-review");
    expect(t).toContain('description: "PR \\"최종\\" 점검 두 줄째"');
    expect(t.startsWith("---\n")).toBe(true);
  });
});
