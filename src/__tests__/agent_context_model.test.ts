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
  globReach,
  indexEvidence,
  indexFindings,
  classifyDormantSkill,
  dormantSkills,
  indexDormancySignals,
  indexNegations,
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
import type {
  AgentSurfaceOverview,
  FiringStat,
  NegationFinding,
  SkillDormancySignal,
  RuleScopeFinding,
  RulesOverview,
  SkillsOverview,
} from "@/lib/bindings";

const skill = (over: Partial<SkillsOverview["project"][number]> = {}) => ({
  scope: "project" as const,
  dir_name: "review-checklist",
  name: "review-checklist",
  description: "use when reviewing a PR",
  // Phase 5 — 능력 검색이 색인하는 말. 이 픽스처는 안 쓰므로 빈 배열.
  keywords: [] as string[],
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

// context-budget-truth A — 에이전트·커맨드 표면. 하네스가 매 세션 시스템
// 프롬프트에 목록으로 싣는 name+description 이 예산에서 통째로 빠져 있었다.
const surface: AgentSurfaceOverview = {
  agents: [
    {
      scope: "global",
      kind: "agent",
      rel_path: ".claude/agents/code-reviewer.md",
      name: "code-reviewer",
      description: "Reviews code.",
      bytes: 100,
      body_bytes: 5000,
    },
  ],
  commands: [
    {
      scope: "project",
      kind: "command",
      rel_path: ".claude/commands/deploy.md",
      name: "deploy",
      description: "Ship it.",
      bytes: 40,
      body_bytes: 900,
    },
  ],
  project_agents_dir: "/p/.claude/agents",
  global_agents_dir: "/home/u/.claude/agents",
  excludes_plugins: true,
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

// ─── context-budget-truth A — 누락돼 있던 표면 ────────────────────────────
describe("에이전트·커맨드 표면", () => {
  const withSurface = buildContextItems(skills, rules, buildFiringIndex([]), surface);
  const without = buildContextItems(skills, rules, buildFiringIndex([]));

  it("표면을 넘기지 않으면 종전 그대로다 (기존 호출부 무해)", () => {
    expect(without.some((i) => i.kind === "agent" || i.kind === "command")).toBe(false);
  });

  it("에이전트·커맨드가 목록에 오른다", () => {
    const agent = withSurface.find((i) => i.kind === "agent");
    const command = withSurface.find((i) => i.kind === "command");
    expect(agent?.name).toBe("code-reviewer");
    expect(command?.name).toBe("deploy");
    expect(agent?.path).toBe("~/.claude/agents/code-reviewer.md");
  });

  it("발동을 물을 수 없다 — 원장이 못 보는 대상에 '0회' 를 붙이면 거짓이다", () => {
    for (const i of withSurface.filter((x) => x.kind === "agent" || x.kind === "command")) {
      expect(i.measurable).toBe(false);
      // 계측이 끝났어도 휴면으로 강등되지 않는다.
      expect(isDormant(i, true)).toBe(false);
    }
  });

  it("예산에 surface 조각이 생기고 총합에 더해진다", () => {
    const before = computeBudget(without, 0, true);
    const after = computeBudget(withSurface, 0, true);
    const seg = after.segments.find((s) => s.id === "surface");
    expect(seg?.bytes).toBe(140);
    expect(after.totalBytes - before.totalBytes).toBe(140);
  });

  it("종류 필터가 에이전트와 커맨드를 가른다", () => {
    expect(filterItems(withSurface, "agent", "").map((i) => i.name)).toEqual(["code-reviewer"]);
    expect(filterItems(withSurface, "command", "").map((i) => i.name)).toEqual(["deploy"]);
  });

  it("정리·범위 교정 제안은 표면을 건드리지 않는다 (규칙 전용 처방)", () => {
    expect(cleanupProposals(withSurface, new Map(), true).every((p) => p.item.kind === "rule")).toBe(true);
    expect(scopeProposals(withSurface, [], 1, true).every((p) => p.item.kind === "rule")).toBe(true);
    expect(triggerProposals(withSurface, true).every((i) => i.kind === "skill")).toBe(true);
  });
});

// ─── context-budget-truth B — glob 이 실제로 무는 파일 수 ─────────────────
describe("globReach — 'paths 2' 가 숨기던 것", () => {
  const f = (over: Partial<RuleScopeFinding> = {}): RuleScopeFinding => ({
    scope: "global",
    rel_path: ".claude/rules/ecc/react-native/coding-style.md",
    abs_path: "/home/u/.claude/rules/ecc/react-native/coding-style.md",
    name: "react-native/coding-style",
    bytes: 4000,
    globs: [
      { glob: "**/*.ts", files: 900, unparsed: false },
      { glob: "**/*.tsx", files: 400, unparsed: false },
    ],
    dead_globs: [],
    live_globs: ["**/*.ts", "**/*.tsx"],
    ...over,
  });

  it("감사 전(=finding 없음)에는 아무것도 주장하지 않는다", () => {
    expect(globReach(undefined, 2000)).toBeNull();
  });

  it("파일 수는 glob 최댓값 — 겹침을 더해 부풀리지 않는다", () => {
    // 900 + 400 = 1300 이 아니라 900. 합집합의 하한이라 과장이 없다.
    expect(globReach(f(), 2000)?.files).toBe(900);
  });

  it("프로젝트의 30% 이상을 물면 '사실상 상시' 다", () => {
    expect(globReach(f(), 2000)?.deFactoAlways).toBe(true); // 900/2000 = 45%
    expect(globReach(f(), 10000)?.deFactoAlways).toBe(false); // 9%
  });

  it("분모가 0이면 비율 판정을 하지 않는다 — 0으로 나눈 결론은 근거가 아니다", () => {
    expect(globReach(f(), 0)?.deFactoAlways).toBe(false);
  });

  it("모든 glob 이 0개를 물면 dead", () => {
    const dead = f({
      globs: [{ glob: "**/*.ets", files: 0, unparsed: false }],
      dead_globs: ["**/*.ets"],
      live_globs: [],
    });
    expect(globReach(dead, 2000)?.dead).toBe(true);
  });

  it("해석 못 한 glob 이 섞이면 dead 라고 부르지 않는다 (판정 불가)", () => {
    const weird = f({
      globs: [{ glob: "{[", files: 0, unparsed: true }],
      dead_globs: [],
      live_globs: [],
    });
    const reach = globReach(weird, 2000);
    expect(reach?.unparsed).toBe(true);
    expect(reach?.dead).toBe(false);
  });
});

// ─── context-budget-truth C — 실려 놓고 부정되는 규칙 ─────────────────────
describe("cleanupProposals — negated", () => {
  const negation = (over: Partial<NegationFinding> = {}): NegationFinding => ({
    scope: "project",
    rel_path: ".claude/rules/commit.md",
    bytes: 512,
    cited_in: "CLAUDE.md",
    excerpt: "→ **따르지 않는다.** 테스트는 요청된 범위 안에서 쓴다.",
    ...over,
  });
  const items = buildContextItems(skills, rules, buildFiringIndex([]));

  it("항상 로드 규칙도 후보가 된다 — 그게 바로 양쪽으로 내는 경우다", () => {
    // `.claude/rules/commit.md` 는 paths 가 비어 항상 로드다. 종전 정리 제안은
    // pathCount 가드 때문에 이런 규칙을 아예 보지 못했다.
    const out = cleanupProposals(items, new Map(), false, indexNegations([negation()]));
    const found = out.find((p) => p.reason === "negated");
    expect(found?.item.path).toBe(".claude/rules/commit.md");
    expect(found?.negation?.citedIn).toBe("CLAUDE.md");
    expect(found?.negation?.excerpt).toContain("따르지 않는다");
  });

  it("근거 발췌 없이는 부정을 주장하지 않는다 (색인이 비면 조용하다)", () => {
    const out = cleanupProposals(items, new Map(), false, new Map());
    expect(out.some((p) => p.reason === "negated")).toBe(false);
  });

  it("부정된 규칙은 dormant/never-matches 로 중복 계상되지 않는다", () => {
    const found = indexFindings([
      {
        scope: "project",
        rel_path: ".claude/rules/api.md",
        abs_path: "/p/.claude/rules/api.md",
        name: "api",
        bytes: 300,
        globs: [{ glob: "src/api/**/*.ts", files: 0, unparsed: false }],
        dead_globs: ["src/api/**/*.ts"],
        live_globs: [],
      },
    ]);
    const out = cleanupProposals(
      items,
      found,
      true,
      indexNegations([negation({ rel_path: ".claude/rules/api.md" })]),
    );
    const forApi = out.filter((p) => p.item.path === ".claude/rules/api.md");
    expect(forApi).toHaveLength(1);
    expect(forApi[0].reason).toBe("negated");
  });

  it("스킬·메모리·표면은 부정 후보가 아니다 (규칙 전용 진단)", () => {
    const out = cleanupProposals(items, new Map(), false, indexNegations([negation()]));
    expect(out.every((p) => p.item.kind === "rule")).toBe(true);
  });
});

// ─── context-budget-truth D — 「0회」의 네 가지 이유 ───────────────────────
describe("classifyDormantSkill — 0회는 결함이 아니라 네 상태다", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([]));
  const item = items.find((i) => i.kind === "skill" && !i.disabled)!;
  const sig = (over: Partial<SkillDormancySignal> = {}): SkillDormancySignal => ({
    scope: "project",
    dir_name: "review-checklist",
    missing_files: [],
    suppressed_in: null,
    suppressed_excerpt: null,
    age_days: 90,
    ...over,
  });

  it("선행조건 파일이 없으면 precondition-missing — 설명 문제가 아니다", () => {
    const d = classifyDormantSkill(item, sig({ missing_files: ["EVALS.md"] }), 30);
    expect(d.reason).toBe("precondition-missing");
    expect(d.missingFiles).toEqual(["EVALS.md"]);
  });

  it("CLAUDE.md 가 억제해 두었으면 suppressed — 의도된 침묵", () => {
    const d = classifyDormantSkill(
      item,
      sig({ suppressed_in: "~/.claude/CLAUDE.md", suppressed_excerpt: "요청할 때만 쓴다" }),
      30,
    );
    expect(d.reason).toBe("suppressed");
    expect(d.suppression?.citedIn).toBe("~/.claude/CLAUDE.md");
  });

  it("계측 창보다 새 파일이면 too-new — 0회를 주장할 근거가 없다", () => {
    expect(classifyDormantSkill(item, sig({ age_days: 0 }), 30).reason).toBe("too-new");
    expect(classifyDormantSkill(item, sig({ age_days: 29 }), 30).reason).toBe("too-new");
    expect(classifyDormantSkill(item, sig({ age_days: 30 }), 30).reason).toBe("genuine");
  });

  it("나이를 못 읽으면(null) 새 파일로 봐 주지 않는다", () => {
    expect(classifyDormantSkill(item, sig({ age_days: null }), 30).reason).toBe("genuine");
  });

  it("신호가 아예 없으면 genuine — 종전 동작 유지", () => {
    expect(classifyDormantSkill(item, undefined, 30).reason).toBe("genuine");
  });

  it("우선순위: 선행조건 > 억제 > 나이", () => {
    const all = sig({
      missing_files: ["EVALS.md"],
      suppressed_in: "CLAUDE.md",
      age_days: 0,
    });
    expect(classifyDormantSkill(item, all, 30).reason).toBe("precondition-missing");
  });
});

describe("triggerProposals — genuine 에만 설명 고쳐쓰기를 낸다", () => {
  const items = buildContextItems(skills, rules, buildFiringIndex([]));
  const active = items.find((i) => i.kind === "skill" && !i.disabled)!;
  const signals = indexDormancySignals([
    {
      scope: "project",
      dir_name: "review-checklist",
      missing_files: ["EVALS.md"],
      suppressed_in: null,
      suppressed_excerpt: null,
      age_days: 90,
    },
  ]);

  it("계측 전에는 아무것도 제안하지 않는다 (종전 규율)", () => {
    expect(triggerProposals(items, false, signals, 30)).toEqual([]);
    expect(dormantSkills(items, signals, false, 30)).toEqual([]);
  });

  it("이유가 밝혀진 0회는 트리거 교정 후보에서 빠진다", () => {
    expect(triggerProposals(items, true, signals, 30).map((i) => i.id)).not.toContain(active.id);
    // 그래도 목록에서 사라지지는 않는다 — 이유를 밝혀 준다.
    const d = dormantSkills(items, signals, true, 30).find((x) => x.item.id === active.id);
    expect(d?.reason).toBe("precondition-missing");
  });

  it("신호가 없으면 종전처럼 후보가 된다", () => {
    expect(triggerProposals(items, true, new Map(), 30).map((i) => i.id)).toContain(active.id);
  });

  it("비활성 스킬은 애초에 대상이 아니다", () => {
    const disabled = items.find((i) => i.kind === "skill" && i.disabled)!;
    expect(dormantSkills(items, new Map(), true, 30).map((d) => d.item.id)).not.toContain(
      disabled.id,
    );
  });
});

// ─── evidence-based-rules — 규칙에 근거를 잇는다 ──────────────────────────
//
// 이 색인의 값어치는 **침묵**에 있다: 근거가 안 붙은 규칙에 「근거 0」을 달면
// 화면이 "쓸모없다"고 말하는 셈인데, 우리 연결은 표지 기반 휴리스틱이라 그
// 결론을 지지하지 않는다.

const cluster = (id: string, label: string, days: string[], gap = 3) => ({
  id,
  label,
  typical_gap_days: gap,
  last_gap_days: gap,
  last_seen: days[0],
  hits: days.map((workday, i) => ({
    rel_path: `${workday}/Bugs/100${i}_bug_x.md`,
    workday,
    title: "제목",
    excerpt: "발췌",
    marker: "고아",
  })),
});

describe("indexEvidence", () => {
  it("근거가 붙은 규칙만 색인에 들어간다", () => {
    const index = indexEvidence({
      clusters: [cluster("orphan-process", "고아 프로세스", ["20260903", "20260901"])],
      links: [
        { rel_path: ".claude/rules/pty.md", scope: "project", cluster_ids: ["orphan-process"] },
      ],
    });
    expect(index.size).toBe(1);
    expect(index.get("rule:project:.claude/rules/pty.md")).toEqual({
      labels: ["고아 프로세스"],
      hits: 2,
      lastSeen: "20260903",
      typicalGapDays: 3,
    });
    // 안 이어진 규칙은 **없는 것**이지 0이 아니다.
    expect(index.get("rule:project:.claude/rules/other.md")).toBeUndefined();
  });

  it("여러 클러스터에 걸린 규칙은 일지를 경로로 중복 제거해 센다", () => {
    const index = indexEvidence({
      clusters: [
        cluster("orphan-process", "고아", ["20260903", "20260901"]),
        // 같은 날 같은 일지가 두 클러스터에 걸린다 — 두 번 세면 근거가 부풀려진다.
        { ...cluster("silent-failure", "조용한 실패", ["20260903"]), last_seen: "20260902" },
      ],
      links: [
        {
          rel_path: ".claude/rules/pty.md",
          scope: "project",
          cluster_ids: ["orphan-process", "silent-failure"],
        },
      ],
    });
    const summary = index.get("rule:project:.claude/rules/pty.md");
    expect(summary?.hits).toBe(2);
    // 라벨은 최근 재발순 — 최신 클러스터가 먼저.
    expect(summary?.labels).toEqual(["고아", "조용한 실패"]);
    expect(summary?.lastSeen).toBe("20260903");
  });

  it("근거가 없으면 빈 색인 — null 응답도 조용히 접는다", () => {
    expect(indexEvidence(null).size).toBe(0);
    expect(indexEvidence({ clusters: [], links: [] }).size).toBe(0);
  });
});
