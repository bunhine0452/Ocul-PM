---
schema_version: 1
type: feature
slug: "first-record-card-and-ledger"
status: done
difficulty: high
created_at: "2026-09-22T01:16:00+09:00"
session_id: "mcp-20260922-011600"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/first_record.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/conversations.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/collect.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/mod.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/today/FirstRecordCard.tsx"
    op: create
  - path: "src/features/today/firstRecordModel.ts"
    op: create
  - path: "src/features/today/useFirstRecord.ts"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/first_record_model.test.ts"
    op: create
  - path: "src/__tests__/first_record_card.test.tsx"
    op: create
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "docs/product-direction-2026-09-21/PHASE0.md"
    op: create
  - path: "docs/product-direction-2026-09-21/README.md"
    op: update
related:
  - ref: "20260921/Chores/1815_chore_adoption-barrier-audit.md"
    kind: "followup"
  - ref: "20260906/Bugs/1305_bug_first-five-minutes-truth.md"
    kind: "followup"
tags:
  - "onboarding"
  - "today"
  - "product-direction"
  - "first-record-loop"
  - "mcp-tool"
---
[x] 첫 기록 카드 — 대화 단위 첫 일지 귀속 원장 + 첫 5분 문구 교정 (first-record-loop Phase 0·1)

## 배경

`docs/product-direction-2026-09-21` 인수인계(codex)의 실행. 사용자 지시: 가장 어려운 일은 내가, 병렬은 opus, 쉬운 일은 sonnet. 플랜 `first-record-loop` 를 새로 만들어 진척을 옮겼다 (보고서·논의 문서는 제안으로 남긴다).

## Phase 0 — 확정한 것

- **검증 경로 = Claude Code 터미널(앱 Today 빠른 터미널 포함) + oculpm 플러그인.** 대화 id(`agent.session`)로 일지 귀속이 되는 유일하게 관측이 갖춰진 경로다. 이 세션 자체가 그 경로였다 (대화 `11374f00-…`, 마커·`sessions.json.agent_sessions` 에 실림).
- 변경 전 실패 위치 4개(`PHASE0.md`): F-A "첫 기록 성공"을 말하는 화면이 없고 `PluginSetupCard` 가 `total_entries===0` 으로 숨는다(백필·옆 대화로도 오르는 숫자) · F-B 귀속 자료(`agent.session`·037 캐시 칸·마커·sessions.json)가 전부 백엔드에만 있고 대화별로 접는 커맨드가 없다 · F-C 준비 상태가 "설정 존재"까지만이고 "실제 연결"을 말하는 자리가 없다 · F-D 문구 9곳이 조건부를 무조건으로 말한다.
- 관측 범위표: `recall_touch` 는 `AiPanelScreenV2` 가 유일한 호출자 — ACP·외부 MCP 에는 검색·읽기·전달 관측이 없다(보고서 경고 확인). AGENTS.md §0 이 시작 전 `journal_search` 를 지시하지만 그것은 프롬프트 의존이다.

## 해결 방법

**백엔드** — `oculpm::first_record`: 순수 `assemble(LedgerInput)` + IO `collect`(verdict 와 같은 분리). 훅 마커(`verdict::marker_traces` 신설)·`sessions.json`(`workday_sessions` 공개)·캐시 `agent_session`(`cache::conversations::entries_since_workday` 신설)·미기록 신호(`ledger::journal_missing_signals`, 해소 필터 포함)를 **대화별로** 접는다. 대화 id 없는 일지는 `unattributed_recent` 로 따로 세고 어느 대화의 성공으로도 치지 않는다. `hooks_seen` 이 "설정 존재"와 "실제 연결"을 가른다. 커맨드 `first_record_ledger(project_id, days≤30)`.

**프론트** — `FirstRecordCard` 5상태(`firstRecordModel.deriveFirstRecord` 우선순위: 기록 확인 > 실행 중 > 기록 없이 종료 > 귀속 불명 > 준비). 성공 상태의 「일지 열기」는 그 대화의 첫 일지 경로를 넘기고, 문구가 기록 ≠ 검증을 가른다. `useFirstRecord` 는 일지·세션·A2A 이벤트 + 분 틱(마커 파일은 이벤트가 없다). 워크스페이스 `firstRecordArmed`(프로젝트별 영속): 일지 0건을 처음 본 순간 켜고 확인·닫기로 끈다 — 백필로 숫자가 올라도 남고, 이전부터 쓰던 프로젝트는 켜진 적이 없어 보지 않는다. `ShellV2.openEntryInJournal` 을 `Pick<…,"relative_path">` 로 넓혔다. `oculpmApi.onSessionStarted/Ended` 래퍼 추가(lint:bindings).

**P1-4 (opus 병렬 worktree)** — 첫 5분 문구 9키 ko/en 값만 교정: 앱이 아니라 규칙을 읽은 에이전트가 쓴다 · init 은 프로젝트를 열 때 · 훅은 Stop+SessionEnd 둘 · gitignore 는 블록 · `today.terminal.hint` 의 "자동으로 일지에 기록돼요"(검증 경로 한복판의 거짓) 제거. en 신규 키 29개·README 상태 절은 sonnet.

## 검증

- Rust: `first_record` 단위 8건(귀속은 대화 id 로만·창 밖 생존 흔적은 죽음·신호는 후속 일지로 해소·sessions.json 근사 시작·정렬) + `cargo clippy -D warnings`·`fmt` 0.
- 프론트: `first_record_model`(8)·`first_record_card`(9) 신규, 전체 2765건 0 실패. `today_v2` 의 mock 에 `firstRecordLedger`·세션 래퍼를 더했고, 카드의 실행 버튼 문구를 빈 상태 CTA 와 다르게 해 중복 CTA 를 없앴다.
- 게이트: typecheck · test · lint(6) · build 전부 exit 0. 커밋 `bd728b5f`.
- **실제 왕복 증거**: 이 대화에 대해 개발 빌드 `oculpm-mcp verdict` 를 읽기 전용으로 돌림 — 트랜스크립트 없이는 exit 11(옆 대화 2개 생존), `--transcript` 를 주면 exit 10 으로 이 대화의 파일 7개를 양성 귀속(Bash 로 고친 파일은 빠짐 — 알려진 한계).

## 남은 것 / 한계

- 설치본이 실행 중이라 dev 빌드로 카드 화면을 실기기에서 보지 못했다 (`{#p1-verify}` 미완). 이 일지의 `agent.session` 이 `11374f00-…` 로 남는지가 곧 `recorded` 입력의 실증이다.
- `subheadIdle` 이 `oculpmReady=false` 에서도 "없어요"라 말한다(모름≠없음) — opus 보고에서 이월, `{#p1-readiness}` 후속.
- Phase 2(이어하기)·3(소개 정렬)·4(관찰)는 미착수.