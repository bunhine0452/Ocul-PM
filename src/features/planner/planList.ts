/**
 * 계획 목록의 두 칸 — 진행 중 / 끝난 계획 (4.0 `{#ui-planner}`).
 *
 * 3.x 의 레일은 검색·정렬 넷·묶기 넷·월별 쪼개기·멈춤 배지를 가졌다. 4.0 의 레일은
 * 「무엇이 진행 중이고 판정이 섰는가」만 답한다 — 끝난 계획은 한 줄로 접힌다.
 *
 * 진행 중 칸은 **예외가 먼저**다(11-23, 「예외만 보여 준다」 가 오늘 화면에서 멈추지 않게): 확인 명령 실패 →
 * 통과 뒤 바뀜 · 여기선 아직 → 닫을 계획(오늘의 「닫을 계획 N」 과 같은 `closable`) → 나머지. 각 무리 안에서는
 * `updated_at` 최신 먼저다(`updated_at` 은 frontmatter `updated:` 라 항목 편집으로는 바뀌지 않는다 — 사실상 만든
 * 날이다). 최근순만 따르던 때는 판정 ✗ 인 계획도 오래됐으면 통과한 계획들 사이에 묻혔고, 오늘의 「닫을 계획 4」 를
 * 누르면 첫 계획 하나만 열려 나머지 셋은 목록에서 찾을 길이 없었다. 무리가 둘 이상이면 레일이 무리마다 이름과 수를
 * 단다(`railGroups`).
 *
 * `PlanSort`·`PlanGroup` 은 옛 레일의 영속 상태 타입이라 `workspaceState` 가 아직
 * 들고 있다 — 셸 쪽이 그 필드를 걷으면 같이 지운다.
 */

import type { PlanSummary } from "@/lib/bindings";
import { verdictStateOf } from "./verdictState";

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

/** 진행 중 계획의 무리 — 먼저 볼 것(실패 · 통과 뒤 바뀜 · 여기선 아직) · 닫을 계획 · 나머지. */
export type RailGroupKey = "attention" | "closable" | "rest";

/** 무리 안의 앞뒤까지 — 실패(0)가 통과 뒤 바뀜 · 여기선 아직(1)보다 앞이다. */
function rankOf(p: PlanSummary): number {
  const state = verdictStateOf(p);
  if (state === "fail") return 0;
  if (state === "stale" || state === "away") return 1;
  if (p.closable) return 2;
  return 3;
}

function groupOf(p: PlanSummary): RailGroupKey {
  const r = rankOf(p);
  return r <= 1 ? "attention" : r === 2 ? "closable" : "rest";
}

/** 레일의 두 칸 — 입력은 바꾸지 않는다. */
export function railOrder(plans: readonly PlanSummary[]): { active: PlanSummary[]; closed: PlanSummary[] } {
  return {
    active: plans.filter((p) => bucketOf(p) === "active").sort((a, b) => rankOf(a) - rankOf(b) || newestFirst(a, b)),
    closed: plans.filter((p) => bucketOf(p) !== "active").sort(newestFirst),
  };
}

/**
 * 진행 중 칸을 무리로 — `railOrder` 의 `active` 를 받아 차례 그대로 가른다. 빈 무리는 빼고, 나머지뿐이면 한 무리다
 * (그때 레일은 무리 이름을 달지 않는다 — 예외가 없는데 「그 밖의 계획」 이라고 부를 것이 없다).
 */
export function railGroups(active: readonly PlanSummary[]): Array<{ key: RailGroupKey; plans: PlanSummary[] }> {
  const groups: Array<{ key: RailGroupKey; plans: PlanSummary[] }> = [];
  for (const p of active) {
    const key = groupOf(p);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.plans.push(p);
    else groups.push({ key, plans: [p] });
  }
  return groups;
}
