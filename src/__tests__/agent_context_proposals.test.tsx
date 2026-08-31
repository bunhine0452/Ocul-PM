import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";

// ─── AD-5/AD-6 — 자기정리 제안 3종의 화면 계약 ──────────────────────────────
//
// 여기서 고정하는 것은 판정이 아니라 **순서**다: 결정적 근거를 보여 주고,
// 사람이 누르고, 그때서야 파일이 바뀐다. 특히 범위 교정은 사용자 소유의 전역
// 규칙을 고치므로 반드시 백업 경로(`rules_save_with_backup`)로만 나가야 한다.

type Dict = Record<string, unknown>;

const ARKTS_REL = ".claude/rules/ecc/arkts/coding-style.md";
const ARKTS_ABS = `/home/u/${ARKTS_REL}`;
const ARKTS_CONTENT = `---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# ArkTS

- V2 상태 관리
`;

const fx = {
  calls: {
    backup: [] as unknown[][],
    save: [] as unknown[][],
    rewrite: [] as unknown[][],
  },
};

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const skill = (over: Dict = {}) => ({
    scope: "project",
    dir_name: "review-checklist",
    name: "review-checklist",
    description: "checklist",
    enabled: true,
    display_path: ".claude/skills/review-checklist",
    extra_files: 0,
    ...over,
  });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "skillsList":
              return () =>
                ok({
                  project: [skill()],
                  global: [],
                  project_skills_dir: "/p/.claude/skills",
                  global_skills_dir: "/home/u/.claude/skills",
                });
            case "rulesList":
              return () =>
                ok({
                  claude_md: [],
                  project_rules: [],
                  global_rules: [
                    {
                      scope: "global",
                      kind: "rule",
                      rel_path: ARKTS_REL,
                      name: "ecc/arkts/coding-style",
                      title: "ArkTS",
                      exists: true,
                      paths: ["**/*.ts", "**/*.tsx"],
                      bytes: 3200,
                      mirror: "none",
                    },
                  ],
                  project_rules_dir: "/p/.claude/rules",
                  global_rules_dir: "/home/u/.claude/rules",
                  cursor_translate: false,
                });
            case "rulesRead":
              return () =>
                ok({
                  entry: { scope: "global", kind: "rule", rel_path: ARKTS_REL, name: "x", title: "", exists: true, paths: ["**/*.ts"], bytes: 10, mirror: "none" },
                  content: ARKTS_CONTENT,
                  abs_path: ARKTS_ABS,
                });
            case "rulesSaveWithBackup":
              return (...a: unknown[]) => {
                fx.calls.backup.push(a);
                return ok({ entry: {}, mirror: null, backup_path: `${ARKTS_ABS}.bak` });
              };
            case "rulesScopeAudit":
              // 이 규칙의 glob 은 **살아 있다** (TS 파일이 있다) — 무관 판정은
              // 오직 "경로가 말하는 스택 ≠ 감지된 스택" 에서 나온다.
              return () =>
                ok([
                  {
                    scope: "global",
                    rel_path: ARKTS_REL,
                    abs_path: ARKTS_ABS,
                    name: "ecc/arkts/coding-style",
                    bytes: 3200,
                    globs: [{ glob: "**/*.ts", files: 40, unparsed: false }],
                    dead_globs: [],
                    live_globs: ["**/*.ts"],
                  },
                ]);
            case "detectStack":
              return () => ok(["typescript", "rust", "tauri"]);
            case "firingStats":
              return () =>
                ok({
                  stats: [
                    {
                      kind: "rule",
                      key: ARKTS_ABS,
                      label: "~/.claude/rules/ecc/arkts/coding-style.md",
                      count: 56,
                      bytes: 64_000,
                      sessions: 12,
                      last_workday: "20260828",
                    },
                  ],
                  since: "20260801",
                  until: "20260831",
                  sessions: 20,
                  bytes_per_session: 20 * 1024,
                  last_scan_at: 1_756_000_000,
                });
            case "firingRescan":
              return () => ok({ files_scanned: 0, rows_written: 0, no_transcripts: false, complete: true });
            case "skillsTriggerRewrite":
              return (...a: unknown[]) => {
                fx.calls.rewrite.push(a);
                return ok({
                  dir_name: "review-checklist",
                  current: "checklist",
                  proposed: "Use when opening a PR to run the review checklist",
                  rationale: "언제 쓰는지가 없었다",
                  content: '---\nname: review-checklist\ndescription: "Use when opening a PR to run the review checklist"\n---\n\n# x\n',
                });
              };
            case "skillsSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok(skill());
              };
            case "settingsGet":
              return (key: string) =>
                ok(key === "default_provider" ? "anthropic" : "claude-opus-5");
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

beforeEach(() => {
  fx.calls.backup = [];
  fx.calls.save = [];
  fx.calls.rewrite = [];
});
afterEach(() => cleanup());

describe("AD-6 범위 교정", () => {
  it("근거(감지 스택 · 주입 실측)를 보여 주고, 좁히기는 백업 경로로만 나간다", async () => {
    const { findByText, getByRole, getByText } = render(<SkillsScreenV2 projectId={1} />);

    await findByText("범위 교정");
    // 근거 — 규칙이 말하는 스택 vs 감지된 스택, 그리고 실측 비용.
    expect(getByText(/arkts 스택을 다루는데/)).toBeTruthy();
    expect(getByText(/56회 주입/)).toBeTruthy();
    // 64,000B / 20 세션 ≈ 3,200B ≈ 3KB.
    expect(getByText(/세션당 3KB/)).toBeTruthy();
    // 예산 바가 무관 조각을 따로 그린다.
    expect(getByText("무관(실측)")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: /범위 좁히기/ }));
    await waitFor(() => expect(fx.calls.backup).toHaveLength(1));
    const [pid, scope, relPath, content] = fx.calls.backup[0] as [number, string, string, string];
    expect([pid, scope, relPath]).toEqual([1, "global", ARKTS_REL]);
    // paths 행만 바뀌고 본문은 그대로 (setRulePaths 규율).
    expect(content).toContain('  - "**/*.ets"');
    expect(content).not.toContain('"**/*.tsx"');
    expect(content).toContain("# ArkTS");
    // 일반 저장 경로로는 절대 나가지 않는다 — 사용자 소유 파일이다.
    expect(fx.calls.save).toHaveLength(0);
  });
});

describe("AD-5 트리거 교정", () => {
  it("초안은 파일을 쓰지 않고, 승인해야 skillsSave(create=false) 가 불린다", async () => {
    const { findByText, getByRole } = render(<SkillsScreenV2 projectId={1} />);
    await findByText("트리거 교정");

    fireEvent.click(getByRole("button", { name: /설명 고쳐 쓰기/ }));
    await waitFor(() => expect(fx.calls.rewrite).toHaveLength(1));
    expect(fx.calls.rewrite[0]).toEqual([1, "project", "review-checklist", "anthropic", "claude-opus-5"]);
    // 초안 단계에서는 아무것도 저장되지 않는다.
    expect(fx.calls.save).toHaveLength(0);

    const dialog = await waitFor(() => getByRole("dialog", { name: "스킬 설명 재작성 초안" }));
    expect(within(dialog).getByText(/Use when opening a PR/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "적용" }));

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [, scope, dirName, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([scope, dirName, create]).toEqual(["project", "review-checklist", false]);
    expect(content).toContain('description: "Use when opening a PR to run the review checklist"');
  });
});
