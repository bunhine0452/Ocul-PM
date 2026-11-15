/**
 * 「검증 없는 것만」 을 켠 채 일지 화면을 열라는 요청 (11-15 합류 G-11) — 오늘의 「검증 없이 끝난 일지」 묶음의
 * 「N건 더」 가 보낸다. 그 거르기는 일지 화면의 지역 상태라(열 때마다 「전체」 로 시작한다 — `JournalScreenV2`) 다른
 * 화면이 켤 길이 없어서, 오늘은 남은 줄을 제자리에서 펼쳤다.
 *
 * 요청은 그날(`workday`)을 싣는다 (11-15 SCR-05) — 오늘의 「3건 더」 는 그날의 검증 없는 일지를 센 수인데, 일지
 * 화면은 지난 모든 날을 세워 38줄이 섰고 그날로 좁힐 길도 없었다. 일지 화면은 그날로 좁혀 서고, 눌린 단추
 * 「오늘만」 을 누르면 모든 날로 넓힌다.
 *
 * 화면은 한 번에 하나만 서므로 요청은 끈적하게 남았다가 일지 화면이 설 때 한 번 회수된다(`createIntentSlot`).
 * 창 하나 = 프로젝트 하나라 프로젝트 id 는 싣지 않는다.
 */
import { createIntentSlot } from "@/lib/createStore";

export interface OnlyMissingRequest {
  /** 이 날(`YYYYMMDD`)로 좁힌다 — `null` 이면 모든 날. */
  workday: string | null;
}

const slot = createIntentSlot<OnlyMissingRequest>("oculpm:journal-only-missing");

/** 일지 화면으로 옮기기 **직전**에 부른다. */
export function requestOnlyMissing(workday: string | null = null): void {
  slot.request({ workday });
}

/** 일지 화면이 설 때 한 번 — 와 있던 요청을 가져간다. */
export function consumeOnlyMissing(): OnlyMissingRequest | null {
  return slot.consume();
}

/** 이미 서 있는 일지 화면용 구독. */
export function onOnlyMissing(fn: (req: OnlyMissingRequest) => void): () => void {
  return slot.subscribe((req) => fn(req));
}

/** 테스트 전용. */
export function resetOnlyMissing(): void {
  slot.reset();
}
