import { createIntentSlot } from "@/lib/createStore";

/**
 * 「이 맥락으로 이어서 작업」을 **시작 탭에서** 누른 뜻 — 프로젝트를 열고, 오늘 화면이 서면
 * 이어하기 디스패치를 한 번 돈다 (UI 밀도 라운드 3, 시안 Start). 일지 점프(`entryJump`)와
 * 같은 끈적한 슬롯이다: 프로젝트 탭이 승격되는 사이에 리스너가 없어도 뜻이 사라지지 않는다.
 */
const slot = createIntentSlot<number>("oculpm:resume-on-open");

export function requestResumeOnOpen(projectId: number): void {
  slot.hold(projectId);
}

/** 이 프로젝트의 뜻이 걸려 있으면 소비한다 — 한 번만. */
export function consumeResumeOnOpen(projectId: number): boolean {
  const pending = slot.consume();
  if (pending === projectId) return true;
  if (pending != null) slot.hold(pending);
  return false;
}

export function _resetResumeOnOpen(): void {
  slot.reset();
}
