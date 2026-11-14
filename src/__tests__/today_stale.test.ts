// 「판정 뒤 바뀜」 (11-02) — ✓ 뒤에 계획이 다룬 파일이 다시 저장되면 먼저 볼 것에 선다.
import { describe, expect, it } from "vitest";

import type { DigestPlan, PlanVerdict, TodayDigest } from "@/lib/bindings";
import { buildExceptions, osLabel, splitExceptions } from "@/features/today/todayModel";

const verdict = (passed: boolean): PlanVerdict => ({
  passed,
  summary: passed ? "991 passed" : "2 failed",
  ts: "2026-11-02T10:00:00+09:00",
  agent_id: "claude-code",
  item_id: "x",
});

function plan(id: string, over: Partial<DigestPlan>): DigestPlan {
  return {
    plan_id: id,
    title: id,
    progress: 0.5,
    done_count: 1,
    item_count: 2,
    closable: false,
    updated_at: "2026-11-02",
    done_when: null,
    check: "pnpm test",
    last_verdict: null,
    stale_files: [],
    next: null,
    ...over,
  };
}

const kinds = (plans: DigestPlan[]) => {
  const digest: TodayDigest = { plans, needs_user: [], blocked: [], journal_plan: [] };
  return buildExceptions({ entries: [], digest, unrecorded: [], silent: [], plugin: null });
};

describe("판정 뒤 바뀜", () => {
  it("✓ 뒤에 바뀐 파일이 있으면 먼저 볼 것 — 실패 바로 아래", () => {
    const list = kinds([
      plan("a", { last_verdict: verdict(true), stale_files: ["src/a.ts", "src/b.ts"] }),
      plan("b", { last_verdict: verdict(false) }),
    ]);
    expect(list.map((e) => e.kind)).toEqual(["verdict", "stale"]);
    const stale = list[1];
    expect(stale.kind === "stale" && stale.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(splitExceptions(list).first).toHaveLength(2);
  });

  it("바뀐 파일이 없거나 판정이 없으면 서지 않는다 — 실패는 실패로만", () => {
    expect(kinds([plan("a", { last_verdict: verdict(true) })])).toEqual([]);
    expect(kinds([plan("a", { stale_files: ["src/a.ts"] })])).toEqual([]);
    expect(kinds([plan("a", { last_verdict: verdict(false), stale_files: ["src/a.ts"] })]).map((e) => e.kind)).toEqual([
      "verdict",
    ]);
  });
});

// 두 기기 (11-13) — ✓ 가 다른 OS 에서 돌았으면 「통과 뒤 바뀜」이 아니라 「여기선 아직」 하나.
describe("여기선 아직", () => {
  it("다른 OS 의 ✓ 는 통과 뒤 바뀜 자리 바로 아래에 선다", () => {
    const away = { ...verdict(true), summary: "991 passed · mac" };
    const list = kinds([
      plan("a", { last_verdict: away, verdict_from: "mac" }),
      plan("b", { last_verdict: verdict(true), stale_files: ["src/a.ts"] }),
    ]);
    expect(list.map((e) => e.kind)).toEqual(["stale", "elsewhere"]);
    const row = list[1];
    expect(row.kind === "elsewhere" && [row.os, row.plan.plan_id]).toEqual(["mac", "a"]);
    expect(splitExceptions(list).first).toHaveLength(2);
    expect(osLabel("mac")).toBe("macOS");
    expect(osLabel("freebsd")).toBe("freebsd");
  });

  it("표시가 없거나(옛 줄) 이 기기의 ✓ 면 서지 않고, 실패는 어디서 돌았든 실패다", () => {
    expect(kinds([plan("a", { last_verdict: verdict(true), verdict_from: null })])).toEqual([]);
    expect(kinds([plan("a", { last_verdict: verdict(true) })])).toEqual([]);
    expect(kinds([plan("a", { last_verdict: verdict(false), verdict_from: "mac" })]).map((e) => e.kind)).toEqual(["verdict"]);
  });
});

