---
schema_version: 1
type: bug
slug: "bare-dialog-gate"
status: done
difficulty: medium
created_at: "2026-10-01T18:25:29+09:00"
session_id: "20261001-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/nativeDialogs.ts"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "eslint.config.js"
    op: update
  - path: "src/__tests__/native_dialogs.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20260923/Bugs/1818_bug_bug-hunt-parallel-three-2026-09-22.md"
    kind: "followup"
tags:
  - "webview"
  - "lint"
  - "tauri"
  - "bug-hunt"
  - "mcp-tool"
---
[x] 웹뷰의 bare confirm()/alert()/prompt() — 묻지 않은 "예" 를 막는 ESLint 규칙 + 서드파티용 런타임 가드

## 발생 원인

`tauri-plugin-dialog` 2.7.3 의 init 스크립트(`src/init-iife.js`)가 페이지 스크립트보다 먼저 `window.confirm` 을 **async 함수**로, `window.alert` 를 `plugin:dialog|message` 호출로 덮어쓴다. 그런데 `dialog:default` 권한 세트는 `allow-message`·`allow-save`·`allow-open` 뿐이고 `allow-confirm` 이 없다. 그래서 웹뷰 어디서든 `if (confirm(…))` 는 ① ACL 거부로 unhandled rejection 을 남기고 ② 돌려받은 **Promise 가 truthy** 라 사용자에게 묻지도 않고 "예" 로 지나간다. 9/21 xterm OSC 8 기본 처리기가 정확히 이 길로 죽었다(9/23 버그 헌팅 일지). 우리 코드는 전부 `useConfirm` 이지만, 서드파티가 부르는 것이 재발 지점이었다 (`{#no-bare-confirm-gate}`).

## 해결 방법

- **린트(우리 코드)** — `eslint.config.js` 에 `no-restricted-globals`(confirm·alert·prompt) + `no-restricted-properties`(window·globalThis·self 의 셋), 메시지는 `useConfirm` 으로 안내. 지역 바인딩(`const confirm = useConfirm()`)은 전역이 아니라 걸리지 않는다 — 기존 호출 20여 곳 무변경 통과. 테스트 파일은 가드를 시험해야 해서 끔.
- **런타임(서드파티)** — `lib/nativeDialogs.ts` `installNativeDialogGuard()` 를 `main.tsx` 가 웹뷰일 때만(모바일 브라우저의 진짜 동기 대화상자는 그대로) 건다. `confirm` → 동기 `false`, `prompt` → `null`(취소, WKWebView 는 원래도 null), `alert` → 원래 구현(플러그인 메시지 상자, 허용됨)으로 넘김. 셋 다 `oculpmLog.warn("dialog", …)` 로 메시지 200자와 호출 스택 6프레임을 남긴다 — 다음 재발은 로그 한 줄로 어느 라이브러리인지 보인다.
- 버린 대안: `dialog:allow-confirm` 을 켜는 것 — 그러면 서드파티 확인창이 테마 밖 네이티브 창으로 뜨고, 여전히 Promise 라 `if (confirm())` 는 응답 전에 지나간다.

## 검증

- `native_dialogs.test.ts` 6건(동기 false · WARN 한 줄과 스택 · prompt null · alert 위임 · 200자 자름 · 해제 복원) 통과. ESLint 규칙은 일회용 프로브 파일(`confirm()`·`window.alert`·`globalThis.prompt`)로 세 오류가 나는 것을 확인 후 삭제.
- 전체 게이트(typecheck·test 3,288·lint 6게이트·build) exit 0.
- 실기기 미확인: 다음 설치본에서 `oculpm.log` 에 `[dialog] bare window.` 줄이 0 인지, 있으면 그 스택이 가리키는 라이브러리.