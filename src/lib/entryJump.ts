/**
 * "이 프로젝트의 이 일지를 열어라" — 시작 탭의 **오늘의 흐름**이 프로젝트 셸에
 * 건네는 요청.
 *
 * 왜 버스인가: 흐름 행을 누르면 시작 탭이 **그 자리에서** 프로젝트 탭으로
 * 승격한다 (`set_tab_project`). 누르는 순간에는 셸이 아직 없으므로 콜백으로
 * 넘길 곳이 없고, 마운트 직후에 이벤트를 쏘면 리스너가 붙기 전이라 유실된다.
 * `createIntentSlot` 의 끈적 플래그가 정확히 이 두 경우를 함께 덮는다 —
 * 아직 없는 셸은 마운트 때 `consumeEntryJump` 로 회수하고, 이미 떠 있는 탭
 * (같은 창에서 이미 열려 있던 프로젝트)은 구독으로 받는다.
 *
 * 프로젝트 id 를 payload 에 함께 싣고 **받는 쪽이 걸러낸다** — 한 창에 프로젝트
 * 탭이 여럿이고 창 전역 CustomEvent 라, 걸러내지 않으면 엉뚱한 탭이 남의 일지를
 * 연다.
 *
 * 한계: 창을 넘지 못한다 (창마다 웹뷰=모듈 인스턴스가 따로다). 대상 프로젝트가
 * **다른 창**에 이미 열려 있으면 백엔드가 그 창을 포커스하고(I1), 이 요청은
 * 아무도 회수하지 않은 채 남는다 — 다음 요청이 덮어쓴다.
 */
import { createIntentSlot } from "@/lib/createStore";

export interface EntryJump {
  projectId: number;
  /** `.oculpm` 기준 상대 경로 — 저널 화면이 경로로 해소한다. */
  path: string;
}

const slot = createIntentSlot<EntryJump>("oculpm:open-entry");

/** 흐름 행 클릭 → 프로젝트를 여는 호출 **직전**에 부른다. */
export function requestEntryJump(projectId: number, path: string): void {
  slot.request({ projectId, path });
}

/** 셸 마운트 시 1회 — 이 프로젝트 앞으로 온 것만 회수한다. */
export function consumeEntryJump(projectId: number): string | null {
  const pending = slot.consume();
  if (!pending) return null;
  // 남의 프로젝트 앞으로 온 요청이면 도로 넣어 둔다 — 여기서 삼키면 정작
  // 대상 탭이 마운트됐을 때 회수할 것이 없다.
  if (pending.projectId !== projectId) {
    slot.hold(pending);
    return null;
  }
  return pending.path;
}

/** 이미 떠 있는 셸용 구독. 자기 프로젝트의 요청만 소비한다. */
export function onEntryJump(projectId: number, fn: (path: string) => void): () => void {
  return slot.subscribe(
    (payload) => {
      if (payload.projectId !== projectId) return;
      slot.consume();
      fn(payload.path);
    },
    // 걸러내기 전에 비우면 남의 요청까지 삼킨다 — 소비는 위에서 직접 한다.
    { consume: false },
  );
}

/** 테스트 전용. */
export function resetEntryJump(): void {
  slot.reset();
}
