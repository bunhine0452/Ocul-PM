/**
 * 계획 목록의 두 칸 — 진행 중 / 끝난 계획 (4.0 `{#ui-planner}`).
 *
 * 3.x 의 레일은 검색·정렬 넷·묶기 넷·월별 쪼개기·멈춤 배지를 가졌다. 4.0 의 레일은
 * 「무엇이 진행 중이고 판정이 섰는가」만 답한다 — 끝난 계획은 한 줄로 접힌다.
 *
 * 순서는 오늘 화면의 계획 카드(`today_digest`)와 같다: `updated_at` 최신 먼저.
 * (`updated_at` 은 frontmatter `updated:` 라 항목 편집으로는 바뀌지 않는다 — 사실상
 * 만든 날이다. 두 화면이 **같은 순서**를 말하는 것이 이 정렬의 일이다.)
 *
 * `PlanSort`·`PlanGroup` 은 옛 레일의 영속 상태 타입이라 `workspaceState` 가 아직
 * 들고 있다 — 셸 쪽이 그 필드를 걷으면 같이 지운다.
 */

import type { PlanSummary } from "@/lib/bindings";

export type PlanBucket = "active" | "done" | "archived";
export type PlanSort = "recent" | "progress" | "remaining" | "title";
export type PlanGroup = "status" | "recency" | "agent" | "none";

/** active / done / 그 외 전부 archived. */
export function bucketOf(p: PlanSummary): PlanBucket {
  if (p.status === "active") return "active";
  if (p.status === "done") return "done";
  return "archived";
}

const newestFirst = (a: PlanSummary, b: PlanSummary) => b.updated_at.localeCompare(a.updated_at);

/** 레일의 두 칸 — 입력은 바꾸지 않는다. */
export function railOrder(plans: readonly PlanSummary[]): { active: PlanSummary[]; closed: PlanSummary[] } {
  return {
    active: plans.filter((p) => bucketOf(p) === "active").sort(newestFirst),
    closed: plans.filter((p) => bucketOf(p) !== "active").sort(newestFirst),
  };
}
