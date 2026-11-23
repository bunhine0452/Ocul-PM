// 사람 몫은 에이전트의 「다음」 이 아니다 — 계획 화면의 「다음」(planMeta `nextLeaf`)이 오늘 화면(digest.rs)과
// 시작 훅(plan-context.sh)과 같은 사례표 `src-tauri/src/oculpm/planner/owner_cases.json` 으로 판정한다.
// `[사용자] 설치본에서 눈 확인` 아래의 하위 리프를 「터미널에서 실행」 으로 Claude 에게 맡기라고 권하던 결함(11-23).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanItemDto } from "@/lib/bindings";
import { isUserLeaf, leafItems, nextLeaf } from "@/features/planner/planMeta";

interface Case {
  name: string;
  items: Array<{ id: string; title: string; status: string; parent?: string }>;
  next: string | null;
  needs_user: string[];
}
const table = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "src-tauri", "src", "oculpm", "planner", "owner_cases.json"), "utf8"),
) as { cases: Case[] };

function dto(c: Case): PlanItemDto[] {
  return c.items.map((i, n) => ({
    item_id: i.id,
    phase: null,
    title: i.title,
    status: i.status,
    order_idx: n,
    parent_item: i.parent ?? null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
  }));
}

describe("human-owned case table (owner_cases.json)", () => {
  it("has cases", () => {
    expect(table.cases.length).toBeGreaterThan(3);
  });
  for (const c of table.cases) {
    it(c.name, () => {
      const items = dto(c);
      expect(nextLeaf(items)?.item_id ?? null).toBe(c.next);
      const human = leafItems(items)
        .filter((i) => (i.status === "todo" || i.status === "in_progress") && isUserLeaf(i, items))
        .map((i) => i.item_id);
      expect(human).toEqual(c.needs_user);
    });
  }
});
