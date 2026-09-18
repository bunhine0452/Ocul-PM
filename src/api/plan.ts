/**
 * `planApi` — 플래너 읽기 커맨드의 래퍼 (`{#api-facades}` 의 첫 조각).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다. 새 파일은
 * `bindings.ts` 를 직접 부르지 않는다 — `lint:bindings` 가 그 규율을 지킨다.
 * 쓰기(`plan_apply_edit` 등)는 화면이 아직 `commands` 를 직접 쓰므로 여기 없다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands, type PlanDetail, type PlanSummary } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const planApi = {
  list: (projectId: number) => unwrap<PlanSummary[]>("plan_list", commands.planList(projectId)),

  /** 없는 계획이면 `null`. */
  get: (projectId: number, planId: string) =>
    unwrap<PlanDetail | null>("plan_get", commands.planGet(projectId, planId)),
};
