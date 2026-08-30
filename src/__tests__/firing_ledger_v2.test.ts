// AD-2 — 발동 배지의 매칭 규약. 여기서 틀리면 배지가 조용히 "안 걸림" 을
// 주장하므로(=거짓 휴면), 키 변환은 순수 함수로 잠가 둔다.
import { describe, expect, it } from "vitest";

import {
  buildFiringIndex,
  normalizeSkillKey,
  ruleAbsPath,
  shortWorkday,
  skillFiring,
} from "@/features/skills/firingModel";
import type { FiringStat, RuleEntry, RulesOverview, SkillEntry } from "@/lib/bindings";

const stat = (over: Partial<FiringStat> & Pick<FiringStat, "kind" | "key">): FiringStat => ({
  label: over.key,
  count: 1,
  bytes: 0,
  sessions: 1,
  last_workday: "20260829",
  ...over,
});

const overview: RulesOverview = {
  claude_md: [],
  project_rules: [],
  global_rules: [],
  project_rules_dir: "/w/proj/.claude/rules",
  global_rules_dir: "/home/u/.claude/rules",
  cursor_translate: false,
};

const ruleEntry = (scope: "project" | "global", relPath: string): RuleEntry => ({
  scope,
  kind: "rule",
  rel_path: relPath,
  name: relPath,
  title: "",
  exists: true,
  paths: [],
  bytes: 0,
  mirror: "none",
});

const skillEntry = (dirName: string, name = dirName): SkillEntry => ({
  scope: "project",
  dir_name: dirName,
  name,
  description: "",
  enabled: true,
  extra_files: 0,
  display_path: `.claude/skills/${dirName}`,
});

describe("ruleAbsPath", () => {
  it("프로젝트와 전역의 같은 상대경로를 서로 다른 절대경로로 가른다", () => {
    const rel = ".claude/rules/api.md";
    expect(ruleAbsPath(ruleEntry("project", rel), overview)).toBe("/w/proj/.claude/rules/api.md");
    expect(ruleAbsPath(ruleEntry("global", rel), overview)).toBe("/home/u/.claude/rules/api.md");
  });

  it("CLAUDE.md 고정 슬롯도 스코프 루트 기준으로 푼다", () => {
    expect(ruleAbsPath(ruleEntry("project", "CLAUDE.md"), overview)).toBe("/w/proj/CLAUDE.md");
  });
});

describe("스킬 키 정규화", () => {
  it("플러그인 접두를 떼어 폴더명과 잇는다", () => {
    expect(normalizeSkillKey("oculpm:oculpm-journal")).toBe("oculpm-journal");
    expect(normalizeSkillKey("artifact-design")).toBe("artifact-design");
  });

  it("플러그인 이름으로 발동한 기록을 폴더명으로 찾는다", () => {
    const index = buildFiringIndex([stat({ kind: "skill", key: "oculpm:oculpm-journal", count: 4 })]);
    expect(skillFiring(index, skillEntry("oculpm-journal"))?.count).toBe(4);
  });

  it("같은 스킬이 두 이름으로 발동하면 횟수를 합친다", () => {
    const index = buildFiringIndex([
      stat({ kind: "skill", key: "oculpm:journal", count: 2, last_workday: "20260820" }),
      stat({ kind: "skill", key: "journal", count: 3, last_workday: "20260829" }),
    ]);
    const found = skillFiring(index, skillEntry("journal"));
    expect(found?.count).toBe(5);
    expect(found?.last_workday).toBe("20260829");
  });

  it("발동 기록이 없는 스킬은 undefined — 배지가 휴면으로 그린다", () => {
    const index = buildFiringIndex([]);
    expect(skillFiring(index, skillEntry("never-used"))).toBeUndefined();
  });
});

describe("규칙 색인", () => {
  it("절대경로 키로 그대로 찾힌다", () => {
    const index = buildFiringIndex([
      stat({ kind: "rule", key: "/home/u/.claude/rules/arkts/coding-style.md", count: 56, bytes: 90000 }),
    ]);
    const entry = ruleEntry("global", ".claude/rules/arkts/coding-style.md");
    expect(index.rules.get(ruleAbsPath(entry, overview))?.count).toBe(56);
  });
});

describe("shortWorkday", () => {
  it("YYYYMMDD 를 M/D 로 줄인다", () => {
    expect(shortWorkday("20260829")).toBe("8/29");
    expect(shortWorkday("20260101")).toBe("1/1");
  });

  it("형식이 아니면 원문 그대로", () => {
    expect(shortWorkday("nope")).toBe("nope");
  });
});
