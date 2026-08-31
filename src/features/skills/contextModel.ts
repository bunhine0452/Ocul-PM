// AD-3 — "에이전트에게 걸려 있는 것" 단일 화면의 순수 모델
// (docs/agent-discipline/00-master-plan.md D2).
//
// 5탭(스킬·샵·규칙·훅·플러그인) 허브는 **종류별 파일 관리자**였다. 사용자가
// 알고 싶은 건 종류가 아니라 "지금 이 프로젝트의 에이전트가 무엇을 읽고
// 있는가 · 그게 실제로 걸리는가 · 얼마를 먹는가" 다. 그래서 스킬·규칙·
// CLAUDE.md 를 한 목록으로 접고, 종류는 필터로 강등한다.
//
// 이 파일에는 DOM·커맨드가 없다 — 목록 접기·예산 계산·휴면 판정은 전부
// 순수 함수라 테스트가 화면 없이 계약을 고정한다 (firingModel 과 같은 규율).

import type {
  FiringStat,
  RuleEntry,
  RuleScopeFinding,
  RulesOverview,
  SkillEntry,
  SkillsOverview,
} from "@/lib/bindings";
import { ruleAbsPath, skillFiring, type FiringIndex } from "./firingModel";

/** 목록의 종류 — 필터 값이자 배지 라벨의 판별자. */
export type ContextKind = "skill" | "rule" | "memory";
export type ContextScope = "project" | "global";

/** 통합 목록의 한 줄. 원본(`skill`/`rule`)은 편집기로 그대로 넘긴다. */
export interface ContextItem {
  /** 안정 키 — `kind:scope:ref`. */
  id: string;
  kind: ContextKind;
  scope: ContextScope;
  /** 표시명. */
  name: string;
  /** 부제 — 스킬 description · 규칙 H1. */
  sub: string;
  /** 표시 경로 (전역은 `~/` 접두). */
  path: string;
  /**
   * 세션마다 무조건 들어가는가. CLAUDE.md 계열과 `paths` 없는 규칙이 그렇다 —
   * 비용이 확정이라 예산 바의 첫 조각이 된다.
   */
  alwaysOn: boolean;
  /** 비활성(`.disabled/`) 스킬 — 로드되지 않으므로 예산에서 뺀다. */
  disabled: boolean;
  /** 조건부 규칙의 `paths` 개수 (0 = 해당 없음). */
  pathCount: number;
  /** 디스크 바이트 (규칙) · description 바이트 (스킬). */
  bytes: number;
  /**
   * 발동을 물을 수 있는 항목인가. 항상-로드 규칙은 transcript 에
   * `nested_memory` 로 찍히지 않아 "0회" 가 거짓이 된다 — 묻지 않는다.
   */
  measurable: boolean;
  /** 창 안의 발동 통계 (없으면 미관측). */
  firing?: FiringStat;
  skill?: SkillEntry;
  rule?: RuleEntry;
}

/** UTF-8 바이트 수 — 사전이 한국어라 문자 수로 세면 절반쯤 어긋난다. */
export function utf8Bytes(text: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  // jsdom 밖 환경 폴백 — 실측 대신 보수적 근사(ASCII 1 · 그 외 3).
  let total = 0;
  for (const ch of text) total += ch.charCodeAt(0) < 128 ? 1 : 3;
  return total;
}

const skillId = (e: SkillEntry) => `skill:${e.scope}:${e.dir_name}`;
const ruleId = (e: RuleEntry) => `${e.kind === "claude_md" ? "memory" : "rule"}:${e.scope}:${e.rel_path}`;

/** 규칙 항목의 표시 경로 — 전역은 스코프를 드러낸다. */
export function ruleDisplayPath(e: RuleEntry): string {
  return e.scope === "global" ? `~/${e.rel_path}` : e.rel_path;
}

function skillItem(e: SkillEntry, index: FiringIndex): ContextItem {
  return {
    id: skillId(e),
    kind: "skill",
    scope: e.scope,
    name: e.name || e.dir_name,
    sub: e.description,
    path: `${e.display_path}/SKILL.md`,
    alwaysOn: false,
    disabled: !e.enabled,
    pathCount: 0,
    // 스킬이 세션마다 먹는 것은 본문이 아니라 **이름+description** 이다
    // (본문은 발동해야 읽힌다). 예산 바가 세는 것도 그 광고 비용이다.
    bytes: e.enabled ? utf8Bytes(e.name) + utf8Bytes(e.description) : 0,
    measurable: true,
    firing: skillFiring(index, e),
  };
}

function ruleItem(e: RuleEntry, overview: RulesOverview, index: FiringIndex): ContextItem {
  const always = e.kind === "claude_md" || e.paths.length === 0;
  return {
    id: ruleId(e),
    kind: e.kind === "claude_md" ? "memory" : "rule",
    scope: e.scope,
    name: e.kind === "claude_md" ? ruleDisplayPath(e) : e.name,
    sub: e.title,
    path: ruleDisplayPath(e),
    alwaysOn: always,
    disabled: false,
    pathCount: e.paths.length,
    bytes: e.bytes,
    measurable: !always,
    firing: index.rules.get(ruleAbsPath(e, overview)),
  };
}

/**
 * 스킬·규칙·CLAUDE.md 를 한 목록으로 접는다. 아직 안 만든 CLAUDE.md 슬롯
 * (`exists=false`)은 걸려 있는 것이 아니므로 제외한다 — 만들기는 존 3 의
 * "추가하기" 가 맡는다.
 */
export function buildContextItems(
  skills: SkillsOverview | null,
  rules: RulesOverview | null,
  index: FiringIndex,
): ContextItem[] {
  const items: ContextItem[] = [];
  if (skills) {
    for (const e of [...skills.project, ...skills.global]) items.push(skillItem(e, index));
  }
  if (rules) {
    for (const e of [
      ...rules.claude_md.filter((c) => c.exists),
      ...rules.project_rules,
      ...rules.global_rules,
    ]) {
      items.push(ruleItem(e, rules, index));
    }
  }
  // 원본을 나중에 붙인다 — 위 두 갈래가 서로의 타입을 몰라도 되게.
  const bySkill = new Map<string, SkillEntry>();
  for (const e of [...(skills?.project ?? []), ...(skills?.global ?? [])]) bySkill.set(skillId(e), e);
  const byRule = new Map<string, RuleEntry>();
  for (const e of [
    ...(rules?.claude_md ?? []),
    ...(rules?.project_rules ?? []),
    ...(rules?.global_rules ?? []),
  ]) {
    byRule.set(ruleId(e), e);
  }
  return items.map((item) => ({
    ...item,
    skill: bySkill.get(item.id),
    rule: byRule.get(item.id),
  }));
}

/**
 * 휴면 판정 — **계측이 돌았고**, 물을 수 있는 항목이고, 창 안 발동이 0.
 * 계측 전(`measured=false`)에 0회를 주장하면 거짓이다 (FiringBadge 와 동일 규율).
 */
export function isDormant(item: ContextItem, measured: boolean): boolean {
  if (item.disabled) return true;
  if (!measured || !item.measurable) return false;
  return (item.firing?.count ?? 0) === 0;
}

const firingCount = (item: ContextItem) => item.firing?.count ?? 0;

/** 기본 정렬 — 발동 많은 순, 같으면 이름순 (안정적). */
export function sortByFiring(items: ContextItem[]): ContextItem[] {
  return [...items].sort(
    (a, b) => firingCount(b) - firingCount(a) || a.name.localeCompare(b.name),
  );
}

/**
 * 목록을 살아 있는 것/휴면으로 가른다. 휴면은 접힌 하단 섹션으로 내려가
 * **목록이 스스로 청소된다** (D2 존 2).
 */
export function partitionItems(
  items: ContextItem[],
  measured: boolean,
): { live: ContextItem[]; dormant: ContextItem[] } {
  const live: ContextItem[] = [];
  const dormant: ContextItem[] = [];
  for (const item of items) (isDormant(item, measured) ? dormant : live).push(item);
  return { live: sortByFiring(live), dormant: sortByFiring(dormant) };
}

/** 종류 필터 + 검색어. 검색은 이름·부제·경로를 본다. */
export function filterItems(
  items: ContextItem[],
  kind: ContextKind | "all",
  query: string,
): ContextItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.sub.toLowerCase().includes(q) ||
      item.path.toLowerCase().includes(q)
    );
  });
}

/** 예산 바의 한 조각. */
export interface BudgetSegment {
  id: "always" | "conditional" | "irrelevant" | "skills";
  bytes: number;
}

export interface ContextBudget {
  segments: BudgetSegment[];
  /** 세 조각의 합 (바이트/세션). */
  totalBytes: number;
  /** 조건부 조각이 실측인가 — 계측 전에는 "아직 모른다" 로 그린다. */
  measured: boolean;
}

/**
 * 세션당 컨텍스트 예산.
 *
 * - **항상 로드** — CLAUDE.md + `paths` 없는 규칙의 디스크 바이트. 확정 비용이다.
 * - **조건부(실측)** — 원장이 transcript 에서 센 세션당 규칙 주입 바이트.
 *   추정이 아니라 관측이라 규칙 다이어트(D4)의 근거가 된다.
 * - **무관(실측)** — 그 조건부 주입 중, 이 프로젝트가 안 쓰는 스택의 규칙이
 *   먹은 몫(AD-6 범위 교정 후보). 조건부에서 **떼어내** 따로 그린다 — 되찾을
 *   수 있는 양이 숫자로 보여야 줄일 마음이 든다.
 * - **스킬 안내** — 활성 스킬의 이름+description. 스킬 본문은 발동해야 읽히므로
 *   세지 않는다.
 */
export function computeBudget(
  items: ContextItem[],
  bytesPerSession: number,
  measured: boolean,
  irrelevantBytes = 0,
): ContextBudget {
  const always = items
    .filter((i) => i.alwaysOn && !i.disabled)
    .reduce((sum, i) => sum + i.bytes, 0);
  const skills = items
    .filter((i) => i.kind === "skill" && !i.disabled)
    .reduce((sum, i) => sum + i.bytes, 0);
  const conditional = Math.max(0, bytesPerSession);
  // 무관 조각은 조건부 **안에서** 떼어낸다 — 합이 두 번 세어지면 예산이 거짓이 된다.
  const irrelevant = Math.min(conditional, Math.max(0, irrelevantBytes));
  const segments: BudgetSegment[] = [
    { id: "always", bytes: always },
    { id: "conditional", bytes: conditional - irrelevant },
    { id: "irrelevant", bytes: irrelevant },
    { id: "skills", bytes: skills },
  ];
  return {
    segments,
    totalBytes: always + conditional + skills,
    measured,
  };
}

/** 예산 바의 눈금 — 재설계 목표치(마스터플랜 §5). */
export const BUDGET_TARGET_BYTES = 30 * 1024;
/** 2026-08-29 이 저장소 실측 기준선 — 목표 대비 "지금 어디" 를 말해 준다. */
export const BUDGET_BASELINE_BYTES = 90 * 1024;

/** KB 반올림 (0 은 0 으로 — "0KB" 가 "측정 안 됨" 처럼 읽히지 않게 호출부가 가른다). */
export function kb(bytes: number): number {
  return Math.round(bytes / 1024);
}

// ─────────────────────────────────────────────────────────────────────────────
// AD-5/AD-6 — 자기정리 제안 (docs/agent-discipline/00-master-plan.md D2 존 3 · D4)
//
// 셋 다 **결정적**이다 (LLM 0): 규칙 경로가 말하는 스택 vs 실제 감지된 스택,
// glob 이 이 프로젝트에서 매칭하는 파일 수, 원장의 30일 발동 횟수. 판정만 하고
// 파일은 건드리지 않는다 — 처방은 전부 사용자의 승인 경로다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 규칙 경로가 드러내는 **스택 가족** → (감지 태그, 그 스택의 표준 glob).
 *
 * ECC 류 규칙 팩은 `~/.claude/rules/ecc/<스택>/coding-style.md` 처럼 스택을
 * 디렉터리 이름으로 드러낸다. 그런데 그 파일의 `paths` 는 "모든 .ts·.tsx" 처럼
 * 넓어서, TypeScript 파일 하나만 만져도 HarmonyOS·React Native 규율이 통째로
 * 딸려온다 (2026-08-29 실측: 세션당 30파일 90KB 중 무관 3세트).
 *
 * `globs` 가 비면 확장자로 그 스택을 가릴 수 없다는 뜻이다 — 그때는 좁히기를
 * **제안하지 않고** 비용만 보여 준다. 틀린 glob 을 제안하는 것보다 낫다.
 */
const STACK_FAMILIES: Record<string, { tag: string; globs: string[] }> = {
  arkts: { tag: "arkts", globs: ["**/*.ets"] },
  harmonyos: { tag: "arkts", globs: ["**/*.ets"] },
  "react-native": { tag: "react-native", globs: [] },
  vue: { tag: "vue", globs: ["**/*.vue"] },
  nuxt: { tag: "vue", globs: ["**/*.vue"] },
  svelte: { tag: "svelte", globs: ["**/*.svelte"] },
  angular: { tag: "angular", globs: [] },
  swift: { tag: "swift", globs: ["**/*.swift"] },
  php: { tag: "php", globs: ["**/*.php"] },
  laravel: { tag: "laravel", globs: ["**/*.php"] },
  ruby: { tag: "ruby", globs: ["**/*.rb"] },
  rails: { tag: "ruby", globs: ["**/*.rb"] },
  golang: { tag: "go", globs: ["**/*.go"] },
  go: { tag: "go", globs: ["**/*.go"] },
  python: { tag: "python", globs: ["**/*.py"] },
  django: { tag: "django", globs: ["**/*.py"] },
  java: { tag: "java", globs: ["**/*.java"] },
  kotlin: { tag: "kotlin", globs: ["**/*.kt", "**/*.kts"] },
  csharp: { tag: "csharp", globs: ["**/*.cs"] },
  cpp: { tag: "cpp", globs: ["**/*.cpp", "**/*.hpp", "**/*.h"] },
  rust: { tag: "rust", globs: ["**/*.rs"] },
};

/** 경로 조각 중 스택 가족을 찾는다 (`.claude/rules/ecc/arkts/style.md` → `arkts`). */
export function stackFamilyOf(relPath: string): string | null {
  for (const segment of relPath.split("/")) {
    const key = segment.toLowerCase();
    if (STACK_FAMILIES[key]) return key;
  }
  return null;
}

/** 범위 교정 제안 — 이 프로젝트가 안 쓰는 스택의 규칙이 넓은 glob 으로 걸린다. */
export interface ScopeProposal {
  item: ContextItem;
  /** 규칙 경로가 말하는 스택 가족. */
  family: string;
  /** 감지된 프로젝트 스택 태그 (근거로 그대로 보여 준다). */
  detected: string[];
  /** 창 안의 주입 횟수 (0 = 미관측). */
  injections: number;
  /** 세션당 낭비 바이트 — 실측 주입 바이트 ÷ 관측 세션 수. */
  wastedPerSession: number;
  currentGlobs: string[];
  /** 제안하는 새 paths. 빈 배열이면 좁히기 액션을 내지 않는다. */
  suggestedGlobs: string[];
}

/** 정리 제안 — 절대 안 걸리거나(glob 매칭 0) 30일 발동 0회인 규칙. */
export interface CleanupProposal {
  item: ContextItem;
  reason: "never-matches" | "dormant";
  /** `never-matches` 의 근거 — 매칭 0개인 glob. */
  deadGlobs: string[];
}

/** 감사 결과를 규칙 항목 id 로 잇는 색인. */
export function indexFindings(findings: RuleScopeFinding[]): Map<string, RuleScopeFinding> {
  const map = new Map<string, RuleScopeFinding>();
  for (const f of findings) map.set(`rule:${f.scope}:${f.rel_path}`, f);
  return map;
}

const injectionsOf = (item: ContextItem) => item.firing?.count ?? 0;

/**
 * 범위 교정 후보. 계측이 끝난 뒤에는 **실제로 주입된 것만** 남긴다 — 안 걸리는
 * 규칙은 비용이 0이라 여기 낄 자리가 아니다 (그건 정리 카드의 몫).
 */
export function scopeProposals(
  items: ContextItem[],
  detected: string[],
  sessions: number,
  measured: boolean,
): ScopeProposal[] {
  const tags = new Set(detected);
  const out: ScopeProposal[] = [];
  for (const item of items) {
    if (item.kind !== "rule" || item.pathCount === 0 || !item.rule) continue;
    const family = stackFamilyOf(item.rule.rel_path);
    if (!family) continue;
    const entry = STACK_FAMILIES[family];
    if (tags.has(entry.tag)) continue;
    const injections = injectionsOf(item);
    if (measured && injections === 0) continue;
    out.push({
      item,
      family,
      detected,
      injections,
      wastedPerSession:
        sessions > 0 && item.firing ? Math.round(item.firing.bytes / sessions) : 0,
      currentGlobs: item.rule.paths,
      suggestedGlobs: entry.globs,
    });
  }
  return out.sort((a, b) => b.wastedPerSession - a.wastedPerSession || b.injections - a.injections);
}

/** 예산 바의 "무관" 조각 — 범위 교정 후보들이 세션마다 먹는 실측 바이트. */
export function irrelevantBytesPerSession(proposals: ScopeProposal[]): number {
  return proposals.reduce((sum, p) => sum + p.wastedPerSession, 0);
}

/**
 * 정리 후보. 두 근거가 있다:
 *  - `never-matches` — 모든 glob 이 이 프로젝트에서 0개를 문다. 계측 없이도 확정.
 *  - `dormant` — 계측이 돌았고 30일 발동 0회.
 * 스킬은 여기 넣지 않는다: 안 걸리는 스킬의 첫 처방은 삭제가 아니라
 * **트리거 교정**이라 아래 카드가 맡는다.
 */
export function cleanupProposals(
  items: ContextItem[],
  findings: Map<string, RuleScopeFinding>,
  measured: boolean,
): CleanupProposal[] {
  const out: CleanupProposal[] = [];
  for (const item of items) {
    if (item.kind !== "rule" || item.pathCount === 0) continue;
    const finding = findings.get(item.id);
    const dead = finding?.dead_globs ?? [];
    if (finding && dead.length > 0 && finding.live_globs.length === 0) {
      out.push({ item, reason: "never-matches", deadGlobs: dead });
      continue;
    }
    if (measured && injectionsOf(item) === 0) {
      out.push({ item, reason: "dormant", deadGlobs: dead });
    }
  }
  return out;
}

/**
 * 트리거 교정 후보 — 활성 스킬인데 30일 발동 0회. 계측 전에는 아무것도
 * 제안하지 않는다 (0회를 주장할 근거가 없다).
 */
export function triggerProposals(items: ContextItem[], measured: boolean): ContextItem[] {
  if (!measured) return [];
  return items.filter((i) => i.kind === "skill" && !i.disabled && injectionsOf(i) === 0);
}
