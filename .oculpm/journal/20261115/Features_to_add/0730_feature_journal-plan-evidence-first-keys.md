---
schema_version: 1
type: feature
slug: "journal-plan-evidence-first-keys"
status: done
difficulty: high
created_at: "2026-11-15T07:30:16+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/commands/today.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/dto.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/__tests__/journalHarness.ts"
    op: create
  - path: "src/__tests__/journal_detail_layout.test.tsx"
    op: create
  - path: "src/__tests__/journal_keyboard.test.tsx"
    op: create
  - path: "src/__tests__/journal_list_v2.test.tsx"
    op: create
  - path: "src/__tests__/journal_manual_entry.test.tsx"
    op: create
  - path: "src/__tests__/journal_planner_copy.test.tsx"
    op: create
  - path: "src/__tests__/journal_planner_frame.test.ts"
    op: create
  - path: "src/__tests__/journal_prose.test.tsx"
    op: create
  - path: "src/__tests__/journal_search_first.test.tsx"
    op: create
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/__tests__/journal_verified.test.tsx"
    op: update
  - path: "src/__tests__/plan_verdict_v2.test.tsx"
    op: create
  - path: "src/__tests__/plannerHarness.ts"
    op: create
  - path: "src/__tests__/planner_focus.test.tsx"
    op: create
  - path: "src/__tests__/planner_keyboard.test.tsx"
    op: create
  - path: "src/__tests__/planner_v4.test.tsx"
    op: update
  - path: "src/__tests__/stale_state.test.tsx"
    op: create
  - path: "src/components/Disclosure.tsx"
    op: create
  - path: "src/components/Markdown.tsx"
    op: update
  - path: "src/components/MarkdownImpl.tsx"
    op: update
  - path: "src/components/disclosure.css"
    op: create
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/oculpm/JournalHead.tsx"
    op: create
  - path: "src/features/oculpm/JournalList.tsx"
    op: update
  - path: "src/features/oculpm/JournalRelated.tsx"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalSearchInput.tsx"
    op: create
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/oculpm/journalMemory.ts"
    op: create
  - path: "src/features/oculpm/journalOrder.ts"
    op: create
  - path: "src/features/oculpm/useJournalSearch.ts"
    op: update
  - path: "src/features/planner/CarryInbox.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/planner/PlanLog.tsx"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/StatusMenu.tsx"
    op: update
  - path: "src/features/planner/planMeta.ts"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/features/planner/verdictState.ts"
    op: create
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/styles/tokens.css"
    op: update
related: []
tags:
  - "일지-·-계획"
  - "일지-화면"
  - "journal"
  - "planner"
  - "quality-round"
  - "mcp-tool"
---
[x] 일지 · 계획: 근거를 먼저 세우고 키보드를 이었다

## 추가 기능

업그레이드 라운드 레인 「일지와 계획」(계획 quality-round-20261115). 두 형제 화면을 같은 뼈대로.

- **검증 상자가 눌리지 않는다(JN-01)**: 본문이 긴 일지에서 검증 상자 · diff 카드가 납작하게 눌려 「읽음」 · 돌린 명령 · 패치가 안 보이던 것. 순서는 머리 → 검증 → 본문 → diff → 관련, diff 는 세로로 자르지 않는다. 이전 · 다음 일지는 꺾쇠 둘 + [ ].
- **본문 조판 한 벌(JN-02)**: prose 클래스를 걷고 `.jd-prose` 한 벌 — 제목 · 굵기 · 인라인 코드(24자 이하는 줄바꿈 안 함) · 읽는 폭.
- **예외만 두 줄 · 검색이 왜 걸렸는지(JN-03)**: 명령 증거가 있는 일지는 36px 한 줄, 예외(검증 없음 · 미완료 · 중단 · 파싱 경고)만 두 줄 + 이유 칩. 날짜 머리 「14 · 검증 없음 1」. 검색은 백엔드 관련도 순 + 걸린 조각.
- **j → v → j(JN-04)**: 그리기 · 이동 · 자동 선택이 `journalOrder.visibleOrder` 하나를 쓴다. 빠진 줄은 같은 자리로.
- **판정 카드 네 상태(JN-05)**: 계획 화면도 오늘과 같은 판정 네 상태(통과 · 실패 · 통과 뒤 바뀜 · 여기선 아직) — 오늘 화면이 호박색으로 짚는 계획을 회색 통과로 그리던 것. 끝 줄을 다 보이고 명령을 낱말 안에서 자르지 않는다. 닫힌 계획은 「통과 뒤 바뀜」 을 묻지 않는다.
- **옛 상태 · 오류 고착 걷기(JN-06)**, **계획 키보드(JN-07)**: j/k 항목 · [ ] 계획 · Enter 상태 메뉴(1~6) · r 다음 실행.
- **같은 뼈대(JN-08)**: 목록 칸 `--panel-w` 284 → 320(변경 화면도 같은 토큰), `Disclosure` 한 벌. **빈 상태 · 낱말(JN-09)**: 계획 0개면 「터미널에서 계획 세우기」(기존 「터미널에서 실행」 길, 새 입력 줄 없음).

## 동작 흐름

Rust `digest.rs` 에 `verdict_now` · `mark_stale` 를 모아 `today_digest` 와 `plan_list` · `plan_get` · 상태 바꾸기 · 닫기/되돌리기 응답이 같은 계산을 쓴다. `PlanSummary` 에 `stale_files` · `verdict_from` 선택 필드. `project.rs`(797줄)는 DTO 를 `dto.rs` 로 떼어 래칫 아래.

## 검증

- 레인 게이트: `cargo test` 1008 passed(레인 시점) · clippy · fmt · vitest 118 files passed · typecheck · lint · build exit 0. 리뷰 둘(blocker 1 · major 2 등) 반영.
- 합류 뒤: `pnpm test` 1652 passed · `cargo test` 1202 passed 0 failed. 일지 키보드 시험의 부하 흔들림(선택이 다음 렌더에 옮김)을 합류 이음에서 기다림으로 고쳤다. 설치본에서 눈으로 보지는 않았다.

## 메모

- 남은 것: 고전 스크롤바가 있는 목록에서 고른 줄 면이 칸 끝 10px 앞에서 멈춘다(CSS 로 못 칠함). 백엔드 검색 조각이 줄바꿈을 눌러 절 제목 경계를 모른다. r 은 수식키 없이 바로 실행한다(명세 그대로).