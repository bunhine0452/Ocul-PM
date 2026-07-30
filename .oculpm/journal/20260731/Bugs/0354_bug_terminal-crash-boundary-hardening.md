---
schema_version: 1
type: bug
slug: "terminal-crash-boundary-hardening"
status: done
difficulty: medium
created_at: "2026-07-31T03:54:08+09:00"
session_id: "mcp-20260731-035408"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalErrorBoundary.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/lib/oculpmLog.ts"
    op: update
related: []
tags:
  - "terminal"
  - "crash"
  - "error-boundary"
  - "observability"
  - "a0d-finding"
  - "mcp-tool"
---
[x] 터미널 크래시 2차 — 경계를 래퍼 내부로, setTimeout 예외 렌더 승격, 전역 에러 훅

## 발생 원인

1차 수정 후 재현 로그에서 확정한 2가지 구멍:

1. **경계 위치 오류**: `TerminalInstance` 는 터미널 화면 외에 **Today 화면의 TodayTerminal 위젯**에서도 렌더되는데, 1차 경계는 터미널 화면 페인에만 감쌌다 — 무방비 소비처가 남아 "Consider adding an error boundary" 가 그대로 재현.
2. **원리적 미포착 지점**: `term.open` 실패 rethrow 가 **setTimeout 콜백 안** — 에러 경계는 렌더/라이프사이클/이펙트만 잡는다. 어제 커밋 주석이 "테마 색 파싱이 여기서 터진다"고 명시한 바로 그 경로. 또한 React 19 는 미포착 에러의 실체를 console 인자로 넘기지 않아(권고문만 로그) 1차의 포맷 수정으로도 실스택이 안 남았다.

## 해결 방법

1. **경계를 `TerminalInstance` 래퍼 내부로 이동** — 모든 소비처(화면·Today 위젯·미래 소비처)가 자동 보호. "다시 열기"는 경계 내부 nonce 로 하위 트리 재마운트(자가 복구). 화면 쪽 1차 래핑은 중복이라 제거.
2. **setTimeout 예외의 렌더 승격**: `term.open` 실패를 `setFatal(err)` 로 state 에 담아 렌더에서 `throw` — 경계가 확실히 잡는 위치로 이관, 원 예외 보존.
3. **window 전역 훅**(`error`/`unhandledrejection` → oculpm.log): 경계·console 둘 다 못 보는 경로(이벤트 핸들러·promise·타이머)의 실스택까지 파일에 남는다.

## 검증

- typecheck/lint/vitest 339/build 그린.
- 재확인 절차: 앱 실행 → Today 화면(위젯 경로)과 터미널 화면 각각에서 관찰. 크래시가 재발하면 이제 ① 해당 위젯/페인만 "터미널 렌더러 오류" 폴백 + ② oculpm.log 에 `터미널 페인 크래시`(경계 포착) 또는 `uncaught:`(전역 훅) 실스택이 반드시 남는다 — 그 스택으로 근본 수정 진행.

## 메모

근본 예외는 여전히 미특정(관측이 이제야 완비) — 유력 후보는 term.open 의 테마 색 파싱(`readTerminalTheme` 산출 토큰). 재현 로그의 스택 확보 즉시 원인 수정 예정.