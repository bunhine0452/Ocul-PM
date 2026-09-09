/**
 * IME 조합 중인가 — **여기가 정의 자리다**. 2026-09-10 {#unify-chat}
 *
 * 한글 조합을 확정하는 Enter 는 "확정" 이지 "실행" 이 아니다. 이 판정을
 * 빠뜨리면 「회고」를 치다가 조합이 확정되는 순간 프로젝트가 열리고, 컴포저에서는
 * 문장이 그대로 전송된다 — 한글로 쓰는 사용자가 매일 밟는 지뢰다.
 *
 * 이 규칙이 앱에 **네 벌** 있었고, 셋은 두 조건만 알고 있었다:
 *
 *     chat/conversation/useComposerKeys.ts   isComposing || keyCode === 229
 *     chat/AiPanelScreenV2.tsx               isComposing || keyCode === 229
 *     onboarding/StartScreen.tsx  (2곳)      isComposing || keyCode === 229
 *     terminal/imeBridge.ts                  + key === "Process"   ← 이것만 완전했다
 *
 * 터미널 쪽이 한 조건을 더 알고 있었던 건 우연이 아니다 — 그 화면이 IME 버그로
 * 제일 많이 데였고(`imeBridge.ts` 머리 주석의 트레이스 기록), 그러다 얻은 지식이
 * 그 파일에만 남았다. 판정이 네 자리에 흩어져 있으면 배운 것이 퍼지지 않는다.
 *
 * 세 신호를 **모두** 봐야 하는 이유:
 *   - `isComposing` — 표준. 다만 일부 엔진(Safari 포함)이 늦게 세팅한다.
 *   - `keyCode === 229` — 조합 중 키다운의 전통적 신호. 위가 늦을 때의 보루.
 *   - `key === "Process"` — 또 다른 엔진이 조합 중 키에 쓰는 이름.
 *
 * 셋 다 "조합 중" 일 때만 참이므로, 더 보는 쪽이 안전한 방향이다.
 */

/** React 합성 이벤트와 네이티브 이벤트를 모두 받는다 — 호출부가 둘 다 있다. */
type AnyKeyEvent =
  | Pick<KeyboardEvent, "isComposing" | "keyCode" | "key">
  | { nativeEvent: Pick<KeyboardEvent, "isComposing" | "keyCode" | "key"> };

export function isImeComposing(e: AnyKeyEvent): boolean {
  const native = "nativeEvent" in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229 || native.key === "Process";
}
