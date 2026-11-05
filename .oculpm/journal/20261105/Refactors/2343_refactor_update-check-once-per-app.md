---
schema_version: 1
type: refactor
slug: "update-check-once-per-app"
status: done
difficulty: low
created_at: "2026-11-05T23:43:35+09:00"
session_id: "20261105-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "46e12a9f-7d29-4721-bc44-5366494409bc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/update_gate.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/lib/updater.ts"
    op: update
  - path: "src/api/installKind.ts"
    op: update
  - path: "src/__tests__/update_banner.test.tsx"
    op: update
related: []
tags:
  - "업데이트"
  - "updater"
  - "perf"
  - "mcp-tool"
---
[x] 업데이트: 앱 전체에서 한 번만 묻는다

## 동기
`UpdateBanner` 는 창마다 있다. 창이 열릴 때 · 깨어날 때 · 실패 중 10분마다 각 창이 따로 GitHub 에 물었다. 11-05 앱 로그를 보면 확인이 26번이었고, 창을 여럿 연 14:19~14:20 에 `update endpoint did not respond` 가 12번 몰렸다. 엔드포인트는 지금 200 이다.

## 변경 요약
- Rust 관문 `update_check_claim(urgent)` / `update_check_report(outcome)` 를 추가했다. 판정 `decide` 는 순수 함수다.
  - 다른 창이 묻는 중이면 30초 동안 거절한다.
  - 「없음」은 6시간 믿는다.
  - 「실패」는 5분 뒤에 다시 묻고, `online` 이면 바로 묻는다.
  - 「새 판 있음」은 창마다 자기 Update 를 받게 허락한다.
- 배너의 자동 확인은 창마다의 규칙을 지난 뒤 관문에 한 번 더 묻는다. 결과는 `useUpdater.check` 가 알린다(설정의 수동 확인 포함).
- 실패 재시도를 timeout 에서 interval 로 바꿨다. 관문이 거절하면 상태가 그대로라 timeout 은 다시 걸리지 않는다.
- 커맨드가 없으면(웹뷰 밖) 예전처럼 묻는다.

## 검증
- pnpm test 1076 passed (관문 거절 · 결과 알림 2건 추가), Rust `update_gate` 단위 4건 포함 cargo test 1113 passed