---
schema_version: 1
type: feature
slug: "render-error-boundaries-two-layers"
status: done
difficulty: low
created_at: "2026-08-16T00:24:14+09:00"
session_id: "mcp-20260816-002414"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/ErrorBoundary.tsx"
    op: create
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/windows/SettingsOverlay.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/error_boundary.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "ui"
  - "resilience"
  - "error-boundary"
  - "i18n"
  - "window"
  - "mcp-tool"
---
[x] 화면 한 조각의 예외가 창 전체를 지우지 못하게 — 범용 렌더 경계 2층

직전 일지([0015] 타이틀바 더블클릭 · 빈 ocul-pm 설정)의 후속. 그 버그의 **증상**이 원인보다 무거웠던 점을 따로 다룬다.

## 추가 기능

`components/ErrorBoundary.tsx` — 범용 렌더 경계. 하위 트리의 예외를 잡아 그 자리에 안내 + "다시 시도"(내부 nonce 로 재마운트)를 그리고, `oculpm.log` 에 `[label]` 을 붙여 남긴다. 터미널은 "세션은 백엔드에 살아 있다"는 고유 안내가 필요해 `TerminalErrorBoundary` 를 그대로 뒀다.

## 동작 흐름

경계를 **두 층**에 둔다. 안쪽이 먼저 잡으면 바깥 탭은 멀쩡하다.

- 바깥 — `TabbedWindow` 의 탭 패널마다 (`start-tab` / `project-tab`). 탭 하나가 죽어도 다른 탭과 탭 스트립은 살아 있어, 재시작 없이 그 탭만 닫으면 된다.
- 안쪽 — 설정 패널 두 진입점 모두 (`SettingsOverlay`, `ShellV2` 의 설정 화면, label `settings`). 탭이 8개라 같은 실패의 표면이 넓은 화면이다.

문구는 사전을 거친다 (`crash.title` / `crash.body` / `crash.retry`, ko·en). 클래스 컴포넌트라 훅을 못 써서 모듈 `t()` 를 쓴다 — `TerminalErrorBoundary` 와 같은 판단.

## 왜 이 층위인가

React 는 경계가 없으면 예외를 **루트까지** 올려 트리를 통째로 언마운트한다. 같은 실패가 두 번 났다: 터미널 페인 예외(2026-07-31), 시작 탭 설정의 `useWorkspace()` throw(2026-08-16). 둘 다 원인은 달랐지만 증상은 "앱이 빈 화면 → 재시작밖에 없음"으로 같았다. 원인을 고치는 것과 별개로, 다음 번 미지의 예외에도 창이 살아 있어야 한다.

테스트에서 배운 것 하나 — React 19 는 렌더 중 예외가 나면 같은 트리를 동기로 한 번 더 그려 보고, 그때 성공하면 폴백 없이 조용히 복구한다. 그래서 "첫 렌더만 던지는" 자식으로는 경계를 검증할 수 없다(폴백이 아예 안 뜬다). 던질지 말지는 렌더 밖 플래그가 정하게 했다.

## 검증

- 새 스위트 `error_boundary.test.tsx` 4건: 경계 밖 형제 생존 · 정상 시 무간섭 · "다시 시도" 재마운트 · 로그에 label 기록.
- `pnpm test` 74 파일 883 테스트 통과, `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0.
- 실제 크래시 화면의 실기기 확인은 미실시 (인위적 예외를 앱에 심지 않았다).