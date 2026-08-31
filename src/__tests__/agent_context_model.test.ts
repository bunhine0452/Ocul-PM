import { describe, expect, it } from "vitest";

// ─── AD-3/AD-4 — 3존 화면의 순수 모델 계약 ────────────────────────────────
//
// 화면 없이 고정해야 하는 것들이다: 무엇이 한 목록으로 접히는가, 무엇을
// "휴면" 이라 불러도 되는가(=거짓말하지 않는 조건), 예산 세 조각이 각각
// 어디서 오는가, 그리고 사건 화면이 넘기는 씨앗이 어떻게 계산되는가.

import {
  buildContextItems,
  cleanupProposals,
  computeBudget,
  filterItems,
  indexFindings,
  irrelevantBytesPerSession,
  isDormant,
  partitionItems,
  scopeProposals,
  stackFamilyOf,
  triggerProposals,
  utf8Bytes,
} from "@/features/skills/contextModel";
import { buildFiringIndex } from "@/features/skills/firingModel";
import {
  commandsToCodeBlock,
  firstSlug,
  ruleGlobsFromPaths,
  toSlug,
} from "@/lib/promoteSeed";
import type { FiringStat, RuleScopeFinding, RulesOverview, SkillsOverview } from "@/lib/bindings";

const skill = (over: Partial<SkillsOverview["project"][number]> = {}) => ({
  scope: "project" as const,
  dir_name: "review-checklist",
  name: "review-checklist",
  description: "use when reviewing a PR",
  enabled: true,
  display_path: ".claude/skills/review-checklist",
  extra_files: 0,
  ...over,
});

const rule = (over: Partial<RulesOverview["project_rules"][number]> = {}) => ({
  scope: "project" as const,
  kind: "rule" as const,
  rel_path: ".claude/rules/api.md",
  name: "api",
  title: "API 규칙",
  exists: true,
  paths: ["src/api/**/*.ts"],
  bytes: 300,
  mirror: "none" as const,
  ...over,
});

const skills: SkillsOverview = {
  project: [skill()],
  global: [
    skill({
      scope: "global",
      dir_name: "standup",
      name: "standup",
      enabled: false,
      description: "daily standup",
      display_path: "~/.claude/skills/.disabled/standup",
    }),
  ],
  project_skills_dir: "/p/.claude/skills",
  global_skills_dir: "/home/u/.claude/skills",
};

const rules: RulesOverview = {
  claude_md: [
    rule({ kind: "claude_md", rel_path: "CLAUDE.md", name: "CLAUDE.md", paths: [], bytes: 2048 }),
    rule({ kind: "claude_md", rel_path: "CLAUDE.local.md", name: "CLAUDE.local.md", paths: [], bytes: 0, exists: false }),
  ],
  project_rules: [rule(), rule({ rel_path: ".claude/rules/commit.md", name: "commit", paths: [], bytes: 512 })],
  global_rules: [],
  project_rules_dir: "/p/.claude/rules",
  global_rules_dir: "/home/u/.claude/rules",
  cursor_translate: false,
};

const stat = (over: Partial<FiringStat> = {}): FiringStat => ({
  kind: "rule",
  key: "/p/.claude/rules/api.md",
  label: ".claude/rules/api.md",
  count: 12,
  bytes: 3600,
  sessions: 4,
  last_workday: "20260828",
  ...over,
});

describe("buildContextItems — 스킬·규칙·메모리를 한 목록으로", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([stat()]));

  it("아직 만들지 않은 CLAUDE.md 슬롯은 '걸려 있는 것' 이 아니다", () => {
    expect(items.map((i) => i.id)).not.toContain("memory:project:CLAUDE.local.md");
    expect(items).toHaveLength(5); // 스킬 2 + CLAUDE.md 1 + 규칙 2 (미존재 슬롯 제외)
  });

  it("항상 로드 여부가 종류가 아니라 paths 로 갈린다", () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("memory:project:CLAUDE.md")?.alwaysOn).toBe(true);
    expect(byId.get("rule:project:.claude/rules/commit.md")?.alwaysOn).toBe(true);
    expect(byId.get("rule:project:.claude/rules/api.md")?.alwaysOn).toBe(false);
  });

  it("항상-로드는 발동을 물을 대상이 아니다 (transcript 에 안 찍힌다)", () => {
    const always = items.find((i) => i.id === "memory:project:CLAUDE.md")!;
    const conditional = items.find((i) => i.id === "rule:project:.claude/rules/api.md")!;
    expect(always.measurable).toBe(false);
    expect(conditional.measurable).toBe(true);
    expect(conditional.firing?.count).toBe(12);
  });

  it("스킬의 비용은 본문이 아니라 이름+description (본문은 발동해야 읽힌다)", () => {
    const s = items.find((i) => i.id === "skill:project:review-checklist")!;
    expect(s.bytes).toBe(utf8Bytes("review-checklist") + utf8Bytes("use when reviewing a PR"));
    // 비활성 스킬은 로드되지 않으므로 0.
    expect(items.find((i) => i.id === "skill:global:standup")!.bytes).toBe(0);
  });
});

describe("휴면 판정 — 계측 전에는 0회를 주장하지 않는다", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([stat()]));
  const conditional = items.find((i) => i.id === "rule:project:.claude/rules/commit.md")!;

  it("계측이 안 돌았으면 아무것도 강등하지 않는다", () => {
    expect(isDormant({ ...conditional, measurable: true, firing: undefined }, false)).toBe(false);
  });

  it("계측이 돌았고 발동 0회면 휴면", () => {
    expect(isDormant({ ...conditional, measurable: true, firing: undefined }, true)).toBe(true);
  });

  it("비활성 스킬은 계측과 무관하게 휴면 (로드 자체가 안 된다)", () => {
    expect(isDormant(items.find((i) => i.id === "skill:global:standup")!, false)).toBe(true);
  });

  it("partitionItems — 발동 많은 순 정렬 + 휴면 분리", () => {
    const { live, dormant } = partitionItems(items, true);
    expect(live[0].id).toBe("rule:project:.claude/rules/api.md"); // 12회
    expect(dormant.map((i) => i.id)).toContain("skill:global:standup");
    expect(dormant.map((i) => i.id)).toContain("skill:project:review-checklist");
  });
});

describe("filterItems — 종류는 탭이 아니라 필터", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([]));

  it("종류로 거른다", () => {
    expect(filterItems(items, "skill", "").every((i) => i.kind === "skill")).toBe(true);
    expect(filterItems(items, "memory", "").map((i) => i.name)).toEqual(["CLAUDE.md"]);
  });

  it("검색은 이름·부제·경로를 본다 (대소문자 무시)", () => {
    // 이름 — 대소문자 무시.
    expect(filterItems(items, "all", "REVIEW").map((i) => i.name)).toEqual(["review-checklist"]);
    // 경로 — 이름·부제 어디에도 없는 조각으로 찾힌다.
    expect(filterItems(items, "all", ".disabled").map((i) => i.name)).toEqual(["standup"]);
    // 부제 — 여러 항목이 같은 제목을 쓰면 전부 걸린다 (필터지 검색엔진이 아니다).
    expect(filterItems(items, "rule", "API 규칙").map((i) => i.name).sort()).toEqual([
      "api",
      "commit",
    ]);
  });
});

describe("computeBudget — 세 조각의 출처가 다르다", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([]));

  it("항상-로드는 디스크 바이트 합, 조건부는 실측값, 스킬은 광고 비용", () => {
    const budget = computeBudget(items, 22 * 1024, true);
    const seg = Object.fromEntries(budget.segments.map((s) => [s.id, s.bytes]));
    expect(seg.always).toBe(2048 + 512); // CLAUDE.md + paths 없는 규칙
    expect(seg.conditional).toBe(22 * 1024);
    expect(seg.skills).toBe(utf8Bytes("review-checklist") + utf8Bytes("use when reviewing a PR"));
    expect(budget.totalBytes).toBe(seg.always + seg.conditional + seg.skills);
  });

  it("계측 전에는 조건부가 0 이고 그 사실이 플래그로 남는다", () => {
    expect(computeBudget(items, 0, false).measured).toBe(false);
  });
});

describe("promoteSeed — 사건 화면이 넘기는 씨앗", () => {
  it("toSlug / firstSlug — 라틴 문자가 없으면 자동 이름을 지어내지 않는다", () => {
    expect(toSlug("Fix API Validation!")).toBe("fix-api-validation");
    expect(toSlug("한글 제목")).toBe("");
    expect(firstSlug("한글 제목", "fallback-name")).toBe("fallback-name");
    expect(firstSlug("한글", null, undefined)).toBe("");
  });

  it("ruleGlobsFromPaths — 파일이 많이 모인 디렉터리 순, 루트 파일은 건너뛴다", () => {
    expect(
      ruleGlobsFromPaths([
        "src/api/a.ts",
        "src/api/b.ts",
        "src/ui/c.tsx",
        "README.md",
      ]),
    ).toEqual(["src/api/**", "src/ui/**"]);
    expect(ruleGlobsFromPaths(["a.ts"])).toEqual([]);
    expect(ruleGlobsFromPaths(["x/1", "y/1", "z/1", "w/1"], 2)).toHaveLength(2);
  });

  it("commandsToCodeBlock — 빈 줄·연속 중복을 접고, 없으면 빈 문자열", () => {
    expect(commandsToCodeBlock(["pnpm test", " ", "pnpm test", "pnpm build"])).toBe(
      "```bash\npnpm test\npnpm build\n```",
    );
    expect(commandsToCodeBlock([" ", ""])).toBe("");
  });
});


// ─── Phase 3 (AD-5/AD-6) — 자기정리 제안의 판정 계약 ────────────────────────

/** ECC 류 전역 규칙: 경로는 arkts 를 말하는데 glob 은 모든 TS 를 문다. */
const arkts = rule({
  scope: "global",
  rel_path: ".claude/rules/ecc/arkts/coding-style.md",
  name: "ecc/arkts/coding-style",
  paths: ["**/*.ts", "**/*.tsx"],
  bytes: 3200,
});

const withGlobal = (extra: RulesOverview["global_rules"]): RulesOverview => ({
  ...rules,
  global_rules: extra,
});

describe("stackFamilyOf — 규칙 경로가 스택을 드러낸다", () => {
  it("경로 조각에서 가족을 읽는다", () => {
    expect(stackFamilyOf(".claude/rules/ecc/arkts/coding-style.md")).toBe("arkts");
    expect(stackFamilyOf(".claude/rules/ecc/react-native/testing.md")).toBe("react-native");
    expect(stackFamilyOf(".claude/rules/ecc/common/testing.md")).toBeNull();
    expect(stackFamilyOf(".claude/rules/api-validation.md")).toBeNull();
  });
});

describe("scopeProposals — 안 쓰는 스택의 규칙이 넓은 glob 으로 걸린다", () => {
  const items = () =>
    buildContextItems(
      skills,
      withGlobal([arkts]),
      buildFiringIndex([
        stat({ key: "/home/u/.claude/rules/ecc/arkts/coding-style.md", count: 56, bytes: 64_000 }),
      ]),
    );

  it("감지된 스택에 없는 가족만 제안하고, 세션당 낭비를 실측으로 센다", () => {
    const props = scopeProposals(items(), ["typescript", "rust", "tauri"], 20, true);
    expect(props).toHaveLength(1);
    expect(props[0].family).toBe("arkts");
    expect(props[0].injections).toBe(56);
    expect(props[0].wastedPerSession).toBe(3200); // 64,000 / 20 세션
    expect(props[0].suggestedGlobs).toEqual(["**/*.ets"]);
    expect(irrelevantBytesPerSession(props)).toBe(3200);
  });

  it("그 스택을 실제로 쓰면 제안하지 않는다", () => {
    expect(scopeProposals(items(), ["arkts"], 20, true)).toEqual([]);
  });

  it("계측이 끝났는데 한 번도 안 걸렸으면 비용이 0이라 제안하지 않는다", () => {
    const cold = buildContextItems(skills, withGlobal([arkts]), buildFiringIndex([]));
    expect(scopeProposals(cold, ["typescript"], 20, true)).toEqual([]);
    // 계측 전에는 glob 이 틀린 사실만으로 제안한다 (비용은 아직 모른다).
    expect(scopeProposals(cold, ["typescript"], 0, false)).toHaveLength(1);
  });
});

describe("cleanupProposals — 절대 안 걸리는 규칙과 휴면 규칙", () => {
  const finding = (over: Partial<RuleScopeFinding> = {}): RuleScopeFinding => ({
    scope: "project",
    rel_path: ".claude/rules/api.md",
    abs_path: "/p/.claude/rules/api.md",
    name: "api",
    bytes: 300,
    globs: [],
    dead_globs: ["src/api/**/*.ts"],
    live_globs: [],
    ...over,
  });

  it("매칭 0개는 계측 없이도 확정이다", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    const found = indexFindings([finding()]);
    const out = cleanupProposals(items, found, false);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("never-matches");
    expect(out[0].deadGlobs).toEqual(["src/api/**/*.ts"]);
  });

  it("살아 있는 glob 이 하나라도 있으면 계측 후 휴면으로만 걸린다", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    const found = indexFindings([finding({ dead_globs: [], live_globs: ["src/api/**/*.ts"] })]);
    expect(cleanupProposals(items, found, false)).toEqual([]);
    expect(cleanupProposals(items, found, true).map((p) => p.reason)).toEqual(["dormant"]);
  });
});

describe("triggerProposals — 안 걸리는 활성 스킬", () => {
  it("계측 전에는 아무것도 제안하지 않는다", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    expect(triggerProposals(items, false)).toEqual([]);
  });

  it("비활성 스킬은 제외한다 (이미 로드되지 않는다)", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    expect(triggerProposals(items, true).map((i) => i.name)).toEqual(["review-checklist"]);
  });
});

describe("computeBudget — 무관 조각은 조건부에서 떼어낸다", () => {
  it("합이 두 번 세어지지 않는다", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    const budget = computeBudget(items, 20 * 1024, true, 8 * 1024);
    const seg = Object.fromEntries(budget.segments.map((s) => [s.id, s.bytes]));
    expect(seg.conditional).toBe(12 * 1024);
    expect(seg.irrelevant).toBe(8 * 1024);
    expect(budget.totalBytes).toBe(seg.always + 20 * 1024 + seg.skills);
  });

  it("무관이 조건부보다 클 수 없다 (실측 창이 어긋나도 음수가 안 나온다)", () => {
    const items = buildContextItems(skills, rules, buildFiringIndex([]));
    const seg = Object.fromEntries(
      computeBudget(items, 1024, true, 99_999).segments.map((s) => [s.id, s.bytes]),
    );
    expect(seg.conditional).toBe(0);
    expect(seg.irrelevant).toBe(1024);
  });
});
