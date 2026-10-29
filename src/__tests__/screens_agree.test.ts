// 화면끼리 같은 말을 한다 (4.0 윗줄 개편 라운드) — E2E 화면에서 잡은 두 어긋남.
//  1. 오늘의 증거 비율이 잡일까지 분모에 넣어 「확인할 것 없음」 옆에 「증거 0건 · 0%」 를 띄웠다.
//  2. 변경 화면이 `.oculpm/`(기록 자신)을 「기록 없음」 으로 잡아, 오늘의 「기록 없는 변경 없음」 과 엇갈렸다.
import { describe, expect, it } from "vitest";
import type { JournalEntrySummary } from "@/lib/bindings";
import { dayStats } from "@/features/today/todayModel";
import { isRecordPath, mergeChanges, toBaselineChanges } from "@/features/diff/changeList";

const entry = (type: JournalEntrySummary["type"], evidence: number): JournalEntrySummary => ({
  relative_path: `journal/20261029/x/${type}-${evidence}.md`,
  workday: "20261029",
  type,
  slug: "s",
  status: "done",
  difficulty: null,
  title: "t",
  checkbox: true,
  session_id: "s",
  agent_id: "claude-code",
  agent_version: null,
  verified_by_user: false,
  verified_stale: false,
  evidence,
  created_at: "2026-10-29T10:00:00+09:00",
  updated_at: null,
  tags: [],
  files_count: 1,
  parse_ok: true,
  parse_warnings: [],
});

describe("오늘 — 증거 비율의 분모는 「확인할 것」 과 같다 (결함·기능·리팩토링)", () => {
  it("잡일만 쓴 날은 증거 비율을 말하지 않는다", () => {
    expect(dayStats([entry("chore", 1)])).toEqual({ total: 1, judged: 0, withEvidence: 0, pct: null });
  });

  it("잡일·에러는 분모에서 빠진다", () => {
    const s = dayStats([entry("feature", 2), entry("bug", 0), entry("chore", 0), entry("error", 0)]);
    expect(s).toEqual({ total: 4, judged: 2, withEvidence: 1, pct: 50 });
  });
});

describe("변경 — `.oculpm/` 은 기록 자신이라 변경 목록에 서지 않는다", () => {
  it("일지·계획·규격 파일은 빠지고 코드 파일만 남는다", () => {
    const rows = [
      { path: "src/a.ts", op: "M" },
      { path: ".oculpm/journal/20261029/Bugs/0413_bug_x.md", op: "A" },
      { path: ".oculpm/config.toml", op: "A" },
      { path: "AGENTS.md", op: "A" },
    ];
    expect(toBaselineChanges(rows).map((c) => c.path)).toEqual(["src/a.ts", "AGENTS.md"]);
    const live = [{ path: ".oculpm/planner/p.md", op: "M" as const, ts: 5, read: false }];
    expect(mergeChanges(toBaselineChanges(rows), live).map((c) => c.path)).toEqual(["AGENTS.md", "src/a.ts"]);
  });

  it("이름이 비슷한 바깥 폴더는 기록이 아니다", () => {
    expect(isRecordPath(".oculpm")).toBe(true);
    expect(isRecordPath(".oculpm-backup/x.md")).toBe(false);
    expect(isRecordPath("docs/.oculpm/x.md")).toBe(false);
  });
});
