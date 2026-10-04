---
schema_version: 1
type: refactor
slug: "remove-a2a-sessions"
status: done
difficulty: high
created_at: "2026-10-04T21:11:33+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: delete
  - path: "src-tauri/src/commands/a2a.rs"
    op: delete
  - path: "src-tauri/src/oculpm/mcp/a2a_tools.rs"
    op: delete
  - path: "src-tauri/src/oculpm/watcher/classify.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src/features/sessions/SessionsScreenV2.tsx"
    op: delete
  - path: "src/features/today/TodayActivity.tsx"
    op: delete
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "AGENTS.md"
    op: update
related: []
tags:
  - "a2a"
  - "refactor"
  - "dead-code"
  - "mcp"
  - "mcp-tool"
---
[x] 세션(A2A 에이전트 협업) 기능 전체 제거 — 화면·HTTP 문·MCP 도구 7개·원장 백엔드

## 동기
사용자 결정(2026-10-04): 「세션」 화면과 그 밑의 A2A 서브시스템 전체를 지운다. 범위를 물었고 "A2A 전체 삭제"를 골랐다.

## 변경 요약
- 백엔드: `oculpm/a2a/`(registry·mailbox·tasks·leases·groups·http) · `commands/a2a.rs` 커맨드 9개 · 이벤트 2개 · `A2aServerState` · `OculpmError::A2aRejected` 삭제. axum 은 모바일 브리지가 쓰므로 유지.
- MCP: `agent_register`·`agent_list`·`agent_inbox`·`agent_send`·`task_create`·`task_update`·`claim_paths` 삭제 (tools/list 14 → 7). CLI usage 도.
- ACP: 참여자 카드 게시·침범 경고 제거. 세션 심(신원 토큰)은 유지.
- 워처: 옛 원장 자리(`agents/live·inbox·tasks·leases·groups·audit`)는 **noise 로 남겼다** — 업데이트 전 플러그인 MCP 서버가 아직 하트비트를 쓸 수 있고, 그게 캐스케이드를 타면 줄마다 AGENTS.md 전체 재동기화가 돈다.
- AGENTS 템플릿 v14: §5(A2A) 삭제, §6→§5 (discussion-spec 의 "§5" 포인터와 다시 맞는다). 이 저장소의 AGENTS.md·`_template.md` 도.
- 프런트: 세션 화면·Today 활동 카드·설정 A2A 엔드포인트·사이드바 배지·활동 어휘 `oculpm-a2a`(15→14낱말)·i18n 90키×2·CSS·ActivityLine. 저장된 `uiV2View="sessions"` 는 `migrateUiV2View` 가 today 로, `sessionAliases` 는 일방향 삭제.
- 문서: landing ko/en 기능 목록·FAQ·벤토 6칸·plugin 페이지 도구 표, 위키 화면 표, README. 버전 이력 줄은 역사라 유지. 위키 빌드가 손으로 넣은 `/report-card` 를 sitemap 에서 지우던 것도 생성기에 등록해 고쳤다.
- 섞여 있던 plan CAS·agent_id 기본값 테스트는 guards/journal 로 옮겼다.

## 검증
cargo test 1,964 통과 · clippy -D warnings · vitest 3,262 · lint 7종 · build 초록. 브랜치 `refactor/remove-a2a-polish` (워크트리 `../ai-pm-polish`) 커밋 ea24e287.