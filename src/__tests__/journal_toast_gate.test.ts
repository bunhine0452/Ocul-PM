import { describe, expect, it } from "vitest";

import {
  BURST_THRESHOLD,
  BURST_WINDOW_MS,
  FRESH_ENTRY_WINDOW_MS,
  decideEntryToast,
} from "@/lib/journalToastGate";

// ─── 「새 일지」 토스트 문지기 (2026-09-22) ──────────────────────────────────
//
// 실측: git 체크아웃이 일지 폴더를 지웠다 되살리자 워처가 옛 일지 18건을
// 「새 일지」로 방출했고, 15초짜리 토스트 18장이 벽처럼 쌓였다. 문지기는
// (1) 오래된 일지를 새 소식으로 띄우지 않고 (2) 정당한 폭주는 한 장으로 접는다.

const NOW = Date.UTC(2026, 8, 22, 10, 0, 0);
const iso = (t: number) => new Date(t).toISOString();

describe("decideEntryToast", () => {
  it("방금 쓴 일지는 띄운다", () => {
    expect(decideEntryToast(iso(NOW - 60_000), NOW, [])).toBe("show");
  });

  it("오래된 일지가 새 행으로 돌아와도 띄우지 않는다 — 재출현이지 새 소식이 아니다", () => {
    expect(decideEntryToast(iso(NOW - FRESH_ENTRY_WINDOW_MS - 1), NOW, [])).toBe("skip");
    expect(decideEntryToast(iso(NOW - 3 * 24 * 3600_000), NOW, [])).toBe("skip");
    // 경계는 포함 — 정확히 창 끝은 아직 새것이다.
    expect(decideEntryToast(iso(NOW - FRESH_ENTRY_WINDOW_MS), NOW, [])).toBe("show");
  });

  it("못 읽는 created_at 은 새것으로 본다 — 침묵 쪽으로 넘어지지 않는다", () => {
    expect(decideEntryToast("", NOW, [])).toBe("show");
    expect(decideEntryToast("어제", NOW, [])).toBe("show");
  });

  it("짧은 창 안에 문턱만큼 띄웠으면 다음 것부터 접고, 창이 지나면 다시 띄운다", () => {
    const recent: number[] = [];
    for (let i = 0; i < BURST_THRESHOLD; i++) {
      expect(decideEntryToast(iso(NOW), NOW + i * 100, recent)).toBe("show");
      recent.push(NOW + i * 100);
    }
    expect(decideEntryToast(iso(NOW), NOW + 400, recent)).toBe("fold");
    expect(decideEntryToast(iso(NOW), NOW + 500, recent)).toBe("fold");
    // 창이 지나면 목록이 제자리에서 비워지고 다시 개별 토스트다.
    const later = NOW + BURST_WINDOW_MS + 1_000;
    expect(decideEntryToast(iso(later), later, recent)).toBe("show");
    expect(recent).toEqual([]);
  });

  it("오래된 일지는 폭주 계산에 끼지 않는다 — 건너뛴 것은 표시가 아니다", () => {
    const recent: number[] = [];
    for (let i = 0; i < 10; i++) {
      expect(decideEntryToast(iso(NOW - 24 * 3600_000), NOW + i, recent)).toBe("skip");
    }
    expect(decideEntryToast(iso(NOW), NOW + 20, recent)).toBe("show");
  });
});
