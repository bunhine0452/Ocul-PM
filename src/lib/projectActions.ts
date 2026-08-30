// 프로젝트 탭이 소유한 동작을 화면 어디서나 **요청**하는 버스 (완성도 라운드
// Phase 2, 2026-08-30).
//
// `.oculpm` 활성화와 코드 색인은 `windows/ProjectTab.tsx` 가 돌린다 — 진행
// 상태(워크스페이스의 indexingProjectId)와 실패 토스트를 한 곳이 책임지기
// 위해서다. 그런데 "지금 활성화" 는 Today 에, "색인 만들기" 는 검색·코드 맵·
// 닥터에 있어야 한다. prop 을 여섯 단계 내려보내는 대신 요청만 보낸다
// (`createIntentSlot` 의 값 없는 형 — 끈적 플래그는 쓰지 않는다: 요청 시점에
// 활성 탭 하나가 반드시 살아 있고, 구독자가 `active` 로 거른다).
import { createIntentSlot } from "@/lib/createStore";

function requestBus(eventName: string) {
  const slot = createIntentSlot<null>(eventName);
  return {
    request: () => slot.request(null),
    subscribe: (fn: () => void) => slot.subscribe(() => fn()),
  };
}

const activateBus = requestBus("oculpm:activate");
const reindexBus = requestBus("oculpm:reindex");
const cheatsheetBus = requestBus("oculpm:open-cheatsheet");

/** Today 「지금 활성화」 — 프로젝트 탭이 init·status·watcher 를 다시 돌린다. */
export const requestOculpmActivate = activateBus.request;
export const onOculpmActivateRequest = activateBus.subscribe;

/** 검색·코드 맵·닥터의 「색인 만들기」 — 이미 만드는 중이면 탭이 무시한다. */
export const requestReindex = reindexBus.request;
export const onReindexRequest = reindexBus.subscribe;

/** ⌘/ · 팔레트 「키보드 단축키」 — 창에 하나 떠 있는 치트시트를 연다. */
export const requestCheatsheet = cheatsheetBus.request;
export const onCheatsheetRequest = cheatsheetBus.subscribe;
