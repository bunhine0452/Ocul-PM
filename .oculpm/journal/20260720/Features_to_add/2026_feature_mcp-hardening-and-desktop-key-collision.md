---
schema_version: 1
type: feature
slug: "mcp-hardening-and-desktop-key-collision"
status: done
difficulty: medium
created_at: "2026-07-20T20:26:43+09:00"
session_id: "mcp-20260720-202643"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
related: []
tags:
  - "claude-integration"
  - "mcp"
  - "security"
  - "claude-desktop"
  - "PR-CI2"
  - "mcp-tool"
---
[x] MCP 서버 하드닝 2건 + Desktop 동명 폴더 키 충돌 수정

## 추가 기능

보안 점검(잔여 리스크 2건)과 다중 프로젝트 등록 질문에서 나온 실결함 1건을 처리했다.

1. **plan_update redact 심층방어** — `note`·`journal_path` 가 plan-log 표에 원문 그대로 남던 것을 본문과 동일하게 `auto_redact_patterns` 통과 후 기록.
2. **stdin 라인 크기 상한(10 MiB)** — `lines()` 무한 append 를 바이트 단위 `take + read_until` 로 교체. 초과 라인은 개행까지만 버리고(`read_until` 이라 다음 메시지 불침범) id null 의 -32700 응답. `MAX_LINE_BYTES`·`oversized_line_response()` 를 protocol 에 공개.
3. **Desktop 동명 폴더 키 충돌 fix** — `~/work/app` 과 `~/exp/app` 을 둘 다 등록하면 키가 모두 `oculpm-app` 이라 두 번째가 첫 번째를 덮어쓰고, 첫 프로젝트 상태도 거짓 "등록됨"이 되던 결함. 등록 여부 판정을 키 이름이 아닌 **루트 경로 일치**로 변경, 키 선점 시 blake3 경로 해시 6자 접미(`oculpm-app-3f2a1c`)로 구분, 해제도 루트 일치로만 제거해 남의 엔트리 불침범. 재등록은 같은 해시 키를 결정적으로 되찾아 멱등.

## 동작 흐름

여러 프로젝트를 Desktop 에 등록하면 `claude_desktop_config.json` 의 `mcpServers` 에 프로젝트당 1 엔트리가 공존하고, Desktop 은 프로젝트 수만큼 서버 프로세스를 띄운다. 폴더명이 겹쳐도 해시 접미로 안전하게 구분되며, 각 서버의 도구는 자기 `--root` 밖을 읽지도 쓰지도 못한다.

## 검증

cargo test 전체 exit 0 (신규 3 테스트: 동명 폴더 공존·재등록 멱등, note/journal_ref redact, 상한 응답 규격), `cargo build --bin oculpm-mcp` 성공, vitest 198·typecheck·lint·build 그린.