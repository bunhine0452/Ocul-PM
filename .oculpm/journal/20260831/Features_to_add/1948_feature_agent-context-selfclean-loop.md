---
schema_version: 1
type: feature
slug: agent-context-selfclean-loop
status: done
created_at: 2026-08-31T19:48:00+09:00
session_id: "manual-20260831-194800"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/oculpm/rule_scope.rs
    op: create
  - path: src-tauri/src/oculpm/skill_trigger.rs
    op: create
  - path: src/features/skills/ContextProposals.tsx
    op: create
  - path: src/__tests__/agent_context_proposals.test.tsx
    op: create
  - path: src-tauri/src/oculpm/rules.rs
    op: update
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src-tauri/src/commands/rules.rs
    op: update
  - path: src-tauri/src/commands/skills.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/api/claudeSurface.ts
    op: update
  - path: src/features/skills/contextModel.ts
    op: update
  - path: src/features/skills/ContextBudgetBar.tsx
    op: update
  - path: src/features/skills/ContextInbox.tsx
    op: update
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/features/skills/skills.css
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
  - path: src/__tests__/agent_context_model.test.ts
    op: update
related:
  - 20260831/Features_to_add/1846_feature_agent-context-three-zones.md
  - 20260829/Features_to_add/1812_feature_firing-ledger-and-badges.md
tags:
  - agent-discipline
  - rules
  - skills
---

[x] 스킬·규칙 재설계 Phase 3 — 규칙 다이어트와 제안 3종으로 자기정리 루프를 닫았다

## 추가 기능

**AD-6 규칙 다이어트.** 실측(2026-08-29)의 가장 큰 손해는 세션당 ~22K 토큰이 이 스택과 무관한 규칙에 쓰인다는 것이었는데, 그걸 보여 주는 화면이 없었다(F6). 이제 두 신호로 결정적으로 지목한다 — LLM 0 · 네트워크 0.

- **glob 감사** (`rule_scope.rs`) — 조건부 규칙의 각 glob 을 gitignore 를 존중한 파일 목록에 맞춰 보고 매칭 0개를 `dead` 로 부른다. 해석 못 한 glob 은 **절대 dead 로 부르지 않는다** (모르는 걸 무관하다고 말하면 사용자 파일을 잘못된 근거로 고치게 된다).
- **스택 불일치** (`contextModel.stackFamilyOf`) — 규칙 경로가 드러내는 스택 가족(`rules/ecc/arkts/…`)이 `detect_stack` 이 감지한 스택에 없으면 무관이다. 실측의 arkts·react-native·vue 3세트를 잡는 건 이쪽이다: 그 규칙들의 glob(`**` 로 시작하는 모든 TS)은 **살아 있어서** glob 감사만으로는 안 잡힌다.

**AD-5 제안 3종** (존 3):

| 카드 | 판정 | 처방 |
|---|---|---|
| 범위 교정 | 안 쓰는 스택 + 실제 주입 관측 | 그 스택의 표준 확장자로 `paths` 축소 |
| 정리 | 매칭 0개(계측 무관) · 30일 발동 0회 | 규칙 삭제 (확인 모달) |
| 트리거 교정 | 활성 스킬 30일 0회 | `description` 재작성 초안(과금) · 비활성화 |

**예산 바가 처방으로 이어진다.** 존 1 의 조건부 조각에서 무관 몫을 떼어 빨간 조각으로 그리고(합은 두 번 세지 않는다), 그 조각을 누르면 존 3 의 범위 교정 카드로 스크롤한다.

## 동작 흐름

1. 화면이 열리면 `rules_scope_audit`(파일 걷기라 `spawn_blocking`)와 `detect_stack` 이 배경에서 돈다. 둘 다 **보조 신호**라 실패하면 제안이 안 뜰 뿐 화면은 그대로 동작한다.
2. 제안은 전부 결정적 판정이라 승격 후보보다 위에 선다. "무시" 는 세션-로컬 숨김 — 파일에 아무것도 쓰지 않는다.
3. **범위 좁히기**만 파일 소유권 문제가 있다. 고치는 대상이 대개 `~/.claude/rules/**` — 우리 마커가 없는 사용자 파일이다. 그래서 쓰기 경로가 하나뿐이다: 프런트가 `setRulePaths` 로 `paths` **행만** 갈아 끼운 내용을 만들고, 백엔드 `rules_save_with_backup` 이 원본을 `<파일>.bak` 으로 남긴 뒤 원자적으로 쓴다. 토스트가 백업 경로를 그대로 보여 준다.
4. 트리거 교정은 초안만 만든다(`skills_trigger_rewrite`). 승인하면 프런트가 기존 `skills_save(create=false)` 로 저장한다 — description 행만 바뀌고 본문은 바이트 그대로다.

## 검증

- 게이트 전부 직접 확인: `pnpm typecheck` · `pnpm test`(129 파일 1551건) · `pnpm lint` · `pnpm build` · `cargo test`(937 + 통합) · `cargo fmt --check` · `cargo clippy --all-targets -D warnings` 모두 exit 0.
- Rust 신규 10건 — glob 매칭(`.ets` 0개 판정), 해석 불가 glob 은 dead 아님, gitignore·벤더 제외, 전역 규칙 fully-dead 감사 / description 행 치환·삽입·블록 스칼라 거부·따옴표 이스케이프·펜스 낀 JSON 파싱·본문 발췌 상한.
- 프런트 신규 12건 — 스택 가족 판독, 감지 스택에 있으면 제안 안 함, 계측 후 0회면 비용 0이라 제안 안 함, 정리 두 근거, 무관 조각이 조건부에서 떼어지고 합이 안 늘어남.
- 화면 계약 2건 — 범위 좁히기가 **백업 경로로만** 나가고(`rules_save` 는 0회 호출) `paths` 행만 바뀌는지, 트리거 초안이 승인 전에는 아무것도 저장하지 않는지.

## 메모

- react-native·angular 처럼 확장자로 스택을 가릴 수 없는 규칙은 **좁히기를 제안하지 않고** 비용만 보여 준다. 틀린 glob 을 제안하는 것보다 낫다 — 실측 3세트 중 arkts·vue 는 자동 축소가 되고 react-native 는 보이기만 한다.
- 백업은 직전 원본 한 벌이다(같은 파일을 두 번 좁히면 갱신). 여러 세대를 남기면 사용자의 규칙 폴더가 우리 쓰레기로 찬다.
- 실기기 육안 확인은 아직 — 예산 바의 무관 조각은 transcript 스캔이 한 바퀴 돈 뒤에 채워진다.
