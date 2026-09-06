// 세션 한 자리가 **지금 무엇을 하고 있는가** (플랜 `v3-surface`
// `{#activity-vocab-reuse}`).
//
// 대화 화면과 **같은 어휘**로 답한다 (`features/chat/activity`). 지금까지
// 이 화면이 할 수 있는 말은 「잡은 구역」 하나뿐이었고 그것도 이 화면만의
// 낱말이었다.
//
// ## 지어내지 않는다
//
// 원장이 아는 사실은 셋뿐이다 — 승인을 기다리는 태스크, 안 끝난 태스크, 잡은
// 구역. 앱 안에서 도는 ACP 턴과는 **이어 붙일 방법이 없다**: `acpBusyBus` 의
// 키는 ACP 세션 id 인데 카드가 든 것은 ocul-pm 세션 id 라 서로 다른 축이다.
// 그래서 「돌고 있다」는 여기서 말하지 않는다 — 모르는 것은 안 적는다.

import type { ActivityKind } from "@/features/chat/activity/activityTypes";
import type { SessionSeat } from "./sessionModel";

export interface SeatActivity {
  kind: ActivityKind;
  /** 한 줄 상세 — 태스크 제목이거나 잡은 구역들. */
  detail: string;
}

/**
 * 이 자리의 한 줄. 아는 것이 없으면 `null` (조용한 것과 모르는 것은 같다 —
 * 둘 다 적을 말이 없다).
 *
 * 차례가 곧 급한 순서다: 승인 대기는 사람이 눌러야 풀리고, 진행 중인 태스크는
 * 지금 오가는 일이고, 잡은 구역은 앞으로의 예고다.
 */
export function seatActivity(seat: SessionSeat): SeatActivity | null {
  const waiting = seat.openTasks.find((task) => task.state === "submitted");
  if (waiting) return { kind: "permission", detail: waiting.title };
  if (seat.openTasks.length) return { kind: "oculpm-a2a", detail: seat.openTasks[0].title };
  if (seat.leases.length) {
    return { kind: "edit", detail: seat.leases.flatMap((lease) => lease.patterns).join(" · ") };
  }
  return null;
}
