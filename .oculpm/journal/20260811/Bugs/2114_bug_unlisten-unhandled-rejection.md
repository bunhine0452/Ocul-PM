---
schema_version: 1
type: bug
slug: "unlisten-unhandled-rejection"
status: done
difficulty: low
created_at: "2026-08-11T21:14:20+09:00"
session_id: "manual-20260811-211420"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: true
files_touched:
  - path: "src/lib/unlisten.ts"
    op: create
  - path: "src/features/oculpm/useJournalEvents.ts"
    op: update
  - path: "src/features/today/useTodayMonitor.ts"
    op: update
  - path: "src/features/today/JournalMissingCard.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
related:
  - ".oculpm/journal/20260811/Refactors/2101_refactor_font-swap-and-perf-round.md"
tags: ["tauri", "events", "unhandled-rejection", "dev-noise"]
---

[x] Tauri 이벤트 해제가 unhandled rejection 으로 새던 문제

## 발생 원인

`oculpm.log` 에 같은 오류가 무더기로 찍혔다:

```
unhandled rejection: undefined is not an object (evaluating 'listeners[eventId].handlerId')
  unregisterListener@user-script:10:13:9
  _unlisten@.../chunk-XQR6FPKK.js:27:61
  @src/features/oculpm/useJournalEvents.ts
```

`listen()` 이 돌려주는 해제 함수는 **async** 다 (`node_modules/@tauri-apps/api/event.js:81`):

```js
return invoke('plugin:event|listen', {...})
  .then((eventId) => async () => _unlisten(event, eventId));

async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  ...
}
```

`__TAURI_EVENT_PLUGIN_INTERNALS__` 는 웹뷰 주입 스크립트가 만드는 **페이지 로드 단위 전역**이다. 페이지가 리로드되면 이 레지스트리가 비는데, 리로드 전에 만들어진 해제 클로저가 뒤늦게 실행되면 `listeners[eventId]` 가 undefined 라 `.handlerId` 접근에서 TypeError. `_unlisten` 이 async 라 이게 rejected promise 가 되고, 호출부가 안 잡으면 unhandled rejection 으로 샌다.

각 구독 지점은 프라미스 **안쪽** 경로를 이미 `.catch(() => {})` 로 막아두고 주석에 "so there's no unhandled rejection" 이라고 의도까지 적어놨는데, **cleanup 경로만 빠져 있었다** — `offs.forEach((off) => off())` / `off?.()` / `void un.then((f) => f())` 전부 async 반환을 버린다.

트리거는 dev 전용이었다. `/tmp/oculpm-vite.log` 가 그대로 남겨 줬다:

```
12:05:10  Re-optimizing dependencies because lockfile has changed
12:05:10  VITE ready   ← 재시작 1
12:05:19  VITE ready   ← 재시작 2
12:06:35  ← 오류 버스트 (같은 밀리초에 8개 = 단일 전역 teardown)
```

같은 라운드에서 폰트 패키지를 갈아치우며 `pnpm-lock.yaml` 이 바뀐 것이 Vite 의존성 재최적화 → 전체 리로드를 불렀다. 패키징된 앱은 HMR·재최적화가 없고 페이지 로드가 한 번뿐이라 이 경로가 열리지 않는다.

## 해결 방법

`src/lib/unlisten.ts` 에 `safeUnlisten(off)` / `safeUnlistenPromise(pending)` 를 두고 **모든** 해제 지점을 통과시켰다. 동기 throw 와 비동기 rejection 을 함께 삼킨다 — 해제 실패는 어차피 "이미 사라진 리스너"라는 뜻이라 삼키는 것이 옳다.

적용 7곳: `useJournalEvents`(2) · `useTodayMonitor`(2) · `JournalMissingCard`(2) · `WorkspaceContext`(1) · `ShellV2`(1) · `TrayPopover`(2). 헬퍼로 뺀 이유는 지점이 6파일에 흩어져 있고, "동기처럼 생겼는데 async" 라는 함정이 다음 구독 지점에서 그대로 재발하기 때문이다.

## 검증

`grep` 으로 프로덕션 코드에 bare 해제 호출(`off()` / `off?.()` / `un.then((f) => f())`)이 하나도 남지 않은 것을 확인했다 (테스트 코드 2곳은 Tauri 목이라 해당 없음). `pnpm typecheck` · `pnpm test`(611 통과) · `pnpm lint` 전부 exit 0.

**한계**: 재현 경로가 dev 전용 리로드라 "오류가 다시 안 난다"를 직접 관측하지는 못했다. 고친 것은 rejection 이 새는 경로이지 해제 실패 자체가 아니다 — 해제 실패는 무해하다는 판단이 전제다.

## 메모

- 사용자가 로그를 물어와서 발견했다. 오류 자체는 이번 라운드 코드와 무관한 기존 결함이었고(`git diff` 로 해당 파일 미변경 확인), 다만 내 lockfile 변경이 리로드를 일으켜 드러냈다.
- `oculpm-defer` 마커는 남기지 않았다 — 천장이 있는 지름길이 아니라 완결된 수정이다.
