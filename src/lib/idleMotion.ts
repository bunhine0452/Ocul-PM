/**
 * 창을 보고 있지 않으면 `<html data-app-inactive>` 를 단다 — 창 하나에 한 번.
 *
 * 증상 (2026-10-08 검토): 입력이 없는 설치본이 CPU 를 웹뷰 8.5% · UI 3.7% · GPU 3.2%
 * 쓰고 있었다. UI 프로세스의 CVDisplayLink 가 쉬지 않고 돌았다 — 화면 갱신을 계속
 * 깨우는 것이 있었다는 뜻이다. 무한 반복 CSS 애니메이션이 29곳이고, 터미널 페인의
 * running/waiting 숨쉬기는 claude 가 떠 있는 내내(몇 시간씩) 돈다. 창이 뒤에 있거나
 * 다른 앱을 쓰는 동안에도 멈추는 장치가 없었다.
 *
 * 그래서 판정은 한 곳에서 한다: 포커스가 없거나 가려졌으면 속성을 달고, CSS
 * (`primitives.css`)가 그 아래의 애니메이션을 일시정지한다. 색과 모양은 그대로라
 * 상태는 여전히 읽힌다. rAF 루프(터미널 WebGL 렌더)는 출력이 있을 때만 도므로
 * 건드리지 않는다.
 *
 * 세 갈래 창(탭 창 · 떼어낸 터미널 · 트레이)이 모두 같아야 하므로 `main.tsx` 의
 * 갈림길 위에서 건다 (`installNativeDragGuard` 와 같은 자리).
 */

let installed = false;

/** 지금 이 창을 보고 있지 않은가 — 가려졌거나 포커스가 다른 앱·창에 있다. */
export function isAppInactive(doc: Document = document): boolean {
  return doc.visibilityState === "hidden" || !doc.hasFocus();
}

/** 속성을 지금 상태에 맞춘다. 같은 값이면 DOM 을 건드리지 않는다. */
export function syncIdleMotion(doc: Document = document): void {
  const root = doc.documentElement;
  const inactive = isAppInactive(doc);
  if (inactive === root.hasAttribute("data-app-inactive")) return;
  if (inactive) root.setAttribute("data-app-inactive", "");
  else root.removeAttribute("data-app-inactive");
}

export function installIdleMotionPause(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const sync = () => syncIdleMotion(document);
  window.addEventListener("focus", sync);
  // blur 시점엔 포커스가 아직 옮겨 가는 중이다 — 창 안의 iframe 으로 간 것이면
  // 다음 틱의 `hasFocus()` 가 참이라 멈추지 않는다.
  window.addEventListener("blur", () => window.setTimeout(sync, 0));
  document.addEventListener("visibilitychange", sync);
  sync();
}
