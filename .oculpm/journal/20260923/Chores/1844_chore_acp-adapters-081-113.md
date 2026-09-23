---
schema_version: 1
type: chore
slug: "acp-adapters-081-113"
status: done
difficulty: medium
created_at: "2026-09-23T18:44:35+09:00"
session_id: "20260923-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1742564d-a2b0-4d8d-98e3-67be9ae7ec98"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/conversation/TurnRow.tsx"
    op: update
  - path: "src/features/chat/conversation/PermissionCard.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/__tests__/acp_permission_card.test.tsx"
    op: update
  - path: "src/__tests__/acp_identity_row.test.tsx"
    op: update
  - path: "src/__tests__/i18n_english_screens.test.tsx"
    op: update
  - path: "src/__tests__/shell_acp_view_no_today_fallback.test.tsx"
    op: update
  - path: "docs/acp-panel/spike/acp_file_change_audit_spike.py"
    op: update
related: []
tags:
  - "acp"
  - "adapter"
  - "codex"
  - "mcp-tool"
---
[x] ACP 어댑터 claude-agent-acp 0.81.0 · codex-acp 1.13.0 로 올리고 바뀐 계약 셋에 맞춤

## 동기
ACP 어댑터 새 버전(claude-agent-acp 0.77.0→0.81.0, codex-acp 1.8.0→1.13.0)에 맞춰 우리가 바꿔야 할 것이 있는지 옛/새 tarball `dist/` 를 대조했다. 크레이트 `agent-client-protocol` 2.0.0→2.2.0 도 봤지만 필수 변경이 없어 이번엔 올리지 않았다.

## 변경 요약
- **대조 결과 안전한 것**: 두 어댑터의 새 `session/update`(`notice`·`compaction_update`·`compaction_summary_chunk`·`async_task_*`)는 모두 우리가 광고하지 않는 capability(`session.notices`/`.compaction`, AIR `asyncTasks`) 뒤라 오지 않는다. 크레이트는 모르는 태그를 역직렬화하지 못하므로 이게 올릴 수 있는 전제. `usage-markdown`·`session-failure-extension`·`auth-status` 는 바이트 동일, 번들 바이너리 경로도 불변.
- **파일 변경 감사**: 두 어댑터 모두 숨은 모델 호출 감사를 버리고 도구 기준(Claude = SDK 체크포인트 `rewindFiles` dry-run, Codex = 턴 diff 파싱)으로 바뀌어 `complete` 가 늘 false, Codex 는 고정 영어 `uncertainty` 까지 싣는다. 그대로면 모든 턴에 "전부가 아닐 수 있어요" 줄이 붙는다 → `fileChangeDiscrepancy` 가 `complete`·`uncertainty` 를 보지 않고 `truncated` 만 보도록(`partial`→`truncated`), i18n `acp.audit.*` 문구·백엔드 주석 갱신.
- **셸 승인 제목**: 0.81.0 은 Bash 승인 제목을 설명 한 줄 대신 명령 원문으로 보낸다. IN 블록과 같은 글이면 `PermissionCard` 가 "명령" 이름표로 바꾼다(IN 이 잘려 온 경우 앞부분으로 비교).
- **Codex 신원 push**: codex-acp 1.13.0 도 `_auth/status_update` 를 보내 `auth_status.rs` 가 그대로 받는다. 로그아웃 안내만 `codex login` 으로 갈랐다(`acp.identity.loggedOutHintCodex`).
- `adapter.rs` 고정 버전 두 상수 + 대조 주석, 테스트 고정값 `"0.77.0"`→`"0.81.0"`.
- 스파이크 3(`acp_file_change_audit_spike.py`)을 버전 인자 + 무편집 둘째 턴으로 고쳐 재실행.

## 검증
- 스파이크(0.81.0 실측): 편집 턴 `reported [spike.txt]`, 대화만 한 턴 `reported []`(unavailable 아님), `declaredComplete:false`, 새 update 종류 0.
- typecheck·lint·test(2851)·build exit 0, `cargo fmt --check` + `cargo test --lib acp::` 91개 통과. 파일 크기 래칫은 session.rs·process.rs 줄 수를 줄여 통과.
- 미확인: 설치본에서 어댑터 재설치 후 실제 대화 육안(감사 줄 없음·셸 승인 카드 "명령"·Codex 신원 줄), `acp_handshake`(ignored) 미실행.