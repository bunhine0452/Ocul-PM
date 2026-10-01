/**
 * `planApi` — 플래너 커맨드의 래퍼 (`{#api-facades}`).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다. 새 파일은
 * `bindings.ts` 를 직접 부르지 않는다 — `lint:bindings` 가 그 규율을 지킨다.
 * 읽기(`list`·`get`)는 트레이 스냅숏이 첫 호출자였고(2026-09-18), 쓰기 둘
 * (`applyEdit`·`create`)은 터미널 블록 메뉴와 AI 패널의 제안 카드가 열었다
 * (2026-10-01). 플래너 화면 자신(`usePlanDocument`)은 아직 직접 부른다.
 */

import { call } from "@/api/invoke";
import { commands, type PlanEditOp, type PlanSummary } from "@/lib/bindings";

export const planApi = {
  list: (projectId: number): Promise<PlanSummary[]> => call("plan_list", commands.planList(projectId)),

  /** 없는 계획이면 `null`. */
  get: (projectId: number, planId: string) => call("plan_get", commands.planGet(projectId, planId)),

  /** 새 계획 파일 — 제목만 받고 id·경로는 백엔드가 짓는다. */
  create: (projectId: number, title: string): Promise<PlanSummary> =>
    call("plan_create", commands.planCreate(projectId, title)),

  /**
   * `.md` SSOT 에 편집 하나 — 본문을 고치고 plan-log 에 `agentId` 로 한 줄 남긴다
   * (`null` 이면 `user`). 고친 뒤의 계획을 돌려준다.
   */
  applyEdit: (projectId: number, planId: string, op: PlanEditOp, agentId: string | null) =>
    call("plan_apply_edit", commands.planApplyEdit(projectId, planId, op, agentId)),
};
