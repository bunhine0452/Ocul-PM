---
schema_version: 1
type: bug
slug: "toast-undo-window-and-live-region"
status: done
difficulty: low
created_at: "2026-09-09T20:16:31+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "toast"
  - "a11y"
  - "undo"
  - "design"
  - "mcp-tool"
---
[x] 되돌리기가 5초 만에 사라지고, 라이브 리전이 내용과 함께 삽입되던 것

## 발생 원인

### 1. 파일 이동 되돌리기가 5초

`useFileOps.ts:161` 이 `durationMs` 를 안 줘서 `toast.ts` 의 info 기본값 **5,000ms** 에 걸렸다. 그런데 그 토스트가 되돌리기의 **유일한** 경로였다 — `undoMoves` 호출부는 코드베이스 전체에서 그 한 줄뿐이고, 메뉴도 ⌘Z 도 없다. 파일 트리에서 드래그로 잘못 옮긴 걸 알아채는 데 5초는 짧다.

거기에 타이머가 `push()` 안의 `setTimeout` 하나라서 **멈출 방법이 없었다**. 읽으려고 마우스를 올려도 시계가 계속 가고, 버튼을 누르러 가는 도중에 사라진다.

대조군은 같은 저장소에서 제대로 하고 있었다 — `useDiscussionSave.ts:70` `durationMs: 0`, `AppearanceTab.tsx:150` `15000`. 즉 규약이 없어서 **잊으면 손해가 나는** 구조였다.

### 2. 라이브 리전이 내용과 동시에 삽입됨

`Toaster.tsx:20` 이 `if (toasts.length === 0) return null` 이었고 `role` 은 개별 토스트에 붙어 있었다. 그러면 리전이 내용과 **함께** DOM 에 들어가는데, 스크린리더가 자주 놓치는 고전적 패턴이다 — 특히 `role="status"`(polite). `vitest-axe` 는 이걸 못 잡는다(정적 스냅샷을 보므로 삽입 타이밍은 검사 대상이 아니다).

## 해결 방법

**호출부를 고치는 대신 바닥을 올렸다.** 잊어도 손해가 안 나야 한다.

- `ACTION_MIN_MS = 15_000` — 액션이 달린 토스트는 기본값도, 짧게 준 값도 15초까지 올린다. `durationMs: 0`(고정)은 "사용자가 닫을 때까지" 라는 뜻이므로 그대로 존중한다.
- 타이머를 `Map<id, {remaining, startedAt, handle}>` 로 바꿔 **멈췄다 이어 갈 수 있게** 했다. `pauseToast`/`resumeToast` 를 호버·포커스(`onFocusCapture`/`onBlurCapture`)에 물렸다.
- 라이브 리전 **둘 다 항상 마운트**한다. 다급함이 다르므로 갈랐다 — 경고·오류는 `assertive` 로 끼어들고 info 는 `polite` 로 기다린다. 시각적으로도 경고가 위에 선다. 개별 토스트의 `role` 은 제거(이제 컨테이너가 리전이다).

## 검증

`toast_timing.test.tsx` 8개 신규 — 액션 있을 때 기본값 15초 · 액션 없으면 5초 그대로 · 짧게 준 값은 올림 · 0 은 존중 · 길게 준 값은 무접촉 · 호버 중 60초가 지나도 안 닫히고 떼면 **남은 5초**부터 이어감 · 토스트 0개일 때도 두 리전이 DOM 에 있음 · info/경고가 각자 리전에 들어감.

`pnpm typecheck` · `pnpm lint`(6게이트 전부) · `pnpm test`(194 파일 2,522개) · `pnpm build` 각 exit 0.