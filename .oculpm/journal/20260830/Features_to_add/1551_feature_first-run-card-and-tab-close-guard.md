---
schema_version: 1
type: feature
slug: first-run-card-and-tab-close-guard
status: done
created_at: 2026-08-30T15:51:00+09:00
session_id: "manual-20260830-155100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/manager/lifecycle.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/commands/greenfield.rs
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/windows/useTabRunningWork.ts
    op: create
  - path: src/lib/closeIntent.ts
    op: update
  - path: src/lib/projectActions.ts
    op: create
  - path: src/features/chat/acpBusyBus.ts
    op: update
  - path: src/features/today/FirstRunCard.tsx
    op: create
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1526_feature_error-card-confirm-settings-deeplink.md
tags: [journey, onboarding, close-guard, polish-round]
---

[x] 첫 활성화 카드 — init 이 저장소에 무엇을 썼는지 말하고 커밋을 권한다 · 「지금 활성화」 재시도 · 탭 닫기 전 실행 중 작업 확인

## 배경 / 요구

- `oculpm_init` 은 `.oculpm/`·`AGENTS.md` 블록·`.gitignore` 한 줄을 **저장소에 쓰면서** 아무 말이 없었다. 보고서(`OculpmInitReport`)는 `ProjectTab.tsx:100` 에서 버려졌고, 그린필드 마법사 문구는 존재하지 않는 "EmptyToday 활성화 카드" 를 약속하고 있었다. init 이 실패하면 Today 는 "아직 활성화되지 않았어요" 를 이유도 재시도도 없이 보여 줬다.
- ⌘W 로 마지막 탭을 닫으면 앱이 꺼지며 PTY·ACP 가 전부 죽는다 — 돌고 있는 dev 서버나 턴 중인 에이전트가 있어도 묻지 않았다.

## 설계 / 구현

- **보고서에 파일이 담긴다**: `OculpmInitReport.agent_files` — `sync_agents` 결과 중 inserted/updated 인 어댑터의 `adapter_path`. 재오픈의 빈 보고(세션 fast path)와 구분되도록 프런트는 `wrote_config`(config.toml 을 새로 씀) 일 때만 카드를 채운다 → 이미 쓰던 프로젝트는 이 빌드로 올라와도 카드를 보지 않는다.
- **카드는 영속**: `WorkspaceState.oculpmInitCard`(추가 필드, 스키마 bump 없음). Today 의 `FirstRunCard` 가 쓴 것을 그대로 나열(.oculpm/ · AGENTS.md — 기록 규칙 블록 · .gitignore 한 줄)하고 「변경 보기」(diff)·「알겠어요」. 그린필드 경로의 죽은 "EmptyToday" 문구·Rust 주석 정정.
- **「지금 활성화」**: `lib/projectActions.ts` 요청 버스(`requestOculpmActivate`/`requestReindex`/`requestCheatsheet` — 창 CustomEvent, 활성 탭만 받음). `ProjectTab` 은 `initNonce` 로 init 이펙트를 다시 돌리고, 실패는 이제 토스트(+재시도)로, 성공은 "켜졌어요" 로 말한다.
- **탭 닫기 문지기**: 사슬(`closeIntent`)이 "무엇을 닫을지" 라면 새 `registerTabCloseGuard(tabId, () => Promise<TabRunningWork>)` 는 "닫아도 되는지" 다. 프로젝트 탭(`useTabRunningWork`)이 **알리기만** 하고 — `pty_foreground_command` 가 이름을 돌려주는 페인(프롬프트만 뜬 셸은 제외) + `countAcpWorkingFor(projectId)` — 다이얼로그는 창(`TabbedWindow.closeTabGuarded`)이 `useConfirm` 으로 띄운다. 숨은 탭 안에 그린 다이얼로그는 보이지 않으므로 탭 스트립 × 로 배경 탭을 닫을 때도 창 층에서 묻는다. ⌘W(close-intent)와 × 둘 다 같은 길.

## 검증

`pnpm typecheck` · `lint` · `vitest`(123 파일 · 1465 — `polish_phase2` 스위트: 문지기 등록/해제/예외, ACP 프로젝트별 카운트, 요청 버스, 첫 활성화 카드 줄·버튼) · `build` · `cargo fmt/clippy -D warnings/test`(933) exit 0. 실기기: 새 저장소를 열어 카드 → 커밋 → 터미널에서 `pnpm dev` 띄우고 ⌘W — 앱 꺼진 뒤 몰아서.

## 한계 / 후속

- `⇧⌘W`(창 닫기)·빨간 버튼·트레이 종료는 Rust `CloseRequested`(`commands/window.rs`, 병렬 세션 영역) 를 지나 묻지 않는다 — window.rs 가 안정되면 `api.prevent_close()` + 프런트 왕복으로 같은 문지기를 태운다.
- ACP 작업 중 집계는 웹뷰 단위라 **다른 창**의 세션은 못 본다 (acpBusyBus 설계 그대로).
