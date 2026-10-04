---
schema_version: 1
type: bug
slug: "log-double-write-console-bridge"
status: done
difficulty: low
created_at: "2026-10-04T21:12:24+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/oculpmLog.ts"
    op: update
  - path: "src/__tests__/console_bridge_once.test.ts"
    op: create
related:
  - ref: "20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md"
    kind: "followup"
tags:
  - "logging"
  - "frontend"
  - "mcp-tool"
---
[x] 앱의 경고·오류가 oculpm.log 에 두 줄씩 적히던 것 — 콘솔 브리지 재전송

## 발생 원인
설치본 로그에 `check -> error` (source=updater) 와 `[oculpm][updater] check -> error` (source=console) 가 6ms 차이로 한 쌍씩. `oculpmLog.warn/error` 가 파일로 한 번 보내고 DevTools 거울로 `console.warn` 을 부르는데, `installConsoleBridge` 가 패치한 console 이 그것을 다시 파일로 실었다. 앱이 남기는 모든 경고·오류가 두 배였다.

## 해결 방법
거울(`mirror`)이 브리지가 깔리기 **전의** console 원본을 부른다 — 설치 시 원본으로 갈아 끼운다. 서드파티의 `console.warn` 은 그대로 브리지가 받는다.

## 검증
`console_bridge_once.test.ts` — 수정 전 4줄(붉음) → 수정 후 2줄, 서드파티 경로 1줄 유지.