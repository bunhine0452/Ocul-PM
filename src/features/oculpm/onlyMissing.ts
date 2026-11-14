/**
 * 「검증 없는 것만」 을 켠 채 일지 화면을 열라는 요청 (11-15 합류 G-11) — 오늘의 「검증 없이 끝난 일지」 묶음의
 * 「N건 더」 가 보낸다. 그 거르기는 일지 화면의 지역 상태라(열 때마다 「전체」 로 시작한다 — `JournalScreenV2`) 다른
 * 화면이 켤 길이 없어서, 오늘은 남은 줄을 제자리에서 펼쳤다.
 *
 * 화면은 한 번에 하나만 서므로 요청은 끈적하게 남았다가 일지 화면이 설 때 한 번 회수된다(`createIntentSlot`).
 * 창 하나 = 프로젝트 하나라 프로젝트 id 는 싣지 않는다.
 */
import { createIntentSlot } from "@/lib/createStore";

const slot = createIntentSlot<true>("oculpm:journal-only-missing");

/** 일지 화면으로 옮기기 **직전**에 부른다. */
export function requestOnlyMissing(): void {
  slot.request(true);
}

/** 일지 화면이 설 때 한 번 — 와 있던 요청을 가져간다. */
export function consumeOnlyMissing(): boolean {
  return slot.consume() === true;
}

/** 이미 서 있는 일지 화면용 구독. */
export function onOnlyMissing(fn: () => void): () => void {
  return slot.subscribe(() => fn());
}

/** 테스트 전용. */
export function resetOnlyMissing(): void {
  slot.reset();
}
