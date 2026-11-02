import { describe, expect, it } from "vitest";
import { filesTouched, scalar, splitFrontmatter } from "./frontmatter";
import { parseJournal } from "./journal";
import { overview, unrecordedOf } from "./overview";
import { journalKey, parsePlan } from "./plan";
import { receiptMarkdown, type ReceiptText } from "./receipt";
import { ago } from "./time";

const JOURNAL = `---
schema_version: 1
type: bug
created_at: "2026-11-02T20:23:00+09:00"
files_touched:
  - path: "src/a.ts"
    op: update
  - path: "src/내 파일.ts"
    op: create
related: []
tags:
  - "편집기"
---
[x] 편집기: 고쳤다

## 발생 원인
없었다.

## 검증
- \`pnpm test\` 1005 passed
`;

const PLAN = `---
oculpm_plan: v1
id: p1
title: "계획 하나"
status: active
---
**확인 명령:** pnpm test

- [x] 항목 {#a}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-02T10:00:00+09:00 | #a | claude-code | ☐→x | .oculpm/journal/20261102/Bugs/x.md | 판정 ✗ 2 failed |
| 2026-11-02T11:00:00+09:00 | #a | claude-code | ☐→x | 20261102/Bugs/y.md | 판정 ✓ a \\| b passed |
| 2026-11-02T12:00:00+09:00 | #a | claude-code | x→x |  | 메모만 |
<!-- oculpm:plan-log end -->
`;

describe("frontmatter", () => {
  it("reads both item shapes and stops at the next key", () => {
    const fm = "type: bug\nfiles_touched:\n  - path: \"a.ts\"\n    op: update\n  - b.ts\n  - \"c d.ts\"\nrelated: []\n  - not.ts\n";
    expect(filesTouched(fm)).toEqual(["a.ts", "b.ts", "c d.ts"]);
    expect(scalar(fm, "type")).toBe("bug");
  });
  it("handles CRLF and a missing frontmatter", () => {
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nbody").body).toBe("body");
    expect(splitFrontmatter("no fm").fm).toBeNull();
  });
});

describe("journal", () => {
  it("parses title, files, evidence and proof", () => {
    const j = parseJournal("20261102/Bugs/2023_bug_x.md", JOURNAL);
    expect(j).toMatchObject({ title: "편집기: 고쳤다", type: "bug", evidence: 2, proof: "pnpm test 1005 passed" });
    expect(j.files).toEqual(["src/a.ts", "src/내 파일.ts"]);
  });
});

describe("plan", () => {
  it("reads the log, escaped pipes and the newest verdict", () => {
    const p = parsePlan("p1.md", PLAN);
    expect(p).toMatchObject({ id: "p1", title: "계획 하나", status: "active", check: "pnpm test" });
    expect(p.updates).toHaveLength(3);
    expect(p.verdict).toEqual({ passed: true, summary: "a | b passed", ts: "2026-11-02T11:00:00+09:00" });
  });
  it("normalizes journal refs like the app", () => {
    expect(journalKey(".oculpm/journal/20261102/Bugs/x.md")).toBe("20261102/Bugs/x.md");
    expect(journalKey("journal/20261102/Bugs/x.md")).toBe("20261102/Bugs/x.md");
  });
});

describe("overview", () => {
  const j = parseJournal("20261102/Bugs/2023_bug_x.md", JOURNAL);
  it("unrecorded skips .oculpm and recorded files", () => {
    expect(unrecordedOf(["src/a.ts", "src/b.ts", ".oculpm/journal/x.md"], [j])).toEqual(["src/b.ts"]);
  });
  it("puts failing plans first and drops closed plans", () => {
    const failing = parsePlan("f.md", PLAN.replace("판정 ✓ a \\| b passed", "판정 ✗ boom"));
    const closed = parsePlan("c.md", PLAN.replace("status: active", "status: done"));
    const o = overview([failing, closed], [j], [], "20261102");
    expect(o.failing.map((v) => v.plan.file)).toEqual(["f.md"]);
    expect(o.latest?.summary).toBe("boom");
    expect(o.unproven).toEqual([]);
  });
});

describe("receipt", () => {
  const t: ReceiptText = {
    title: "R",
    meta: (c, f) => `${c}c ${f}f`,
    plans: "P",
    plan: (x) => `“${x}”`,
    noRun: "never",
    noSummary: "none",
    journals: (n, m) => `J ${n}/${m}`,
    noJournals: "nojournal",
    noProof: "noproof",
    unrecorded: (n) => `U ${n}`,
    more: (n) => `+${n}`,
    footer: "F",
    when: () => "11:00",
  };
  it("links plans through the log and lists unrecorded files", () => {
    const j = parseJournal("20261102/Bugs/y.md", JOURNAL);
    const md = receiptMarkdown(
      { branch: "feat/x", baseLabel: "origin/main", commits: 2, files: 3, journals: [j], unrecorded: ["src/b.ts"], plans: [parsePlan("p1.md", PLAN)] },
      t,
    );
    expect(md).toBe(
      [
        "### R · `feat/x` ← `origin/main`",
        "2c 3f",
        "",
        "**P**",
        "- ✓ “계획 하나” — `pnpm test` → a | b passed → 11:00",
        "",
        "**J 1/1**",
        "- ✓ 편집기: 고쳤다 — pnpm test 1005 passed",
        "",
        "**U 1**",
        "- `src/b.ts`",
        "",
        "<sub>F</sub>",
      ].join("\n"),
    );
  });
});

describe("ago", () => {
  it("picks the unit", () => {
    const now = Date.parse("2026-11-02T12:00:00+09:00");
    expect(ago("2026-11-02T11:59:30+09:00", now)).toEqual({ unit: "now", n: 0 });
    expect(ago("2026-11-02T11:48:00+09:00", now)).toEqual({ unit: "min", n: 12 });
    expect(ago("2026-11-02T09:00:00+09:00", now)).toEqual({ unit: "hour", n: 3 });
    expect(ago("2026-10-30T12:00:00+09:00", now)).toEqual({ unit: "day", n: 3 });
    expect(ago("nope", now)).toBeNull();
  });
});
