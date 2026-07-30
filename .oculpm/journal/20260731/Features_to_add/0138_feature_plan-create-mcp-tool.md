---
schema_version: 1
type: feature
slug: "plan-create-mcp-tool"
status: done
difficulty: medium
created_at: "2026-07-31T01:38:24+09:00"
session_id: "mcp-20260731-013824"
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
  - "planner"
  - "token-diet"
  - "plugin-round"
  - "mcp-tool"
---
[x] plan_create MCP 도구 + instructions 강화 — 플랜 생성 규격의 서버 보장 (TK0)

## 추가 기능

plugin-round TK0. 종전 MCP 는 플랜을 읽고(status) 갱신(update)만 할 수 있어 **새 plan 은 여전히 §7 풀 템플릿을 보고 파일 직작성**해야 했다 — frontmatter 누락(title 경고)·`{#id}` 줄바꿈 파손의 마지막 남은 자기신고 경로이자, 슬림 템플릿(TK1)이 §7 생성 규격을 들어내지 못하는 이유였다.

- **`plan_create`**: plan_id/title/phases[{title,id?,items[{text,id?}]}] 를 받아 §7 규격(frontmatter·phase `{#id}`·`- [ ]` 항목·plan-log 관리 블록)으로 조립. id 는 sanitize 가 아니라 **거부**(에이전트가 재참조할 안정 식별자라 조용한 변형이 더 위험), 미지정 시 텍스트 유도→한글뿐이면 `p<n>-<m>` 위치 폴백, 중복은 `-2` 접미. title/text/description 전부 redact 통과, 줄바꿈 접기, 기존 plan 재생성 거부, 규모 상한(phase 20·항목 120).
- **자기 검증**: 조립 직후 `parse_plan` 을 돌려 경고가 하나라도 있으면 파일을 쓰지 않고 에러 — "규격은 서버가 보장한다"를 코드로 실증.
- **instructions 강화** (protocol.rs): 150→약 380자 — 5 트리거 요약("묻지 말 것" 포함)·도구 4종 사용 순서·시크릿 금지. Claude Desktop 처럼 상시 로드되는 클라이언트에서 규칙 전달력이 올라간다.

## 동작 흐름

에이전트가 새 계획 승인받음 → plan_create 호출 → 서버가 규격 조립+파서 자기검증+원자 쓰기 → watcher 인덱싱 → plan_status/plan_update 로 같은 와이어에서 즉시 참조.

## 검증

- 신규 테스트: 생성물 파서 경고 0 + plan_status 왕복(total 4)·id 4규칙(명시/유도/한글 폴백/auto phase)·YAML 제목 이스케이프·재생성 거부·kebab 거부·비추적 가드 4도구 확장·tools/list 4종 계약 갱신. MCP 스위트 28 그린.
- 실바이너리 E2E: initialize→tools/call plan_create → structuredContent 응답 + 디스크 파일 규격 확인.
- cargo 전체 FAILED 0 · vitest 335 · typecheck/lint/build 그린.

## 메모

TK1(템플릿 v6 압축·§8 분리·wrapper 1줄화·en 변형)은 template_version bump 를 1회로 묶기 위해 다음 단위로 — plan_create 가 생겼으므로 §7 생성 규격을 템플릿에서 들어낼 전제는 충족됨.