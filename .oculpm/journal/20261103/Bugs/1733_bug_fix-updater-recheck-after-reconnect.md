---
schema_version: 1
type: bug
slug: "fix-updater-recheck-after-reconnect"
status: done
difficulty: low
created_at: "2026-11-03T17:33:01+09:00"
session_id: "20261103-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/__tests__/update_banner.test.tsx"
    op: update
related: []
tags:
  - "업데이트"
  - "updater"
  - "mcp-tool"
---
[x] 업데이트: 다시 연결되면 바로 다시 묻는다

## 발생 원인
업데이트 배너는 기동 1회 · 하루 한 번 · 깨어날 때(마지막 확인에서 6시간이 지났을 때만) 묻는다. 오프라인이라 확인이 **실패**해도 그 시각이 `last` 로 남아, 다시 연결돼도 6시간(창 전환이 없으면 24시간) 동안 새 버전을 몰랐다. 네트워크 복귀를 듣는 곳도 없었다.

## 해결 방법
`UpdateBanner` 가 마지막 확인이 실패했는지(`status.kind === "error"`)를 ref 로 들고,
- `online` 이벤트가 오면 실패 상태일 때만 바로 다시 묻는다.
- 깨어남(포커스·visible)도 실패 상태면 6시간 간격을 건너뛴다.
- Wi-Fi 는 붙었는데 인터넷만 끊긴 경우(공용 와이파이 로그인 화면 등)는 `online` 이 오지 않으므로, 실패한 동안 10분마다 스스로 다시 묻는다(`FAILED_RETRY_MS`). 성공하면 멈춘다.
성공한 확인 뒤의 동작(6시간 · 하루)은 그대로다.

## 검증
- 새 테스트 4개(다시 연결 → 배너, 실패 뒤 포커스 → 재확인, 실패 동안 10분 재시도·성공 뒤 멈춤, 성공 뒤 online → 안 물음) — 수정을 빼면 앞의 둘이 빨개지는 것 확인
- pnpm typecheck / test(1029 passed) / lint / build 모두 0