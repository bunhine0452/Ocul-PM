/**
 * "일지 작성기를 열어라" 요청을 화면 트리 밖에서 전달하는 one-shot 버스.
 *
 * `CommandPalette` 는 예전부터 `oculpm:request-manual-entry` 이벤트를 쏘고
 * 있었지만 **아무도 듣지 않아** 팔레트의 '새 일지'가 동작하지 않았다. 여기서
 * 살리면서, 터미널의 에이전트 실행 종료 제안도 같은 문을 쓴다.
 *
 * 순수 이벤트만으로는 부족하다 — 작업 일지 화면은 lazy 라서, 다른 화면에서
 * 요청을 쏘면 리스너가 붙기 전에 이벤트가 사라진다. 그래서 **끈적한 플래그**를
 * 함께 둔다: 화면이 마운트될 때 [`consumeManualEntryRequest`] 로 회수한다.
 */

const EVENT = "oculpm:request-manual-entry";

/**
 * 작성기를 미리 채울 재료 (2026-08-28). 터미널 명령 블록의 "일지로 남기기"가
 * 명령줄·종료코드·출력 꼬리를 실어 보낸다 — 빈 작성기를 열고 사용자가 방금 본
 * 것을 손으로 옮겨 적게 하면 아무도 안 쓴다.
 *
 * 씨앗은 **초기값일 뿐**이다. 작성기가 열린 뒤에는 사용자가 전부 고칠 수 있고,
 * 저장 전까지 디스크에 닿지 않는다.
 */
export interface ManualEntrySeed {
  title?: string;
  body?: string;
}

/** 아직 아무 화면도 회수하지 않은 요청이 있는가. */
let pending: ManualEntrySeed | null = null;

/**
 * 작성기를 열어달라고 요청한다. 이미 떠 있는 화면은 이벤트로 즉시 반응하고,
 * 아직 마운트되지 않은 화면은 마운트 시 플래그로 회수한다.
 */
export function requestManualEntry(seed?: ManualEntrySeed): void {
  pending = seed ?? {};
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pending }));
}

/**
 * 대기 중인 요청을 회수한다 — 있으면 씨앗(없이 요청했으면 빈 객체), 없으면
 * `null`. 화면 마운트 시 한 번 부른다 (두 번 열리지 않도록 소비형이다).
 */
export function consumeManualEntryRequest(): ManualEntrySeed | null {
  const had = pending;
  pending = null;
  return had;
}

/**
 * 요청을 **이벤트 없이** 다시 붙들어 둔다. 셸이 다른 화면에서 온 요청을 받아
 * 일지 화면으로 옮길 때 쓴다 — 구독 콜백이 플래그를 이미 소비했으므로, 이걸로
 * 되돌려 두어야 일지 화면이 마운트되며 `consumeManualEntryRequest` 로 회수한다.
 * (`requestManualEntry` 를 다시 부르면 이벤트가 또 돌아 셸이 무한히 받는다.)
 */
export function holdManualEntryRequest(seed: ManualEntrySeed): void {
  pending = seed;
}

/** 이미 마운트된 화면용 구독. 콜백 실행 전에 플래그를 소비한다. */
export function onManualEntryRequest(fn: (seed: ManualEntrySeed) => void): () => void {
  const handler = (event: Event) => {
    const seed = (event as CustomEvent<ManualEntrySeed>).detail ?? {};
    pending = null;
    fn(seed);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** 테스트 전용 — 모듈 스코프 플래그를 초기화한다. */
export function _resetManualEntryRequest(): void {
  pending = null;
}
