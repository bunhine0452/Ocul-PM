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
import {
  commands,
  type DispatchPrompt,
  type JournalPlanLink,
  type LockedOpenItem,
  type PlanEditOp,
  type PlanSummary,
  type TodayDigest,
} from "@/lib/bindings";

export const planApi = {
  list: (projectId: number): Promise<PlanSummary[]> => call("plan_list", commands.planList(projectId)),

  /** 없는 계획이면 `null`. */
  get: (projectId: number, planId: string) => call("plan_get", commands.planGet(projectId, planId)),
  /** 플랜 하나의 변경 로그 전체 — 「변경 로그 N행」 접힘 (UI 밀도 라운드 3). */
  log: (projectId: number, planId: string) => call("plan_log", commands.planLog(projectId, planId)),

  /** 일지 → 계획 항목 연결 (`today_digest` 의 `journal_plan`) — 일지 상세가 「연결된 계획」을 찾는 데 쓴다. */
  journalLinks: async (projectId: number): Promise<JournalPlanLink[]> =>
    (await call("today_digest", commands.todayDigest(projectId))).journal_plan,

  /** 새 계획 파일 — 제목만 받고 id·경로는 백엔드가 짓는다. */
  create: (projectId: number, title: string): Promise<PlanSummary> =>
    call("plan_create", commands.planCreate(projectId, title)),

  /**
   * `.md` SSOT 에 편집 하나 — 본문을 고치고 plan-log 에 `agentId` 로 한 줄 남긴다
   * (`null` 이면 `user`). 고친 뒤의 계획을 돌려준다.
   */
  applyEdit: (projectId: number, planId: string, op: PlanEditOp, agentId: string | null) =>
    call("plan_apply_edit", commands.planApplyEdit(projectId, planId, op, agentId)),

  /** 닫힌(done/archived) 플랜에 남은 미완 — 이미 `carry-<id>` 로 옮긴 것은 빠져 온다. */
  lockedOpen: (projectId: number): Promise<LockedOpenItem[]> =>
    call("plan_locked_open", commands.planLockedOpen(projectId)),

  /** 활성 플랜의 판정·다음 리프·사람 몫·막힘·일지 → 계획 연결 — 오늘 화면이 한 번에 읽는다. */
  todayDigest: (projectId: number): Promise<TodayDigest> =>
    call("today_digest", commands.todayDigest(projectId)),

  /** 항목 하나를 에이전트에게 넘길 프롬프트 — 붙여 넣는 것은 사용자다. */
  dispatchPrompt: (projectId: number, planId: string, itemId: string): Promise<DispatchPrompt> =>
    call("plan_dispatch_prompt", commands.planDispatchPrompt(projectId, planId, itemId)),
};
