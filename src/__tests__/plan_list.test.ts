import { describe, expect, it } from "vitest";
import { bucketOf, railOrder } from "@/features/planner/planList";
import type { PlanSummary } from "@/lib/bindings";

function plan(over: Partial<PlanSummary> & { plan_id: string }): PlanSummary {
  return {
    plan_id: over.plan_id,
    title: over.title ?? over.plan_id,
    status: over.status ?? "active",
    owner_agent: over.owner_agent ?? "claude-code",
    progress: over.progress ?? 0,
    file_path: over.file_path ?? `.oculpm/planner/${over.plan_id}.md`,
    updated_at: over.updated_at ?? "2026-10-01",
    item_count: over.item_count ?? 10,
    done_count: over.done_count ?? 0,
  };
}

describe("bucketOf", () => {
  it("접는다: active / done / 그 외는 전부 보관", () => {
    expect(bucketOf(plan({ plan_id: "a", status: "active" }))).toBe("active");
    expect(bucketOf(plan({ plan_id: "b", status: "done" }))).toBe("done");
    expect(bucketOf(plan({ plan_id: "c", status: "archived" }))).toBe("archived");
    expect(bucketOf(plan({ plan_id: "d", status: "무엇이든" }))).toBe("archived");
  });
});

describe("railOrder — 진행 중 / 끝난 계획, 오늘 화면과 같은 순서", () => {
  it("활성만 위 칸에, 둘 다 updated_at 최신 먼저, 입력은 그대로", () => {
    const input = [
      plan({ plan_id: "old", updated_at: "2026-09-01" }),
      plan({ plan_id: "done", status: "done", updated_at: "2026-10-20" }),
      plan({ plan_id: "new", updated_at: "2026-10-28" }),
      plan({ plan_id: "arch", status: "archived", updated_at: "2026-10-27" }),
    ];
    const before = input.map((p) => p.plan_id);
    const { active, closed } = railOrder(input);
    expect(active.map((p) => p.plan_id)).toEqual(["new", "old"]);
    expect(closed.map((p) => p.plan_id)).toEqual(["arch", "done"]);
    expect(input.map((p) => p.plan_id)).toEqual(before);
  });
});
