import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-CI3 — 스킬·규칙 허브: 탭 전환 + 규칙 탭 데이터 흐름/변이 계약 ────────
//
// 백엔드(rules_* 커맨드·config)는 Proxy mock 으로 대체하고, 변이 커맨드 호출
// 인자를 수집해 "UI 조작 → 올바른 커맨드 계약" 을 검증한다 (skills_v2 패턴).
// 자동 적용 경로가 없다는 것(번역 토글이 명시적 config 저장 + sync 호출로만
// 이루어짐)도 여기서 고정한다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

function ruleEntry(over: Dict = {}): Dict {
  return {
    scope: "project",
    kind: "rule",
    rel_path: ".claude/rules/api-validation.md",
    name: "api-validation",
    title: "API 규칙",
    exists: true,
    paths: ["src/api/**/*.ts"],
    bytes: 120,
    mirror: "none",
    ...over,
  };
}

function claudeMdSlot(rel: string, over: Dict = {}): Dict {
  return {
    scope: "project",
    kind: "claude_md",
    rel_path: rel,
    name: rel.split("/").pop(),
    title: "",
    exists: false,
    paths: [],
    bytes: 0,
    mirror: "none",
    ...over,
  };
}

const RULE_CONTENT = `---
paths:
  - "src/api/**/*.ts"
---

# API 규칙

- 입력 검증 필수
`;

const fx = {
  overview: {} as Dict,
  config: {} as Dict,
  calls: {
    save: [] as unknown[][],
    del: [] as unknown[][],
    sync: [] as unknown[][],
    setConfig: [] as unknown[][],
  },
};

function resetFixtures() {
  fx.overview = {
    claude_md: [
      claudeMdSlot("CLAUDE.md", { exists: true, title: "프로젝트 지침" }),
      claudeMdSlot(".claude/CLAUDE.md"),
      claudeMdSlot("CLAUDE.local.md"),
      claudeMdSlot(".claude/CLAUDE.md", { scope: "global" }),
    ],
    project_rules: [
      ruleEntry(),
      ruleEntry({
        rel_path: ".claude/rules/commit.md",
        name: "commit",
        title: "커밋 규칙",
        paths: [],
        mirror: "mirrored",
      }),
    ],
    global_rules: [
      ruleEntry({
        scope: "global",
        rel_path: ".claude/rules/style.md",
        name: "style",
        title: "전역 스타일",
        paths: [],
      }),
    ],
    project_rules_dir: "/tmp/proj/.claude/rules",
    global_rules_dir: "/home/u/.claude/rules",
    cursor_translate: false,
  };
  fx.config = {
    schema_version: 1,
    agents: {
      active: ["agents-md"],
      auto_detect_on_open: true,
      auto_sync_adapters: true,
      auto_reconcile: false,
      auto_journal_draft: false,
      rules_translate: [],
    },
  };
  fx.calls.save = [];
  fx.calls.del = [];
  fx.calls.sync = [];
  fx.calls.setConfig = [];
}

// Markdown 리치 렌더는 ThemeProvider 의존 — plain text 스텁 (skills_v2 패턴).
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

// 훅 탭이 재사용하는 설정 블록(OculpmSettings)의 opener 의존.
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "rulesList":
              return () => ok(fx.overview);
            case "rulesRead":
              return (_pid: number, scope: string, relPath: string) => {
                const all = [
                  ...(fx.overview.claude_md as Dict[]),
                  ...(fx.overview.project_rules as Dict[]),
                  ...(fx.overview.global_rules as Dict[]),
                ];
                const e =
                  all.find((x) => x.scope === scope && x.rel_path === relPath) ?? ruleEntry();
                return ok({ entry: e, content: RULE_CONTENT, abs_path: `/abs/${relPath}` });
              };
            case "rulesSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok({
                  entry: ruleEntry({ rel_path: a[3], scope: a[1] }),
                  mirror: null,
                });
              };
            case "rulesDelete":
              return (...a: unknown[]) => {
                fx.calls.del.push(a);
                return ok(null);
              };
            case "rulesSyncTranslations":
              return (...a: unknown[]) => {
                fx.calls.sync.push(a);
                return ok([
                  { target: "cursor", source_rel: ".claude/rules/commit.md", action: "written", mirror_rel: ".cursor/rules/commit.mdc" },
                ]);
              };
            case "oculpmGetConfig":
              return () => ok(fx.config);
            case "oculpmSetConfig":
              return (...a: unknown[]) => {
                fx.calls.setConfig.push(a);
                return ok(null);
              };
            case "skillsList":
              return () =>
                ok({
                  project: [],
                  global: [],
                  project_skills_dir: "/tmp/proj/.claude/skills",
                  global_skills_dir: "/home/u/.claude/skills",
                });
            case "claudeHooksStatus":
              return () =>
                ok({
                  installed: true,
                  partial: false,
                  foreign_hooks: false,
                  settings_path: "/tmp/proj/.claude/settings.local.json",
                  inbox_bytes: 0,
                });
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
import { RulesTab } from "@/features/skills/RulesTab";
import {
  isValidRuleName,
  parseRulePaths,
  ruleTemplate,
  setRulePaths,
} from "@/features/skills/rulesModel";

beforeEach(() => {
  resetFixtures();
});

afterEach(() => {
  cleanup();
});

describe("SkillsScreenV2 허브", () => {
  it("기본은 스킬 탭이고, 규칙/훅 탭으로 전환된다 + axe 위반 없음", async () => {
    const { container, getByRole, getByText, findByText, findAllByText } = render(
      <SkillsScreenV2 projectId={1} />,
    );

    // 기본 = 스킬 탭 (기존 화면 회귀 없음 — 빈 상태 문구).
    await findByText("아직 스킬이 없습니다");
    expect(getByRole("tab", { name: "스킬", selected: true })).toBeTruthy();

    // 규칙 탭 전환 → 규칙 목록.
    fireEvent.click(getByRole("tab", { name: "규칙" }));
    await findByText("api-validation");
    expect(getByText("CLAUDE 메모리")).toBeTruthy();

    // 훅 탭 전환 → CI0 블록 (설정과 동일 컴포넌트). "Claude Code 훅 연동" 은
    // 툴바 sub 와 블록 라벨 두 곳에 있다.
    fireEvent.click(getByRole("tab", { name: "훅" }));
    expect((await findAllByText("Claude Code 훅 연동")).length).toBeGreaterThan(0);
    await findByText("연동됨");

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});

describe("RulesTab", () => {
  const noTabs = <div />;

  it("고정 슬롯·프로젝트/전역 규칙을 그리고 첫 항목을 자동 선택한다 + axe", async () => {
    const { container, getByText, getAllByText, findAllByText } = render(
      <RulesTab projectId={1} tabs={noTabs} />,
    );

    await findAllByText("CLAUDE.md");
    // 존재 슬롯은 행으로, 미존재 슬롯은 "만들기" 고스트로.
    expect(getAllByText(/CLAUDE\.local\.md 만들기/).length).toBe(1);
    expect(getAllByText(/~\/\.claude\/CLAUDE\.md 만들기/).length).toBe(1);
    // 규칙 배지: paths 개수 / 항상 / Cursor 미러.
    expect(getByText("paths 1")).toBeTruthy();
    expect(getAllByText("항상").length).toBeGreaterThan(0);
    expect(getAllByText("Cursor").length).toBeGreaterThan(0);
    // 첫 존재 항목(CLAUDE.md)이 자동 선택돼 상세 헤더에 "항상 로드" 칩.
    await waitFor(() => expect(getByText("항상 로드")).toBeTruthy());

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("생성 모달 — kebab 검증 + paths 쉼표 입력 → rulesSave(create=true)", async () => {
    const { getByRole, getByLabelText } = render(<RulesTab projectId={1} tabs={noTabs} />);
    fireEvent.click(await waitFor(() => getByRole("button", { name: /새 규칙/ })));

    const dialog = getByRole("dialog", { name: "새 규칙 만들기" });
    const name = getByLabelText("이름 (파일명)");
    const submit = within(dialog).getByRole("button", { name: "만들기" });

    fireEvent.change(name, { target: { value: "Bad Name" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(name, { target: { value: "pr-check" } });
    fireEvent.change(getByLabelText(/paths/), {
      target: { value: "src/api/**/*.ts, docs/**" },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [pid, scope, relPath, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([pid, scope, relPath, create]).toEqual([1, "project", ".claude/rules/pr-check.md", true]);
    expect(content).toContain('  - "src/api/**/*.ts"');
    expect(content).toContain('  - "docs/**"');
    expect(content).toContain("# pr-check");
  });

  it("미존재 CLAUDE.md 슬롯 클릭 → 시드 본문으로 rulesSave(create=true)", async () => {
    const { getByText } = render(<RulesTab projectId={1} tabs={noTabs} />);
    const ghost = await waitFor(() => getByText(/CLAUDE\.local\.md 만들기/));
    fireEvent.click(ghost);

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [, scope, relPath, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([scope, relPath, create]).toEqual(["project", "CLAUDE.local.md", true]);
    expect(content).toContain("커밋하지 마세요");
  });

  it("편집 — paths 칩 추가가 draft frontmatter 를 치환하고 저장 계약을 지킨다", async () => {
    const { getByRole, getByLabelText, getAllByText } = render(
      <RulesTab projectId={1} tabs={noTabs} />,
    );
    // 프로젝트 규칙 선택 → 편집.
    fireEvent.click(await waitFor(() => getAllByText("api-validation")[0]));
    fireEvent.click(await waitFor(() => getByRole("button", { name: /편집/ })));

    const addInput = getByLabelText("paths glob 추가");
    fireEvent.change(addInput, { target: { value: "docs/**" } });
    fireEvent.keyDown(addInput, { key: "Enter" });

    const textarea = getByLabelText("규칙 원문 편집") as HTMLTextAreaElement;
    expect(textarea.value).toContain('  - "docs/**"');
    expect(textarea.value).toContain("# API 규칙");

    fireEvent.click(getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [, scope, relPath, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([scope, relPath, create]).toEqual(["project", ".claude/rules/api-validation.md", false]);
    expect(content).toContain('  - "docs/**"');
  });

  it("Cursor 병행 배포 토글 → config 저장(rules_translate) + sync 호출", async () => {
    const { getByLabelText } = render(<RulesTab projectId={1} tabs={noTabs} />);
    const toggle = await waitFor(() => getByLabelText(/Cursor 로 병행 배포/));
    fireEvent.click(toggle);

    await waitFor(() => expect(fx.calls.setConfig).toHaveLength(1));
    const [, newConfig] = fx.calls.setConfig[0] as [number, Dict];
    expect((newConfig.agents as Dict).rules_translate).toEqual(["cursor"]);
    await waitFor(() => expect(fx.calls.sync).toHaveLength(1));
  });

  it("규칙 삭제는 확인 모달을 거쳐 rulesDelete 를 호출한다 (CLAUDE.md 는 삭제 버튼 없음)", async () => {
    const { getByRole, getAllByText, queryByRole } = render(
      <RulesTab projectId={1} tabs={noTabs} />,
    );
    // 자동 선택된 CLAUDE.md 에는 삭제 버튼이 없어야 한다.
    await waitFor(() => getByRole("button", { name: /편집/ }));
    expect(queryByRole("button", { name: /삭제/ })).toBeNull();

    // 규칙 선택 → 삭제 버튼 등장 → 모달 확인.
    fireEvent.click(getAllByText("api-validation")[0]);
    fireEvent.click(await waitFor(() => getByRole("button", { name: /삭제/ })));
    const dialog = getByRole("dialog", { name: "규칙 삭제 확인" });
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(fx.calls.del).toHaveLength(1));
    expect(fx.calls.del[0]).toEqual([1, "project", ".claude/rules/api-validation.md"]);
  });
});

describe("rulesModel (순수 헬퍼)", () => {
  it("isValidRuleName — kebab-case 만", () => {
    for (const good of ["a", "api-check", "r_2"]) expect(isValidRuleName(good), good).toBe(true);
    for (const bad of ["", "Bad", "한글", "-x", "a b", "x".repeat(65)])
      expect(isValidRuleName(bad), bad).toBe(false);
  });

  it("parseRulePaths — 블록 리스트·인라인 배열·단일 문자열·없음", () => {
    expect(parseRulePaths(RULE_CONTENT)).toEqual(["src/api/**/*.ts"]);
    expect(parseRulePaths('---\npaths: ["a/**", \'b/*.ts\']\n---\nx')).toEqual([
      "a/**",
      "b/*.ts",
    ]);
    expect(parseRulePaths("---\npaths: docs/**\n---\nx")).toEqual(["docs/**"]);
    expect(parseRulePaths("# 본문뿐")).toEqual([]);
    expect(parseRulePaths("---\nother: 1\n---\nx")).toEqual([]);
  });

  it("setRulePaths — 치환·삽입·제거 시 다른 키와 본문을 보존한다", () => {
    // 치환: 다른 키(description)와 본문 유지.
    const src = '---\ndescription: 설명\npaths:\n  - "old/**"\n---\n\n# 제목\n본문\n';
    const replaced = setRulePaths(src, ["new/**", "b/*.ts"]);
    expect(replaced).toContain("description: 설명");
    expect(replaced).toContain('  - "new/**"');
    expect(replaced).toContain('  - "b/*.ts"');
    expect(replaced).not.toContain("old/**");
    expect(replaced).toContain("# 제목\n본문");

    // frontmatter 없는 파일에 삽입.
    const inserted = setRulePaths("# 제목\n본문\n", ["src/**"]);
    expect(inserted.startsWith('---\npaths:\n  - "src/**"\n---\n')).toBe(true);
    expect(inserted).toContain("# 제목\n본문");

    // paths 만 있던 frontmatter 에서 전부 제거 → 블록째 사라진다.
    const removed = setRulePaths('---\npaths:\n  - "a/**"\n---\n\n# 제목\n', []);
    expect(removed.startsWith("# 제목")).toBe(true);
    // 다른 키가 있으면 블록은 남는다.
    const kept = setRulePaths(src, []);
    expect(kept).toContain("description: 설명");
    expect(kept).not.toContain("paths:");
  });

  it("ruleTemplate — paths 유무에 따라 frontmatter 를 만들거나 생략한다", () => {
    const withPaths = ruleTemplate("api", ["src/**"]);
    expect(withPaths.startsWith('---\npaths:\n  - "src/**"\n---\n')).toBe(true);
    expect(withPaths).toContain("# api");
    const always = ruleTemplate("commit", []);
    expect(always.startsWith("# commit")).toBe(true);
    expect(always).not.toContain("---");
  });
});
