// AD-2 — 발동 배지의 순수 매칭 헬퍼 (docs/agent-discipline/00-master-plan.md D1).
//
// 백엔드 원장(`firing_stats`)은 transcript 에서 관측한 것을 **그대로의 키**로
// 돌려준다: 규칙은 절대경로, 스킬은 Claude Code 가 부른 이름(`oculpm:journal`
// 같은 플러그인 접두 포함). 화면의 목록은 그 키를 모르므로 (규칙은 스코프
// 상대경로, 스킬은 폴더명) 여기서 잇는다 — DOM·백엔드 없이 테스트 가능하다.

import type { FiringStat, RuleEntry, RulesOverview, SkillEntry } from "@/lib/bindings";

/** 백엔드 `commands/rules.rs` 의 규칙 폴더 규약 — rel_path 도 이 접두로 시작한다. */
const RULES_SUFFIX = "/.claude/rules";

/** 규칙 스코프 루트 — `<root>/.claude/rules` 에서 접두를 걷어낸다. */
function scopeRootOf(rulesDir: string): string {
  return rulesDir.endsWith(RULES_SUFFIX) ? rulesDir.slice(0, -RULES_SUFFIX.length) : rulesDir;
}

/**
 * 규칙 항목의 절대경로 — 원장 키와 같은 형태.
 * 프로젝트/전역에 같은 rel_path 가 있어도 스코프 루트가 달라 안 섞인다.
 */
export function ruleAbsPath(entry: RuleEntry, overview: RulesOverview): string {
  const dir = entry.scope === "project" ? overview.project_rules_dir : overview.global_rules_dir;
  return `${scopeRootOf(dir)}/${entry.rel_path}`;
}

/**
 * 스킬 발동 키의 정규화 — Claude Code 는 플러그인 스킬을 `plugin:skill` 로
 * 부른다. 마지막 `:` 뒤가 스킬 이름이다.
 */
export function normalizeSkillKey(key: string): string {
  const idx = key.lastIndexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/** 조회용 색인 — 키 → 통계. */
export interface FiringIndex {
  rules: Map<string, FiringStat>;
  skills: Map<string, FiringStat>;
}

/**
 * 통계 배열을 조회 색인으로 접는다. 스킬은 원본 키와 정규화 키 양쪽에
 * 넣어 `oculpm:foo` 로 발동한 것이 폴더명 `foo` 로도 찾힌다. 같은 정규화
 * 키에 여러 발동이 모이면 횟수를 합친다 (전역·플러그인 이중 등록 대비).
 */
export function buildFiringIndex(stats: FiringStat[]): FiringIndex {
  const rules = new Map<string, FiringStat>();
  const skills = new Map<string, FiringStat>();
  for (const stat of stats) {
    if (stat.kind === "rule") {
      rules.set(stat.key, stat);
      continue;
    }
    for (const key of new Set([stat.key, normalizeSkillKey(stat.key)])) {
      const prev = skills.get(key);
      skills.set(
        key,
        prev
          ? {
              ...prev,
              count: prev.count + stat.count,
              sessions: Math.max(prev.sessions, stat.sessions),
              last_workday:
                (prev.last_workday ?? "") >= (stat.last_workday ?? "")
                  ? prev.last_workday
                  : stat.last_workday,
            }
          : stat,
      );
    }
  }
  return { rules, skills };
}

/** 스킬 항목의 발동 — 폴더명 우선, 없으면 frontmatter 이름으로 한 번 더. */
export function skillFiring(index: FiringIndex, entry: SkillEntry): FiringStat | undefined {
  return index.skills.get(entry.dir_name) ?? index.skills.get(normalizeSkillKey(entry.name));
}

/** `YYYYMMDD` → `M/D` (배지 툴팁용 짧은 표기). */
export function shortWorkday(workday: string): string {
  if (!/^\d{8}$/.test(workday)) return workday;
  return `${Number(workday.slice(4, 6))}/${Number(workday.slice(6, 8))}`;
}
