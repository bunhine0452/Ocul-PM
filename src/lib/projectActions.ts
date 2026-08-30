// 프로젝트 탭이 소유한 동작을 화면 어디서나 **요청**하는 버스 (완성도 라운드
// Phase 2, 2026-08-30).
//
// `.oculpm` 활성화와 코드 색인은 `windows/ProjectTab.tsx` 가 돌린다 — 진행
// 상태(워크스페이스의 indexingProjectId)와 실패 토스트를 한 곳이 책임지기
// 위해서다. 그런데 "지금 활성화" 는 Today 에, "색인 만들기" 는 검색·코드 맵·
// 닥터에 있어야 한다. prop 을 여섯 단계 내려보내는 대신 창 전역 CustomEvent
// 로 요청만 보낸다 (`settingsNav.ts`·`NAV_BUS` 와 같은 결).
//
// 프로젝트 탭이 여럿 마운트돼 있어도(크롬식 탭) **활성 탭만** 받는다 —
// 구독자가 `active` 로 거른다. 그래서 끈적 플래그는 없다: 요청 시점에 반드시
// 활성 탭 하나가 살아 있다.

function makeRequestBus(eventName: string) {
  return {
    request(): void {
      window.dispatchEvent(new CustomEvent(eventName));
    },
    subscribe(fn: () => void): () => void {
      const on = () => fn();
      window.addEventListener(eventName, on);
      return () => window.removeEventListener(eventName, on);
    },
  };
}

const activateBus = makeRequestBus("oculpm:activate");
const reindexBus = makeRequestBus("oculpm:reindex");
const cheatsheetBus = makeRequestBus("oculpm:open-cheatsheet");

/** Today 「지금 활성화」 — 프로젝트 탭이 init·status·watcher 를 다시 돌린다. */
export const requestOculpmActivate = activateBus.request;
export const onOculpmActivateRequest = activateBus.subscribe;

/** 검색·코드 맵·닥터의 「색인 만들기」 — 이미 만드는 중이면 탭이 무시한다. */
export const requestReindex = reindexBus.request;
export const onReindexRequest = reindexBus.subscribe;

/** ⌘/ · 팔레트 「키보드 단축키」 — 창에 하나 떠 있는 치트시트를 연다. */
export const requestCheatsheet = cheatsheetBus.request;
export const onCheatsheetRequest = cheatsheetBus.subscribe;
