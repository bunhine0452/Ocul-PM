// Tauri 이벤트 해제 헬퍼 (2026-08-11).
//
// `listen()` 이 돌려주는 해제 함수는 **async** 다 (@tauri-apps/api/event.js):
//
//     return invoke('plugin:event|listen', {...})
//       .then((eventId) => async () => _unlisten(event, eventId));
//
//     async function _unlisten(event, eventId) {
//       window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
//       ...
//     }
//
// `__TAURI_EVENT_PLUGIN_INTERNALS__` 는 웹뷰 주입 스크립트가 만드는 **페이지
// 로드 단위 전역**이다. 페이지가 리로드되면 레지스트리가 비는데, 리로드 전에
// 만들어진 해제 클로저가 뒤늦게 실행되면 `listeners[eventId]` 가 undefined 라
// `.handlerId` 접근에서 TypeError 가 난다. `_unlisten` 이 async 라 이 throw 는
// rejected promise 가 되고, 호출부가 안 잡으면 unhandled rejection 으로 샌다.
//
// 실제로 2026-08-11 dev 에서 lockfile 변경 → Vite 의존성 재최적화 → 전체 리로드
// 경로로 이 rejection 이 무더기로 찍혔다 (oculpmLog 콘솔 브리지를 타고 oculpm.log
// 까지 오염). 패키징된 앱은 HMR·재최적화가 없어 이 경로가 열리지 않지만, 해제
// 실패는 어차피 "이미 사라진 리스너"라는 뜻이라 삼키는 것이 맞다.
//
// 각 구독 지점이 프라미스 **안쪽** 경로는 이미 `.catch(() => {})` 로 막고 있었고
// (주석에 "so there's no unhandled rejection" 이라고 의도까지 적혀 있다), cleanup
// 경로만 빠져 있었다. 두 경로 모두 이 헬퍼를 쓴다.

/** Tauri 의 해제 함수. 동기 시그니처지만 실제로는 Promise 를 돌려준다. */
export type MaybeAsyncUnlisten = () => void | Promise<unknown>;

/**
 * 해제 함수를 안전하게 호출한다 — 동기 throw 와 비동기 rejection 을 모두 삼킨다.
 * `null`/`undefined` 는 무시하므로 `safeUnlisten(off)` 를 그대로 쓸 수 있다.
 */
export function safeUnlisten(off: MaybeAsyncUnlisten | null | undefined): void {
  if (!off) return;
  try {
    void Promise.resolve(off()).catch(() => {});
  } catch {
    /* 동기 throw — 해제 실패는 이미 해제된 것과 같으므로 무시한다 */
  }
}

/**
 * 해제 함수를 담은 프라미스를 안전하게 소비한다 (`listen()` 결과를 그대로 들고
 * 있는 구독 지점용). listen 자체의 실패도 함께 삼킨다.
 */
export function safeUnlistenPromise(
  pending: Promise<MaybeAsyncUnlisten> | null | undefined,
): void {
  if (!pending) return;
  void pending.then(safeUnlisten).catch(() => {});
}
