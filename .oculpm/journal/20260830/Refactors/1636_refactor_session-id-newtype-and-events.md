---
schema_version: 1
type: refactor
slug: session-id-newtype-and-events
status: done
created_at: 2026-08-30T16:36:00+09:00
session_id: "manual-20260830-163600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/oculpm/session_id.rs
    op: create
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src-tauri/src/oculpm/index.rs
    op: update
  - path: src-tauri/src/oculpm/session.rs
    op: update
  - path: src-tauri/src/oculpm/journal_draft.rs
    op: update
  - path: src-tauri/src/oculpm/manager/agents_sync.rs
    op: update
  - path: src-tauri/src/oculpm/manager/journal.rs
    op: update
  - path: src-tauri/src/oculpm/manager/indexing.rs
    op: update
  - path: src-tauri/src/oculpm/manager/lifecycle.rs
    op: update
  - path: src-tauri/src/oculpm/mcp/tools.rs
    op: update
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/paths.rs
    op: update
  - path: src-tauri/src/oculpm/cache/conv.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/supervisor.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/acp/session.rs
    op: update
  - path: src-tauri/src/acp/process.rs
    op: update
  - path: src-tauri/src/commands/acp.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/git.rs
    op: update
  - path: src-tauri/src/indexer.rs
    op: update
  - path: src-tauri/src/commands/diff.rs
    op: update
  - path: src-tauri/src/oculpm/entry_diffs.rs
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/tray/TrayPopover.tsx
    op: update
  - path: src/features/chat/AcpConversation.tsx
    op: update
  - path: src/features/skills/RulesTab.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/__tests__/workday_rollover.test.tsx
    op: update
related:
  - .oculpm/journal/20260830/Refactors/1609_refactor_query-fanin-vec-partition-git-batch.md
tags: [design, session-id, events, watcher, polish-round]
---

[x] `SessionId` 뉴타입이 네 방언을 한 곳에서 분류·발급 · 워크데이 파생 통일 + `oculpm_current_workday` · `OculpmWorkdayChanged`·`AcpSessionChanged` 로 폴링 3곳 대체 · 죽은 이벤트 제거 · Rules/Retro 데이터 영역 · `oculpm→commands` 역의존 3곳 이동

## 배경

- 세션 id 문자열에 네 방언(워처 `20260820-002` · `manual-…` · `mcp-…` · `20260624-git`)이 살았고, 워크데이를 꺼내는 코드가 네 곳(`index.rs`·`session.rs`·`journal_draft.rs`·`agents_sync.rs`)에 각각 있었으며 실패 모양도 셋이었다. `agents_sync` 는 `split_once('-')` 로 `manual-…` 의 워크데이를 `"manual"` 로 읽어 빈 결과를 냈고, 수동 발급은 시(時)를 안 채워 10시 전엔 한 글자 짧았다.
- 워크데이 넘김은 프런트가 60초마다 status 를 물어 알았다(앱 창·트레이). Claude Code 화면은 4초마다 커맨드 셋(`acpStatus`·`acpOptions`·`acpSessionTitle`)을 폴링했다. `OculpmAgentsTemplateChanged` 는 내기만 하고 듣는 곳이 없었다. `.claude/rules/**` 는 에이전트 내부 상태로 통째로 버려져 규칙 허브가 마운트 때 읽은 것에 머물렀고, `.oculpm/retro/**` 는 코드 변경 파이프라인으로 새어 들어갔다.
- `oculpm/watcher.rs` 와 `oculpm/entry_diffs.rs` 가 `commands::diff` 의 함수를 역참조했다.

## 변경

- **`oculpm/session_id.rs`**: `SessionId(String)`(serde·specta 투명 — 디스크·바인딩 모양 불변) + `SessionKind`. 발급 `watcher/manual/mcp/git_backfill`(전부 0 채움), 판정 `kind/workday/is_watcher/watcher_counter`. 네 파생 사이트가 이걸 부르고, `is_watcher_session_id`·`is_git_backfill_session` 은 얇은 겉면. 경로의 워크데이 조각은 `paths::workday_of_rel` 하나(캐시·MCP 공용). `oculpm_current_workday` 커맨드 추가(리졸버 기준).
- **이벤트**: `OculpmWorkdayChanged{project_id, workday}` — 세션 액터의 경계 처리(활성 세션)와 감독관 분당 틱의 `announce_workday_rollover`(유휴, `manager.current_workdays()`)가 낸다. `AcpSessionChanged{project_id, session_id, kind}` — 어댑터 준비/종료, 제목·설정·사용량 알림, 세션 생성/선택/로드/삭제에서 낸다. 프런트: WorkspaceContext·TrayPopover 의 60초 인터벌과 AcpConversation 의 4초 인터벌 제거(포커스/재표시 확인은 유지). `OculpmAgentsTemplateChanged` 삭제. `OculpmDataArea` 에 `Rules`(`.claude/rules/**`·`.cursor/rules/**` 는 신호 후 반환, 루트 CLAUDE.md 슬롯은 신호만 내고 코드 파이프라인 유지)·`Retro`(`.oculpm/retro/`) — `RulesTab`·`RetroScreenV2` 가 `useOculpmDataEvents` 로 다시 읽는다.
- **역의존**: `render_unified_diff`(+테스트 3) → `git.rs`, `reindex_single_file`·`EMBED_BATCH`·`ReindexSkipReason` → `indexer.rs`(커맨드는 재수출). `oculpm/*` 에서 `crate::commands::` 참조 0.

## 검증

`cargo fmt/clippy -D warnings/test`(945: `session_id` 4개 신규) · `pnpm typecheck/lint/vitest`(1475)/`build` exit 0. `workday_rollover` 테스트를 이벤트 구동으로 다시 씀(같은 날짜 이벤트는 커밋 없음, 미초기화는 조회 없음 유지).

## 한계 / 후속

- `Session.id`·`FileChangeEvent.session_id` 필드는 아직 `String` 이다 — 뉴타입은 경계(분류·발급·파생)에서만 쓴다. 필드까지 바꾸는 것은 비교 연산자 수십 곳을 건드리므로 다음 라운드.
- `home.rs::workday_key`·`firing_ledger.rs::workday_of` 는 리졸버 없이 로컬 날짜를 쓴다(크로스 프로젝트·타임스탬프 기반) — `day_starts_at` 을 무시한다는 점은 그대로.
- 전역 `~/.claude/rules` 는 프로젝트 루트 밖이라 워처가 못 본다 — 규칙 허브의 새로고침 버튼이 여전히 필요하다.
