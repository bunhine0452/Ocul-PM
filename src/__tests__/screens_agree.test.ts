// 화면끼리 같은 말을 한다 (4.0 윗줄 개편 라운드) — E2E 화면에서 잡은 어긋남.
// 변경 화면이 `.oculpm/`(기록 자신)을 「기록 없음」 으로 잡아, 오늘의 「기록 없는 변경 없음」 과 엇갈렸다.
// (오늘의 증거 비율이 「확인할 것」 과 다른 분모로 세던 것은 요약 줄의 증거 수를 걷어 끝냈다.)
import { describe, expect, it } from "vitest";
import { isRecordPath, mergeChanges, toBaselineChanges } from "@/features/diff/changeList";

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
