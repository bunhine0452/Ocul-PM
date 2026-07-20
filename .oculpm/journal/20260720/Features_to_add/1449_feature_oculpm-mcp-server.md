---
schema_version: 1
type: feature
slug: oculpm-mcp-server
status: done
difficulty: high
created_at: "2026-07-20T14:49:18+09:00"
session_id: "manual-20260720-144918"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/mcp/protocol.rs
    op: create
  - path: src-tauri/src/oculpm/mcp/tools.rs
    op: create
  - path: src-tauri/src/oculpm/mcp/register.rs
    op: create
  - path: src-tauri/src/bin/oculpm_mcp.rs
    op: create
  - path: src-tauri/src/commands/mcp.rs
    op: create
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src-tauri/src/oculpm/agents/templates/master_ko.md.tpl
    op: update
  - path: AGENTS.md
    op: update
related:
  - 20260720/Features_to_add/1411_feature_claude-hooks-bridge.md
tags: ["claude-integration", "PR-CI2", "mcp", "template-v5"]
---

[x] PR-CI2 — oculpm-mcp 서버 (journal_write · plan_status · plan_update)

## 추가 기능

Claude Code/Desktop 이 파일 규격을 흉내 내는 대신 **구조화 MCP 도구**로 기록하게 하는
stdio 서버 (마스터플랜 D3). 같은 crate 의 두 번째 바이너리 `oculpm-mcp` 로, frontmatter
직렬화·planner 파서·redact 등 규격 구현을 lib 에서 그대로 재사용한다.

- **D3 수정 결정**: v1 은 rmcp 크레이트 대신 **직접 구현한 최소 JSON-RPC 프로토콜**
  (initialize / tools/list / tools/call / ping). 도구 3개에 필요한 표면이 작고, 외부 SDK
  버전·매크로 변동 리스크 없이 `handle_line` 순수 함수로 전부 단위 테스트된다. 도구
  실행 실패는 스펙대로 `isError: true` (모델이 읽고 재시도), 프로토콜 위반만 RPC 에러.
- **디스크 SSOT — 앱과 IPC 없음**: 도구는 `.oculpm/` 마크다운만 읽고 쓴다. 앱이 꺼져
  있어도 동작하고, 켜져 있으면 기존 watcher 가 인덱싱. `journal_write` 는 forbidden 경로
  거부·redact 적용·slug kebab 강제·체크박스 제목·`mcp-<workday>-HHMMSS` 세션 표기·
  `mcp-tool` 태그까지 manager 의 create 경로와 동일 계약 (manager 헬퍼 3종 pub(crate) 공유).
  `plan_update` 는 잠긴(status≠active) plan 을 거부하고 plan-log 를 규격 append.
- **등록**: `.mcp.json` 머지(우리 키만, 남의 서버·미지 키 보존, 깨진 파일 불변 —
  claude_hooks 와 동일 계약) + 바이너리 자동 탐색(실행 파일 형제 경로 — dev 와 번들 공통).
  설정 Agents 섹션에 "MCP 서버" 블록: 등록/해제, 바이너리 없음 경고(죽은 경로 커밋 방지),
  머신 종속 경로 고지, **Claude Desktop 스니펫 복사**.
- **템플릿 v5**: 마스터 템플릿·이 레포 `_template.md`·AGENTS.md 에 "MCP 도구 우선" 블록 —
  도구가 보이면 파일 직접 작성 대신 도구 사용 (보고서의 '규칙을 파일이 아니라 구조로'
  정신). template_version 4→5, 기존 업그레이드 플로우로 타 프로젝트 전파.

## 동작 흐름

Claude Code: `.mcp.json` → stdio 스폰 → initialize 핸드셰이크 → tools/list → 작업 후
`journal_write`(규격 일지 생성) → `plan_update`(글리프 + plan-log). Claude Desktop: 스니펫
등록 → `plan_status` 로 프로젝트 현황 질의. 서버 stdout 은 프로토콜 전용, 로그는 stderr.

## 검증

- `cargo test` 355 그린 — 신규 11: protocol 3(핸드셰이크 버전 협상·알림 무응답 / 도구
  목록·프로토콜 경유 일지 왕복 / isError·-32601·-32700·ping), tools 5(규격 일지+파서 경고
  0·forbidden 거부·redact·plan_status·plan_update 잠금 거부), register 3(왕복·남의 서버
  보존·깨진 파일 불변). 경고 0.
- `pnpm typecheck` / `test` 143(신규 4: 등록 계약·바이너리 없음 비활성·해제·스니펫
  클립보드) / `lint` / `build` 전부 exit 0.
- **E2E**: 빌드된 바이너리를 스파이크 프로젝트 `.mcp.json` 에 등록하고 실제 Claude Code
  헤드리스 세션(haiku)이 3 도구를 순서대로 호출 — 규격 일지 생성(frontmatter 정상,
  mcp- 세션·mcp-tool 태그), 플랜 `[ ]→[x]`, plan-log `☐→x` 규격 append 전부 확인.
  **앱 미실행 상태에서 동작** (디스크 SSOT 검증).

## 메모

- Desktop 실연결·`.app` 번들(sidecar externalBin) 릴리스 배선은 잔여 — 플래너
  #ci2-runtime-verify / #ci2-sidecar-bundle.
- 바이너리 ~14.5MB (lib 전체 링크) — v1 수용, 필요 시 feature 게이트 슬림화.
