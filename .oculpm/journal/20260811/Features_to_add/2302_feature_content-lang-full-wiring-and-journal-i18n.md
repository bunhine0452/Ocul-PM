---
schema_version: 1
type: feature
slug: "content-lang-full-wiring-and-journal-i18n"
status: done
difficulty: medium
created_at: "2026-08-11T23:02:13+09:00"
session_id: "mcp-20260811-230213"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/commands/overview.rs"
    op: update
  - path: "src-tauri/src/commands/greenfield.rs"
    op: update
  - path: "src-tauri/src/commands/rule_promotion.rs"
    op: update
  - path: "src-tauri/src/commands/skill_promotion.rs"
    op: update
  - path: "src-tauri/src/oculpm/reconcile.rs"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalCardV2.tsx"
    op: update
  - path: "src/features/oculpm/triggerMeta.tsx"
    op: update
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "llm"
  - "프롬프트"
  - "phase2"
  - "mcp-tool"
---
[x] LLM 프롬프트 9곳 산출물 언어 배선 완료 + 작업 일지 화면 영어화

## 추가 기능

두 갈래를 함께 진행했다.

**① LLM 프롬프트 배선 완료 (3 → 9곳).** `content_lang` 이 이제 시스템 프롬프트를 쓰는 **모든** 경로를 덮는다: journal_draft · retro · plan(planner AI) · summary · overview · greenfield · rule_promotion · skill_promotion · reconcile.

**② 작업 일지 화면 영어화.** JournalScreenV2(34건) · JournalCardV2 · triggerMeta · useJournalDays. allowlist 103 → 99.

## 프롬프트 배선에서 갈린 두 패턴

호출부가 `Db` 를 갖고 있느냐가 갈랐다.

- **직접 접근 4곳** (greenfield · rule_promotion · skill_promotion · reconcile) — 커맨드 핸들러가 `State<'_, Db>` 를 이미 받아 그 자리에서 `content_lang::current(&db).await` 를 부른다.
- **인자로 전달 3곳** (summary · overview · retro) — `call_llm` 이라는 순수 헬퍼로 분리돼 있어 `Db` 가 없다. 헬퍼에 `Db` 를 끌고 들어가면 LLM 호출 함수가 DB 를 알게 되는 역방향 의존이 생기므로, 해석된 `ContentLang` **값**만 인자로 넘겼다.
- **AppHandle 경유 1곳** (journal_draft) — `draft_for_session` 이 `tauri::AppHandle` 만 받아서 `app.state::<Db>()` 로 꺼낸다.

## 영어화에서 반복된 패턴

`label: string` 이 표시 문자열을 직접 들고 있던 상수 테이블이 또 나왔다 — `CHIPS`(일지 필터 6종) · `TriggerMeta`(작업 유형 5종). 설정 탭·액센트 때와 같은 처리로 `labelKey: I18nKey` 로 바꾸고 소비처가 `t()` 로 그린다. 이 코드베이스의 상수 테이블은 대체로 이 모양이라 남은 화면에서도 같은 변환이 반복될 것 같다.

날짜 라벨(`오늘 · 2026-08-11`)은 순수 모듈이라 훅 없이 모듈 `t()` 를 직접 썼다 — Phase 0 에서 언어를 컨텍스트가 아니라 모듈 스토어에 둔 이유가 이런 곳이다.

## 검증

게이트 5종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build / cargo test(실패 0).

## 남은 일

**99파일.** 이번에 diff·일지 상세·수동 일지 모달의 사전 키(121개)를 미리 넣어 뒀지만 **본문 치환은 아직 안 했다** — DiffScreenV2(38) · EntryDetailView(21) · ManualEntryModalV2(19) 가 다음 차례다. 그 외 OculpmSettings 146 · skillsGallery 112 · PlannerScreenV2 99 · SkillsScreenV2 89 · RetroScreenV2 72 · TrayPopover 70 등.

Rust 사용자 노출 에러 ~130곳도 미착수 (프롬프트만 끝났다).