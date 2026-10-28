// 계획 집계 규약 — done/total 이 리프만 세는가, 「다음」이 오늘 화면(digest.rs)과 같은
// 항목을 가리키는가. 2026-09-10 화면은 「32/35 완료 · 완료 34」 였다 — 칩이 부모까지 셌다.
import { describe, expect, it } from "vitest";
import type { PlanItemDto } from "@/lib/bindings";
import {
  countByStatus,
  doneOfTotal,
  hasOpenLeaves,
  isUserItem,
  leafItems,
  nextLeaf,
  phasesOf,
  stripUserTag,
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

  it("완료/전체 — 리프만, 이월·폐기는 분모에서 뺀다", () => {
    expect(doneOfTotal(ITEMS)).toEqual({ done: 3, total: 6 });
  });

  it("다음 리프 — 문서 순서 첫 할 일, 사람 몫은 건너뛰고, 진행중은 다른 세션 몫", () => {
    const items = [
      item("a", "done", { order_idx: 0 }),
      item("b", "in_progress", { order_idx: 1 }),
      item("c", "todo", { order_idx: 2, title: "[사용자 결정] 태그" }),
      item("d", "todo", { order_idx: 4 }),
      item("e", "todo", { order_idx: 3, title: "[User] approve" }),
    ];
    expect(nextLeaf(items)?.item_id).toBe("d");
    expect(nextLeaf([item("x", "done")])).toBeNull();
    expect(hasOpenLeaves([item("x", "done"), item("y", "dropped")])).toBe(false);
    expect(hasOpenLeaves(ITEMS)).toBe(true);
  });

  it("사람 몫 머리표 — 대괄호 머리만 본다", () => {
    expect(isUserItem("[사용자] 테스터 모집")).toBe(true);
    expect(isUserItem("[user action] ok")).toBe(true);
    expect(isUserItem("사용자 설정 화면 고치기")).toBe(false);
    expect(stripUserTag("[사용자 액션] release env")).toBe("release env");
  });

  it("단계별 묶음은 문서 순서, 깊이는 부모 사슬", () => {
    const groups = phasesOf([
      item("p", "done", { order_idx: 0 }),
      item("c", "done", { order_idx: 1, parent_item: "p" }),
      item("z", "todo", { order_idx: 2, phase: "B" }),
    ]);
    expect(groups.map((g) => g.phase)).toEqual(["A", "B"]);
    expect(groups[0].items.map((r) => [r.item.item_id, r.depth, r.parent])).toEqual([
      ["p", 0, true],
      ["c", 1, false],
    ]);
  });
});
