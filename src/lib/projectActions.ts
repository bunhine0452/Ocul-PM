// 프로젝트 탭이 소유한 동작을 화면 어디서나 **요청**하는 버스 (완성도 라운드
// Phase 2, 2026-08-30).
//
// `.oculpm` 활성화는 `windows/ProjectTab.tsx` 가 돌린다 — 실패 토스트를 한 곳이
// 책임지기 위해서다. 그런데 "지금 활성화" 는 Today·닥터에 있어야 한다. prop 을
// 여섯 단계 내려보내는 대신 요청만 보낸다 (`createIntentSlot` 의 값 없는 형 —
// 끈적 플래그는 쓰지 않는다: 요청 시점에 활성 탭 하나가 반드시 살아 있고, 구독자가
// `active` 로 거른다). (「색인 만들기」 요청은 4.0 에서 코드 색인과 함께 걷었다.)
import { createIntentSlot } from "@/lib/createStore";

function requestBus(eventName: string) {
  const slot = createIntentSlot<null>(eventName);
  return {
    request: () => slot.request(null),
    subscribe: (fn: () => void) => slot.subscribe(() => fn()),
  };
}

const activateBus = requestBus("oculpm:activate");
const cheatsheetBus = requestBus("oculpm:open-cheatsheet");
const screenKeysBus = requestBus("oculpm:open-screen-keys");
const tourBus = requestBus("oculpm:open-tour");

/** Today 「지금 활성화」 — 프로젝트 탭이 init·status·watcher 를 다시 돌린다. */
export const requestOculpmActivate = activateBus.request;
export const onOculpmActivateRequest = activateBus.subscribe;

/** ⌘/ · 팔레트 「키보드 단축키」 — 창에 하나 떠 있는 치트시트를 연다. */
export const requestCheatsheet = cheatsheetBus.request;
export const onCheatsheetRequest = cheatsheetBus.subscribe;

/**
 * ? · 팔레트 「이 화면의 키」 (11-23) — 같은 치트시트를 **지금 화면 묶음 하나만** 작은 시트로 연다. 표는 따로
 * 만들지 않는다: `shortcutRegistry` 의 그 화면 묶음 그대로다(⌘/ 의 전체 표와 한 출처).
 */
export const requestScreenKeys = screenKeysBus.request;
export const onScreenKeysRequest = screenKeysBus.subscribe;

// 치트시트가 지금 떠 있나 (11-15 검수) — 표도 aria-modal 이라 전역 키의 모달 가드가 열린 표 위의 두 번째 ⌘/ 를
// 먹었다(Esc 로만 닫혔다). ⌘/ 는 가드 앞에서 이것을 보고 표 자신일 때만 토글한다. 표(`ShortcutCheatsheet`)가
// 열고 닫을 때 적는다 — 창(웹뷰)마다 하나.
let cheatsheetOpen = false;
export const noteCheatsheetOpen = (open: boolean) => {
  cheatsheetOpen = open;
};
export const isCheatsheetOpen = () => cheatsheetOpen;

/** 팔레트 「처음 쓰는 법」 — 창에 하나 떠 있는 첫 실행 안내를 다시 연다. */
export const requestTour = tourBus.request;
export const onTourRequest = tourBus.subscribe;
