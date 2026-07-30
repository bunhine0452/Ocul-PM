---
schema_version: 1
type: feature
slug: "mcp-untracked-project-guard"
status: done
difficulty: low
created_at: "2026-07-31T00:36:02+09:00"
session_id: "mcp-20260731-003602"
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
related: []
tags:
  - "mcp"
  - "security"
  - "plugin-round"
  - "mcp-tool"
---
[x] MCP 도구 비추적 프로젝트 가드 — 무가드 .oculpm 생성 제거 + 심볼릭 링크 거부 (A0b)

## 추가 기능

plugin-round A0b. 종전에는 `journal_write` 가 `.oculpm` 이 없는 디렉터리에서도 `create_dir_all` 로 조용히 `.oculpm/journal/…` 을 만들었다 — user 스코프 플러그인 공개 배포에서는 이 서버가 **모든** 프로젝트에 노출되므로 사용자 동의 없는 디렉터리 생성 사고 경로였다 (전략 문서의 "치명 발견"). `call_tool` 진입점에서 일괄 가드:

- `root/.oculpm` 이 **실디렉터리**일 때만 도구 3종(및 미래 도구) 동작. 없으면 "앱에서 프로젝트를 추가하라"는 명시적 에러 — 어떤 파일/디렉터리도 생성하지 않음.
- `symlink_metadata` 로 판정해 **심볼릭 링크 `.oculpm` 은 거부** — 악의적 저장소가 `.oculpm → 외부경로` 링크를 심어두면 가드 통과 후 쓰기가 프로젝트 밖으로 탈출하는 우회를 차단 (적대 리뷰 HIGH 반영).

## 동작 흐름

tools/call → `call_tool` 가드(디렉터리 실존+비링크) → 통과 시에만 기존 도구 로직. 실패는 MCP `isError:true` 로 전달되어 에이전트가 이유를 읽는다.

## 검증

- 신규 테스트 2: 3도구 모두 비추적 루트에서 명시 에러+무부작용(`.oculpm` 미생성), 심볼릭 링크 루트에서 거부+링크 대상 빈 디렉터리 유지(unix).
- 기존 테스트 4곳(tools 2·protocol 2)이 무가드 동작을 전제하고 있어 `.oculpm` 생성으로 계약 갱신. cargo test 전체 464 그린.