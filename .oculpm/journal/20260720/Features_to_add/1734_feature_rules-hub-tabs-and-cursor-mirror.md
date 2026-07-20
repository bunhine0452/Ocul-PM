---
schema_version: 1
type: feature
slug: "rules-hub-tabs-and-cursor-mirror"
status: done
difficulty: medium
created_at: "2026-07-20T17:34:07+09:00"
session_id: "mcp-20260720-173407"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/claude-integration/03-rules-hub-ui-spec.md"
    op: create
  - path: "docs/claude-integration/00-master-plan.md"
    op: update
  - path: "src-tauri/src/oculpm/rules.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
  - path: "src-tauri/src/oculpm/session.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/commands/rules.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/skills/rulesModel.ts"
    op: create
  - path: "src/features/skills/RulesTab.tsx"
    op: create
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/__tests__/rules_hub_v2.test.tsx"
    op: create
related: []
tags:
  - "claude-integration"
  - "rules-hub"
  - "skills"
  - "cursor"
  - "mcp-tool"
---
[x] PR-CI3 규칙 허브 — 스킬 화면 탭 확장(규칙·훅) + .claude/rules paths 편집 + Cursor .mdc 병행 배포

## 추가 기능

Phase B 첫 PR (마스터플랜 D5). 12번째 "스킬" 화면을 **"스킬·규칙" 허브**로 확장했다 — 탭: 스킬(현행 유지) · 규칙(신규) · 훅(CI0 블록 재사용).

- **실측 교정이 선행**: 공식 문서 재검증 결과 `.claude/rules/**/*.md` 는 프로젝트+전역(`~/.claude/rules`) **재귀** 네이티브 지원이고, frontmatter 는 마스터플랜이 가정한 `globs` 가 아니라 **`paths: [glob…]` 하나뿐** (없으면 항상 로드). `03-rules-hub-ui-spec.md` 를 스키마 정답 문서로 작성하고 D5 에 교정 노트를 달았다.
- **규칙 탭**: CLAUDE.md 계열 고정 슬롯(프로젝트 `CLAUDE.md`·`.claude/CLAUDE.md`·`CLAUDE.local.md` + 전역 `~/.claude/CLAUDE.md`, 미존재 슬롯은 "만들기" 고스트) + 프로젝트/전역 규칙 목록. 스킬과 동일한 2-pane, 원문 편집(⌘S) 위에 **paths 칩 편집기** — `rulesModel.ts` 가 draft 의 frontmatter 를 **행 단위로만** 치환해 다른 키·본문을 바이트 보존한다.
- **Cursor 병행 배포** (크로스툴 번역 v1): `config.agents.rules_translate`(serde default, 검증은 `TRANSLATE_TARGETS`) 옵인. 저장 시 `.cursor/rules/<평탄화>.mdc` 로 `paths`→`globs`+`alwaysApply` 번역. 소유는 본문 첫 줄 `<!-- oculpm:rule-mirror … -->` 마커 — **마커 없는 기존 파일은 절대 덮지 않고 conflict 보고** (어댑터 `ocul-pm.mdc` 충돌도 자연 차단). 토글 시 `rules_sync_translations` 가 미러 전체를 화해(고아 제거 포함, 멱등).
- **백엔드**: `oculpm/rules.rs` (허용 목록 경로 검증 + `clean_path` 감금, 재귀 나열 깊이 4·상한 200, 512KB 상한, 멱등 쓰기) + thin `commands/rules.rs` 5종 (`rules_list/read/save/delete/sync_translations`). 신규 생성은 flat kebab 만, CLAUDE.md 계열은 삭제 구조적 거부.
- **훅 탭**: 설정의 `ClaudeHooksBlock`(CI0) 를 그대로 재사용 + 일지 초안·MCP 위치 안내.
- navRegistry 라벨 "스킬"→"스킬·규칙" (id·순서 불변 — 저장된 uiV2View·⌘번호 영향 없음).

## 동작 흐름

1. 규칙 저장 → `rules_save` 가 config 의 번역 옵인을 읽어 미러를 병행 갱신, `RuleSaveOutcome.mirror` 로 결과(conflict 포함)를 UI 토스트에 반영.
2. 번역 토글 → 프런트가 `oculpm_get/set_config` 로 `rules_translate` 를 쓰고 곧바로 `rules_sync_translations` 호출 (신규 토글 커맨드 없음).
3. 규칙 삭제 → 파일 삭제 + 마커 미러 제거(옵인 여부 무관 — 잔재 정리).

## 검증

- `cargo test` 364 passed (신규 rules 단위 8건: 경로 검증·paths 파싱·CRUD 멱등·미러 번역/충돌/양방향 수렴) — bindings.ts 재생성 포함.
- `pnpm test` 154 passed (신규 `rules_hub_v2.test.tsx` 11건: 허브 탭 전환·규칙 목록/생성/paths 칩 편집/토글 계약/삭제 가드 + axe, `skills_v2` 기존 스킬 회귀 0) · typecheck/lint/build exit 0.
- 실앱 UI 실사용 확인은 #ci3-runtime-verify 로 남김.