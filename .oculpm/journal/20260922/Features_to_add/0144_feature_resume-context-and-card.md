---
schema_version: 1
type: feature
slug: "resume-context-and-card"
status: done
difficulty: high
created_at: "2026-09-22T01:44:54+09:00"
session_id: "mcp-20260922-014454"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/resume.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/resume_context.rs"
    op: create
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/today/ResumeCard.tsx"
    op: create
  - path: "src/features/today/useResumeDigest.ts"
    op: create
  - path: "src/features/today/FirstRecordCard.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/__tests__/resume_card.test.tsx"
    op: create
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
  - path: "docs/product-direction-2026-09-21/PHASE0.md"
    op: update
related:
  - ref: "20260922/Features_to_add/0116_feature_first-record-card-and-ledger.md"
    kind: "followup"
tags:
  - "onboarding"
  - "today"
  - "plugin"
  - "hooks"
  - "product-direction"
  - "first-record-loop"
  - "mcp-tool"
---
[x] 이어하기 — SessionStart 컨텍스트에 마지막 일지 3건 + 전달 원장, Today 이어하기 카드 (first-record-loop Phase 2)

## 배경

Phase 1 이 "이 대화가 첫 일지를 남겼다"를 확인했다면, Phase 2 는 **그 기록이 다음 세션에서 실제로 다시 열리는가**다 (보고서 §8·§9·§12 P2-1~P2-4). Phase 0 관측 범위표대로, 검증 경로(Claude Code 터미널 + oculpm 플러그인)에서 맥락을 기계적으로 싣는 자리는 SessionStart 훅의 `additionalContext` 하나뿐이었고, 그 자리는 플랜만 싣고 있었다. AGENTS.md §0 의 "시작 전 journal_search" 는 프롬프트 의존이라 관측이 없다.

## 해결 방법

**전달 경로 (P2-3, opus worktree)** — `plugin/oculpm/hooks/plan-context.sh` 가 활성 플랜 미완 항목 뒤에 **마지막 작업 일지 3건**(`YYYYMMDD/Type/file.md` 3단계만, `_`·`.` 제외, 상대경로 바이트 내림차순, `[x]`/`#` 뗀 제목)을 싣고, SessionStart 에만 `.oculpm/hooks/resume-delivered.jsonl` 에 `{ts, session_id, kind:"resume_delivered", journals[], plan_items}` 한 줄을 남긴다. 순수 sh·네트워크·외부 실행 없음·stdin 즉시 소비·기존 상한 문자열 유지(plugin_manifest 게이트). codex 사본은 바이트 동기 게이트가 있어 같은 내용. `/bin/dash` 로도 동일 출력 확인. 내가 Opus 지적을 받아 Codex 용 payload `cwd` 3단 폴백(형제 훅 관용구)을 두 사본에 추가했다. `tests/resume_context.rs` 5건은 실제 `/bin/sh` 로 훅을 돌려 (a) 최신 3건 순서·제외 규칙 (b) 원장 한 줄 파싱 (c) SubagentStart 는 원장 없음 (d) 미추적 루트 침묵 (e) 플랜 없이 일지만 있을 때를 잰다.

**자료 (P2-1, Rust)** — `oculpm::resume`: 같은 선택 규칙으로 디스크에서 `last_journals`·`next_items`(활성 플랜의 미완 리프, 플랜당 8·전체 24 = 훅의 `head -8`·24줄)·전달 원장(대화 단위로 접고 최신 대표, 깨진 줄·다른 kind 무시)을 읽는 `resume_digest` 커맨드. LLM 없음. 복사용 `text` 는 "지시가 아님" 프레이밍으로 시작.

**미리보기·관측 (P2-2·P2-4, 프론트)** — Today `ResumeCard`: 마지막 작업 3건(그 일지 열기)·다음 항목 3건(계획 화면)·전달 줄 세 갈래 — "마지막 전달: 대화 xxxx · N분 전 — 시작 컨텍스트에 포함됐어요 (일지 n건 · 항목 m개). 참조했는지·도움이 됐는지는 알 수 없어요" / "아직 전달된 적 없어요"(훅 관측 있음) / "훅이 아직 닿지 않았어요". 「터미널에서 이어서 작업」은 빠른 터미널(훅이 싣는 그 경로), 「자료 복사」는 토스트로 전달이 아님을 말한다. 일지도 계획도 없으면 안 그린다(여정 C 보호: 기존 화면 구조 불변, 카드 추가만).

**첫 기록 카드 결함** — 실제 CSS 스크린샷 하네스(빌드 CSS + DOM 덤프 + http.server + Chrome, 14장)로 5상태×2테마를 확인하다 인라인 아이콘이 SVG block 표시로 제목 위 줄로 떨어지는 결함을 잡아 두 카드의 아이콘 행을 flex 로 고쳤다.

## 검증

- Rust: `resume` 단위 5 + `resume_context` 5 + `plugin_manifest` 12 + `session_verdict` 5, clippy `-D warnings`·fmt 0.
- 프론트: `resume_card` 7 신규, 전체 2772건 0 실패. typecheck·lint(6)·build 0. 커밋 `449e29ca`.
- **실제 왕복 (이 저장소·이 대화)**: 확장된 훅을 SessionStart payload(대화 `11374f00-…`)로 직접 실행 → `additionalContext` 에 Phase 0·1 일지가 첫 줄로 실렸고 원장에 `resume_delivered` 한 줄이 남았다. 앱 `resume_digest` 가 같은 원장을 읽는다 (PHASE0.md 에 기록).

## 한계 / 남은 것

- 원장이 증명하는 것은 §9 의 "컨텍스트 포함"까지. 참조·도움 여부는 관측 불가이고 화면도 그렇게 말한다.
- 관련 기록(현재 작업 파일·요청 기반 회상)은 시작 시점에 작업을 모르므로 싣지 않는다 — AGENTS.md §0 의 `journal_search` 안내로 남긴다.
- 설치본 실기기 확인(`{#p1-verify}`)은 여전히 앱 재빌드 뒤. 화면 자체는 하네스로 확인.
- 이월: `subheadIdle` 모름≠없음(oculpmReady=false), Phase 3·4 미착수.