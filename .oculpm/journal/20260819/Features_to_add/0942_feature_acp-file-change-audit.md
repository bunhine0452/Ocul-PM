---
schema_version: 1
type: feature
slug: "acp-file-change-audit"
status: done
difficulty: high
created_at: "2026-08-19T09:42:02+09:00"
session_id: "manual-20260819-094202"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "docs/acp-panel/spike/acp_file_change_audit_spike.py"
    op: create
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags: ["acp", "claude-code", "file-change-audit", "adapter"]
---

[x] ACP 어댑터 0.70.0 — 에이전트가 직접 신고하는 파일 변경 감사

## 추가 기능

어댑터 0.70.0 이 추가한 `agentFileChangeReport` 를 연동했다. 턴이 끝나기 직전
어댑터의 Stop 훅이 **숨은 continuation** 을 넣어 "이번 턴에 바꾼 워크스페이스
파일을 전부 신고하라(명령·제너레이터·버전관리·자식 프로세스가 바꾼 것 포함)"를
시키고, 그 답이 `session_info_update` 로 돌아온다. PreToolUse 훅이 그 구간을
읽기 전용으로 강제해 보고 도구 외에는 아무것도 못 쓴다.

**왜 중요한가.** 이 앱은 지금까지 파일 변경을 watcher·git·편집 도구 호출로
*추론*했다. 이건 에이전트가 적어 내는 **1차 출처**다. 특히 Bash 가 돌린 빌드·
제너레이터가 만든 파일은 편집 도구 호출로는 안 잡히는데, 이 보고에는 들어온다.

## 동작 흐름

1. `initialize` 에서 능력을 광고한다 — `_meta.jetbrains.air.capabilities` 에
   `agentFileChangeReport` 추가(기존 `sessionFailure` 옆). 광고하지 않으면
   어댑터가 감사 자체를 켜지 않는다.
2. `acp_prompt` 가 프롬프트마다 새 requestId 를 싣는다
   (`_meta.jetbrains.air.agentFileChangeReportRequest`, 키는 `version`·`requestId`
   둘뿐, `[A-Za-z0-9._:-]{1,128}`). `/usage` 같은 내부 프롬프트에는 일부러 안
   붙인다 — 파일을 바꿀 일이 없는데 숨은 턴만 한 번 더 도는 비용이다.
3. `file_change_report_of` 가 `session_info_update._meta` 를 파싱해
   `AcpEvent::FileChangeReport` 로 흘린다. 못 받은 경우(`unavailable`)도 이벤트로
   남긴다 — "보고가 없다"와 "보고를 못 받았다"는 다르다.
4. 리듀서가 마지막 에이전트 턴에 붙인다. **닫힌 턴에도 붙인다** — 어댑터가 Stop
   훅에서 만들어 `done` 과 순서가 뒤집힐 수 있다.
5. 화면은 **추론 영수증과 어긋날 때만** 한 줄 더 그린다(`fileChangeDiscrepancy`):
   `extra`(도구 흔적보다 많이 신고) · `partial`(에이전트가 스스로 불완전하다고
   함) · `missing`(보고 못 받음). 일치하면 아무것도 안 그린다 — 같은 수를 두 번
   적으면 정보가 아니라 소음이다.

어댑터 핀도 0.68.0 → 0.70.0 으로 올렸다.

## 검증

- **스파이크 2 재실행**(저장소가 버전 상향 시 요구하는 절차): 0.70.0 에서
  `session/update` 종류 불변 — `available_commands_update`·`usage_update`·
  `agent_message_chunk`.
- **스파이크 3 신규**(`acp_file_change_audit_spike.py`): 임시 디렉터리에서 실제
  어댑터로 계약 3가지를 실측. 관측 페이로드
  `{"version":1,"requestId":"spike-fca-1","status":"reported",
  "paths":["…/spike.txt"],"declaredComplete":true,"truncated":false}` — 실제로
  파일이 만들어졌고 requestId 가 일치했다.
- 패키지 3버전 바이트 비교로 확인: 0.70.0 의 신규는 `file-change-audit` 모듈
  하나뿐이고, **번들되는 Claude Code 는 그대로**다(세 버전 모두
  `claude-agent-sdk@0.3.232`). 즉 이 상향으로 사용자의 Claude Code 는 안 바뀐다.
- Rust 단위 4건(경로·불확실성 보존·unavailable·다른 AIR 확장 오인 방지),
  vitest 5건(닫힌 턴 부착·일치 시 침묵·도구 흔적 밖 파일 검출·불확실성 노출·
  미수신 구분). 전체 1008건.
- typecheck/test/lint/build + cargo test 5대 게이트 exit 0.

## 메모

`jetbrains.air` 는 프로토콜 표준이 아니라 JetBrains 가 먼저 정의한 `_meta` 벤더
확장이다(어댑터가 이름을 그렇게 쓴다). 어댑터가 이름을 바꾸면 따라가야 한다 —
`sessionFailure` 때부터 지고 있던 같은 성격의 의존이다.

후속 후보: 이 목록을 **일지 `files_touched` 자동 초안**과 변경 diff 화면의 교차
검증에 쓰는 것(플랜 #acp5-journal 과 맞물린다). 지금은 대화 화면에만 드러낸다.
