---
schema_version: 1
type: bug
slug: "terminal-crash-blank-and-prefill"
status: done
difficulty: high
created_at: "2026-07-31T03:46:13+09:00"
session_id: "mcp-20260731-034613"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalErrorBoundary.tsx"
    op: create
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/dispatchBus.ts"
    op: update
  - path: "src/lib/oculpmLog.ts"
    op: update
  - path: "src/__tests__/console_bridge_format.test.ts"
    op: create
related: []
tags:
  - "terminal"
  - "crash"
  - "error-boundary"
  - "dispatch"
  - "a0d-finding"
  - "mcp-tool"
---
[x] 실기기: 디스패치 후 터미널 무반응·앱 빈 화면 — 경계·관측·프리필 수명 수정

## 발생 원인

A0d 실기기 확인에서 발견: ▶실행 → 빈 터미널 무반응(1), 이후 어느 화면으로 가도 빈 화면(1-1).

로그 포렌식(`oculpm.log.2026-07-30`) 결과 세 겹의 문제:

1. **`TerminalInstanceImpl` 컴포넌트 예외가 경계 없이 전파** → React 가 트리를 통째로 언마운트 = 앱 전체 빈 화면(1-1). 크래시 자체는 어제 터미널 라운드부터 존재(claude 실행 ~3초 후 재현 흔적, 18:11/18:25/18:28 KST 3회).
2. **콘솔 브리지가 React 19 의 에러 포맷(`console.warn("%s\n\n%s", error, stack)`)을 치환하지 않아** 로그에 `%s` 리터럴만 남음 — 실제 예외·스택이 증발해 근본 원인 특정 불가.
3. **프리필 재시도 수명 버그**(1 의 무반응 기여): 소비를 시도 전에 해버리고 재시도 체인이 `[terminalTabs]` deps 에 묶여 있어, 탭 생성/라벨 갱신 등 상태 변경이 체인을 취소하면 프리필이 조용히 증발.

부수 발견: 링크 프로바이더가 `bufferLineNumber - 1 + viewportY` 로 **스크롤 오프셋을 이중 가산** — 스크롤백이 쌓이면 엉뚱한 줄을 스캔 (d7fd19c 회귀).

## 해결 방법

1. **페인 단위 `TerminalErrorBoundary`**: 크래시를 페인 하나로 가두고 폴백 UI("세션은 백엔드에 살아 있음"+다시 열기=nonce 재마운트), `componentDidCatch` 가 실스택+컴포넌트 스택을 oculpm.log 에 기록.
2. **브리지 `%s/%o/%d/%c` 포맷 치환**(`formatConsoleArgs`) — 다음 재현에서 정확한 예외가 로그에 남는다. 회귀 테스트 3.
3. **프리필 재작성**: 마운트 1회 루프 + sid 는 렌더마다 갱신되는 ref 에서 읽기 + **쓰기 성공 후에만 consume**(peek 신설) + 재시도 50×300ms.
4. 링크 프로바이더 이중 오프셋 제거 + 콜백 전체 try/catch 강등(마우스 이동마다 불리는 경로).

## 검증

- typecheck/lint/vitest 339(신규 3)/build 그린.
- **한계 정직 고지**: 크래시의 근본 원인(실제 예외)은 아직 미특정 — 브리지가 삼켰기 때문. 이번 수정으로 ① 재발해도 앱이 빈 화면이 되지 않고(페인 폴백) ② 로그에 실스택이 남아 특정 가능해짐. 실기기 재확인 필요: ▶실행 → 프리필 표시 → Enter → claude 실행 3초+ 관찰 → (폴백이 뜨면) oculpm.log 의 "터미널 페인 크래시" 항목 확인.