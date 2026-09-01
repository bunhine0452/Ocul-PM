/**
 * 마지막 턴의 회상 사용량 (Phase 5 `#context-tab` 의 「예산」 칸).
 *
 * 설정 화면이 "이번 대화가 회상에 얼마를 썼는가" 를 말하려면 그 숫자가 어딘가
 * 있어야 하는데, 조립은 AI 패널에서 일어나고 화면은 설정에 있다. 두 곳이
 * 컨텍스트 트리에서 조상이 아니므로 모듈 스토어다 (i18n 언어 스토어와 같은 이유).
 *
 * 런타임 값이다 — 저장하지 않는다. 앱을 다시 켜면 비어 있는 것이 맞다.
 */
import { createStore } from "@/lib/createStore";
import type { RecallSignal } from "./recallGate";

export interface RecallUsage {
  signal: RecallSignal;
  tokens: number;
  dropped: number;
  /** 몇 개가 실제로 실렸나. */
  used: number;
}

const EMPTY: RecallUsage = { signal: "none", tokens: 0, dropped: 0, used: 0 };

const store = createStore<RecallUsage>(EMPTY);

export const useRecallUsage = store.useValue;
export const setRecallUsage = store.set;
export const resetRecallUsage = () => store.set(EMPTY);
