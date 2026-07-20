---
schema_version: 1
type: feature
slug: "rule-promotion-loop"
status: done
difficulty: medium
created_at: "2026-07-20T17:46:55+09:00"
session_id: "mcp-20260720-174655"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/rule_promotion.rs"
    op: create
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/rule_promotion.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/retro/RuleCandidates.tsx"
    op: create
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/__tests__/rule_promotion_v2.test.tsx"
    op: create
related: []
tags:
  - "claude-integration"
  - "rule-promotion"
  - "retro"
  - "rules-hub"
  - "mcp-tool"
---
[x] PR-CI4 실패→규칙 승격 루프 — 결정적 후보 추출 + LLM 초안 + 회고 화면 승인 카드

## 추가 기능

보고서 6.2절의 "실패를 규칙으로 승격" 플라이휠을 제품화 (마스터플랜 D5 후반부). CI3 규칙 허브가 저장 표면, 이번 PR 이 그 위의 루프.

- **결정적 후보 추출** (`oculpm/rule_promotion.rs`, LLM 없음): error/bug 일지의 `files_touched` 디렉터리를 최대 3세그먼트 "영역(area)" 으로 클러스터링 — 같은 영역에 실패 일지 ≥2건이면 후보. RangeEntry 에 태그가 없어 영역 클러스터링 단일 축으로 감 (정직한 신호만).
- **이중 억제**: ① 기존 프로젝트 규칙의 `paths` 가 영역을 덮으면(경계 검사 — `src/apiX` 는 `src/api` 를 못 덮음) 제외, ② 승격 저장된 규칙 본문의 `<!-- oculpm:promoted-from <key> -->` 마커 키 수확으로 재등장 방지. 거절은 세션-로컬(파일 무변경 — 수용 기준 그대로).
- **LLM 초안** (`rule_draft_generate`, 옵인·과금): 증거 = 클러스터 일지 본문(디스크 SSOT 를 **redact 통과** 후 1,600자 발췌) + entry_diffs 사이드카의 실제 변경 파일(paths 추론 근거, 사이드카는 v3 부터 캡처 시 마스킹). JSON 강제 응답을 관대 파싱(코드펜스 허용) → slug 정규화(kebab, 폴백 promoted-rule)·paths 검증(절대경로/`..`/과대입력 거부, 상한 8) → 저장용 `content`(frontmatter paths + promoted-from 마커 + 본문) 조립.
- **자동 적용 경로 부재의 구조적 보장**: 이 모듈·커맨드에는 `.claude/rules` 를 쓰는 코드가 없다. 커맨드는 `rule_candidates`(조회)·`rule_draft_generate`(초안) 2개뿐이고, 저장은 프런트가 제안 카드에서 "규칙으로 저장" 을 눌러 기존 `rules_save`(CI3, create=true) 를 부를 때만 — Cursor 병행 배포도 그 경로로 공짜 상속.
- **회고 화면 "규칙 후보" 섹션** (`RuleCandidates.tsx`): 신호 패널 아래, 후보 없으면 스스로 숨음. 후보 행(영역·건수·표본 제목·paths 제안) → "초안 생성"(resolveLlmTarget, 과금 title 고지) → 제안 카드(제목·paths 칩·본문 미리보기·**슬러그 편집 가능** — 중복 파일명 막다른 길 방지) → 승인/거절.

## 동작 흐름

1. 회고 화면 진입 → `rule_candidates(기간)` 조회 (결정적·무과금) → 후보 섹션 렌더.
2. "초안 생성" → `rule_draft_generate` 가 후보를 재계산해 키로 찾고(스테일 안전) 증거로 LLM 호출 → 제안 카드.
3. "규칙으로 저장" → `rules_save(project, .claude/rules/<slug>.md, content, create=true)` → 성공 시 후보 목록에서 제거, 다음 조회부턴 promoted-from 마커·paths 겹침 억제로 재등장 없음. 거절/숨기기 → 상태만 변경.

## 검증

- `cargo test` 373 passed — 신규 rule_promotion 9건: 클러스터링 임계·영역 깊이·정렬/상한, paths·마커 이중 억제(+경계 케이스), 마커 수확 왕복, JSON 관대 파싱·slug 정규화·불량 paths 필터, 프롬프트 증거 포함.
- `pnpm test` 160 passed — 신규 `rule_promotion_v2.test.tsx` 6건: 렌더/초안 단계 저장 0 (자동 적용 부재 고정), 승인 클릭만 rulesSave(create=true, 슬러그 수정 반영), 거절·숨기기 무변이, 후보 0 이면 섹션 미렌더, axe 0.
- typecheck/lint/build exit 0. LLM 실호출·회고 화면 실사용은 #ci4-runtime-verify 로 남김.