import { oculpmLog } from "@/lib/oculpmLog";

// 웹뷰의 bare `window.confirm`/`alert`/`prompt` 를 붙잡는다 (2026-10-01,
// `improvement-round-2026-09-14 {#no-bare-confirm-gate}`).
//
// Tauri dialog 플러그인의 init 스크립트(`tauri-plugin-dialog/src/init-iife.js`)가
// 페이지 스크립트보다 먼저 `window.confirm` 을 **async 함수**로 덮어쓴다. 그런데
// `dialog:default` 권한 세트에는 `allow-confirm` 이 없다. 그래서 웹뷰 어디서든
// `if (confirm("…"))` 는:
//
//  1. `plugin:dialog|confirm` 이 ACL 에 막혀 unhandled rejection 을 남기고,
//  2. 돌려받은 **Promise 가 truthy** 라 사용자에게 묻지도 않고 "예" 로 지나간다.
//
// 2026-09-21 에 xterm 의 OSC 8 기본 처리기가 정확히 이렇게 죽었다(`urlLinks.ts`).
// 우리 코드는 ESLint `no-restricted-globals` 가 막지만(eslint.config.js), 서드파티
// 라이브러리 안의 호출은 린트가 못 본다 — 재발 지점은 거기다.
//
// 여기서는 그 호출을 **안전한 답**으로 바꾸고 파일 로그에 호출 위치를 남긴다:
//
//  - `confirm` → `false` (동기). 묻지 않은 파괴 동작이 "예" 로 지나가지 않는다.
//  - `prompt`  → `null` (취소). WKWebView 는 원래도 UI 위임자가 없어 null 이었다.
//  - `alert`   → 원래 구현(플러그인의 네이티브 메시지 상자, `allow-message` 는
//    기본 세트에 있다)을 그대로 부른다. 막을 이유는 없고, 로그만 남긴다.
//
// 앱 안에서 확인이 필요하면 `hooks/useConfirm.tsx` 를 쓴다.

type DialogName = "confirm" | "alert" | "prompt";

/** 호출 지점 — 이 모듈 자신의 프레임을 빼고 몇 줄만. */
function callerStack(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  return lines
    .filter((line) => !line.includes("nativeDialogs"))
    .slice(0, 6)
    .map((line) => line.trim())
    .join(" ← ");
}

function report(name: DialogName, message: unknown): void {
  const text = `bare window.${name}() call (use useConfirm) | message=${JSON.stringify(
    String(message ?? "").slice(0, 200),
  )} | at ${callerStack()}`;
  oculpmLog.warn("dialog", text);
}

/**
 * 창에 가드를 설치한다. 반환값을 부르면 원래 함수로 되돌린다(테스트용).
 */
export function installNativeDialogGuard(win: Window = window): () => void {
  const original = {
    confirm: win.confirm,
    alert: win.alert,
    prompt: win.prompt,
  };

  win.confirm = (message?: string) => {
    report("confirm", message);
    return false;
  };
  win.prompt = (message?: string) => {
    report("prompt", message);
    return null;
  };
  win.alert = (message?: unknown) => {
    report("alert", message);
    original.alert?.call(win, message);
  };

  return () => {
    win.confirm = original.confirm;
    win.alert = original.alert;
    win.prompt = original.prompt;
  };
}
