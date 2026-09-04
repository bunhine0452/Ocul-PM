/**
 * 앱 배율(`uiScale`)을 실제로 **거는** 자리 — 네이티브 웹뷰 줌.
 *
 * CSS `zoom` 이 아니라 웹뷰 줌인 이유는 픽셀을 재는 컴포넌트(xterm·React
 * Flow·차트) 때문이다. 네이티브 줌은 페이지를 다시 흘려 주므로 그것들이
 * 그대로 맞는다.
 *
 * 파일로 나온 이유(v2.42.0 `{#settings-slider}`): 이제 이 적용을 부르는 곳이
 * **둘**이다 — 설정이 바뀐 뒤의 `SettingsContext`(창마다·재마운트마다) 와
 * 드래그 중인 슬라이더의 **즉시 미리보기**. 클램프 규칙을 양쪽에 베끼면
 * 한쪽만 고쳐질 자리가 생긴다.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** 잘못된 값이 사용자를 화면 밖으로 밀어내지 못하게 하는 상·하한. */
export const UI_SCALE_MIN = 0.7;
export const UI_SCALE_MAX = 1.6;

export function clampUiScale(value: number): number {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value || 1));
}

/**
 * 이 창의 줌을 즉시 바꾼다. Tauri 밖(테스트·웹 미리보기)에서는 조용한 no-op —
 * `getCurrentWebview()` 는 **동기로 던지고** `setZoom()` 은 거절할 수 있어
 * 두 갈래를 모두 삼킨다 (실패해도 앱이 계속 도는 편이 맞는 유일한 자리다:
 * 줌이 안 걸리는 것은 기능이 아니라 환경이다).
 */
export function applyUiScale(value: number): void {
  try {
    void getCurrentWebview()
      .setZoom(clampUiScale(value))
      .catch(() => {});
  } catch {
    /* not running under Tauri — ignore */
  }
}
