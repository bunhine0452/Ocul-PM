// 플래너 집계 규약 — 화면의 숫자 셋(done/total · 진척 % · 상태 칩)이 같은
// 모수를 세는가. 2026-09-10 화면은 「32/35 완료 · 100% · 완료 34」 였다:
// 진척은 막힘을 분모에서 빼서 100 이 됐고, 칩은 부모 항목까지 세서 34 가 됐다.
import { describe, expect, it } from "vitest";
import type { PlanItemDto } from "@/lib/bindings";
import {
  countByStatus,
  isRemaining,
  leafItems,
  nextUp,
  phaseProgress,
  progressSegments,
} from "@/features/planner/planMeta";

function item(id: string, status: string, over: Partial<PlanItemDto> = {}): PlanItemDto {
  return {
    item_id: id,
    phase: "A",
    title: id,
    status,
    order_idx: 0,
    parent_item: null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
    ...over,
  };
}

// 부모 p 의 하위 c1·c2 가 다 끝났다 → p 는 롤업 done. 리프는 6.
const ITEMS: PlanItemDto[] = [
  item("a1", "done"),
  item("a2", "blocked"),
  item("p", "done"),
  item("c1", "done", { parent_item: "p" }),
  item("c2", "done", { parent_item: "p" }),
  item("b1", "in_progress"),
  item("b2", "todo"),
  item("b3", "deferred"),
];

describe("planMeta 집계", () => {
  it("리프만 센다 — 부모는 파생값", () => {
    expect(leafItems(ITEMS).map((i) => i.item_id)).toEqual(["a1", "a2", "c1", "c2", "b1", "b2", "b3"]);
    expect(countByStatus(leafItems(ITEMS)).done).toBe(3); // p 를 세면 4
  });

  it("막힘은 분모에 남고 진척은 주지 않는다 — 이월·폐기는 뺀다", () => {
    // done 3 + wip 0.5 + blocked 0 + todo 0 = 3.5 / 6 (deferred 제외)
    expect(phaseProgress(leafItems(ITEMS))).toBe(Math.round((3.5 / 6) * 100));
    expect(phaseProgress([item("x", "done"), item("y", "blocked")])).toBe(50);
  });

  it("쌓인 바의 조각은 진척 분모와 같은 네 상태만, 문서 순서가 아닌 고정 순서", () => {
    const segs = progressSegments(ITEMS);
    expect(segs.map((s) => s.status)).toEqual(["done", "in_progress", "blocked", "todo"]);
    expect(segs.map((s) => s.n)).toEqual([3, 1, 1, 1]);
    expect(segs.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100);
    expect(progressSegments([item("z", "deferred")])).toEqual([]);
  });

  it("다음 할 일 — 막힘 → 진행중 → 할 일, 리프만, 상한", () => {
    expect(nextUp(ITEMS).map((i) => i.item_id)).toEqual(["a2", "b1", "b2"]);
    expect(nextUp(ITEMS, 1).map((i) => i.item_id)).toEqual(["a2"]);
    expect(["todo", "in_progress", "blocked"].every(isRemaining)).toBe(true);
    expect(["done", "deferred", "dropped"].some(isRemaining)).toBe(false);
  });
});
