---
oculpm_plan: v1
id: context-budget-truth
title: "컨텍스트 예산을 정직하게 — 누락된 표면·글롭 실측·부정 감지·0회 4상태"
status: done
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

2026-09-03 ECC 전역 제거 라운드에서 스킬·규칙 화면의 측정 구멍 4개가 드러났다. 화면은 세션당 119KB 를 보고했지만 실제는 약 149KB 였다 — `~/.claude/agents/*.md` 67개와 `commands/*.md` 94개의 description 프론트매터 29.7KB 가 매 세션 시스템 프롬프트에 실리는데 `ContextKind` 에 그 종류가 없다. 나머지 셋은 이미 백엔드에 데이터가 있는데 화면이 안 쓰거나(글롭 매칭 수), 판정을 뭉뚱그린다(0회 = 결함으로 단정). 전부 결정적 판정이며 LLM·네트워크를 쓰지 않는다.

## A. 에이전트·커맨드 표면을 예산에 넣는다 {#surface}
- [x] `oculpm/agent_surface.rs` 신설 — `~/.claude/agents/*.md`·`commands/*.md` 와 프로젝트 `.claude/agents`·`.claude/commands` 를 훑어 frontmatter `name`+`description` 을 파싱한다 {#surface-backend}
  - [x] `SurfaceEntry { scope, kind, rel_path, name, description, bytes, disabled }` — `bytes` 는 name+description 의 UTF-8 합 (본문은 호출해야 읽히므로 제외, skillItem 과 같은 규율) {#surface-entry}
  - [x] frontmatter 없는 .md 는 파일명을 name 으로, description 은 빈 문자열 — 건너뛰지 말고 0바이트로 세어 목록에는 남긴다 {#surface-nofm}
  - [x] 플러그인 제공 에이전트·커맨드(`~/.claude/plugins/**`)는 v1 범위 밖 — 파일 단위로 손댈 수 없고 /plugin 이 관리한다. 코드 주석과 화면 각주에 한계를 적는다 {#surface-plugin-scope}
- [x] 커맨드 `agent_surface_list` 추가 — `lib.rs` 의 `use` 와 `collect_commands![]` 양쪽에 등록하고 `cargo test` 로 bindings.ts 재생성 {#surface-cmd}
- [x] `ContextKind` 에 `"agent" | "command"` 추가 — `buildContextItems` 가 새 overview 를 접고, 필터 칩 2개가 늘어난다 {#surface-kind}
- [x] 예산 바에 조각 `surface` 추가 — 항상 로드와 별개로 그린다 (둘 다 확정 비용이지만 되찾는 방법이 다르다: 규칙은 좁히기, 표면은 제거) {#surface-segment}
- [x] `BUDGET_BASELINE_BYTES` 재측정 — 90KB 기준선이 표면을 빼고 잡힌 값이라 새 기준선을 실측으로 갱신한다 {#surface-baseline}
- [x] contextModel 순수함수 테스트 — 표면 항목이 예산에 더해지고, 비활성은 0으로 빠지고, 종류 필터가 가르는지 {#surface-test}

## B. glob 이 실제로 무는 파일 수를 보여준다 {#globs}
- [x] `findings`(이미 SkillsScreenV2 상태에 있다)를 `ContextLiveList` 까지 내린다 — `RuleScopeFinding.globs[].files` 가 이미 매칭 수를 담고 있어 백엔드 변경이 없다 {#globs-thread}
- [x] 배지를 `paths {N}` → `paths {N} · {M}개 파일` 로. 매칭 0이면 `매칭 0` 경고 칩, unparsed 가 섞이면 물음표로 판정 불가를 드러낸다 {#globs-badge}
- [x] 매칭 파일이 프로젝트 전체의 30% 를 넘으면 `사실상 상시` 칩 — RN 규칙이 `**/*.ts(x)` 로 걸려 있던 이번 사례가 한눈에 보이게 {#globs-defacto}
- [x] 임계값 30% 는 명명 상수로 (`DE_FACTO_ALWAYS_RATIO`), 매직 넘버 금지 {#globs-const}

## C. 실려 놓고 부정되는 규칙을 지목한다 {#negation}
- [x] `oculpm/rule_negation.rs` 신설 — 항상 로드 규칙의 파일명이 CLAUDE.md 계열 본문에서 언급되는지 찾고, 같은 문단(경계 ±1 빈 줄) 안에 부정 표지가 있으면 후보로 올린다 {#neg-backend}
  - [x] 부정 표지 목록: 따르지 않는다·적용하지 않는다·참고하지 않는다·쓰지 않는다·기본값 아님·무시 / do not follow·don't follow·ignore·override·not applicable {#neg-markers}
  - [x] 파일명 매칭은 스템과 마지막 두 조각 둘 다 (`testing.md`, `common/testing.md`) — 흔한 이름의 오탐을 줄이려 두 조각 일치에 가중치 {#neg-match}
  - [x] `NegationFinding { rel_path, cited_in, excerpt }` — 근거 발췌를 반드시 함께 낸다. 휴리스틱이라 사람이 판정할 수 있어야 한다 {#neg-evidence}
- [x] 목록 행에 `부정됨` 칩 + 상세에 발췌 인용. 예산 바에는 별도 조각을 만들지 않는다 — 이미 항상 로드에 포함돼 있고 두 번 세면 예산이 거짓이 된다 {#neg-badge}
- [x] 정리 제안에 `negated` 근거 추가 — 「싣고 나서 부정하는 중, 양쪽으로 낸다」 문구와 회수 가능 바이트 {#neg-proposal}
- [x] 오탐 대비 — 제안은 삭제가 아니라 상세 열기까지만. 전역 규칙 쓰기는 기존 `save_with_backup` 승인 경로 하나뿐이라는 규율을 그대로 지킨다 {#neg-safety}

## D. 「0회」를 네 상태로 가른다 {#dormant-states}
- [x] `triggerProposals` 를 `classifyDormantSkill` 로 교체 — 지금은 0회 스킬을 전부 「설명 고쳐 쓰기」 후보로 밀지만, 0회에는 네 가지 이유가 있고 셋은 설명 문제가 아니다 {#dormant-classify}
  - [x] `precondition-missing` — 설명이 언급하는 파일이 프로젝트에 없다 (run-evals ← EVALS.md). 설명에서 `X.md`·`X.json` 꼴 토큰을 뽑아 존재를 확인, 결정적 {#dormant-precond}
  - [x] `suppressed` — CLAUDE.md 가 그 스킬을 「명시적으로 요청할 때만」 류로 억제 중 (tdd-workflow). C 단계의 문단 스캐너를 재사용 {#dormant-suppressed}
  - [x] `too-new` — SKILL.md mtime 이 계측 창 안이라 0회를 주장할 근거가 없다 (lang-review) {#dormant-toonew}
  - [x] `genuine` — 위 셋 다 아님. **여기에만** 「설명 고쳐 쓰기」를 낸다 {#dormant-genuine}
- [x] 제안 패널을 고쳐 `genuine` 만 카드로 올리고, 나머지 셋은 목록 행 배지로 강등 — 「최근 30일 한 번도 안 걸린 스킬」 이라는 단정 문구도 상태별로 바꾼다 {#dormant-panel}
- [>] `precondition-missing` 에는 「설명 고쳐 쓰기」 대신 그 파일을 만드는 길을 낸다 (EVALS.md → run-evals 가 살아난다) {#dormant-action}
- [x] 순수함수 테스트 — 네 상태가 각각 올바로 갈리고, 계측 전에는 아무것도 제안하지 않는 기존 규율이 유지되는지 {#dormant-test}

## E. 마감 {#wrap}
- [x] `pnpm typecheck` · `pnpm test` · `pnpm lint` · `cargo test` · `cargo clippy -- -D warnings` 전부 exit 0 을 직접 확인 {#wrap-gates}
- [x] i18n 키 추가분을 ko/en 양쪽에 (새 칩·필터·제안 문구) {#wrap-i18n}
- [x] 일지 작성 + 이 플랜 항목 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T05:36:05+09:00 | #surface-entry | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | bytes=name+description, body_bytes 별도 |
| 2026-09-03T05:36:11+09:00 | #surface-nofm | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 스템을 이름으로, 0바이트로 목록 유지 (테스트 고정) |
| 2026-09-03T05:36:16+09:00 | #surface-plugin-scope | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | excludes_plugins 필드 + 모듈 주석에 한계 명시 |
| 2026-09-03T05:36:21+09:00 | #surface-cmd | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | agent_surface_list — use/collect_commands 양쪽 등록, bindings 재생성 |
| 2026-09-03T05:36:26+09:00 | #surface-kind | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | KIND_LABEL_KEY 단일 출처(satisfies)로 중복 표 제거까지 |
| 2026-09-03T05:36:32+09:00 | #surface-segment | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 되찾는 방법이 달라 분리 — 중립색(text-3) |
| 2026-09-03T05:36:37+09:00 | #surface-baseline | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 90KB 유지 결정 — 올리면 안 줄였는데 진척으로 보인다. 주석에 149KB 실측 기록 |
| 2026-09-03T05:36:43+09:00 | #surface-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | Rust 5 + 프런트 6 — measurable=false 로 '휴면' 거짓 배지도 고정 |
| 2026-09-03T05:36:49+09:00 | #globs-thread | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 분모가 필요해 audit→RuleScopeAudit{findings,total_files} 로 확장 |
| 2026-09-03T05:36:55+09:00 | #globs-badge | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | PathsChip — 매칭0/unparsed 물음표. 파일 수는 최댓값(합집합 하한) |
| 2026-09-03T05:37:00+09:00 | #globs-defacto | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 분모 0이면 비율 판정 안 함 |
| 2026-09-03T05:37:05+09:00 | #globs-const | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | DE_FACTO_ALWAYS_RATIO = 0.3 |
| 2026-09-03T05:37:10+09:00 | #neg-markers | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 한/영 16종, 영어는 소문자 비교 |
| 2026-09-03T05:37:16+09:00 | #neg-match | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 맨 스템은 아예 제외 — 흔한 낱말 오탐 차단(테스트 고정). 섹션 단위 매칭 |
| 2026-09-03T05:37:21+09:00 | #neg-evidence | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | NegationFinding{cited_in,excerpt} — 160자 절단 |
| 2026-09-03T05:37:26+09:00 | #neg-badge | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 예산 조각은 만들지 않음(이중 계상 방지) — 제안 근거로만 |
| 2026-09-03T05:37:32+09:00 | #neg-proposal | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | cleanupProposals reason="negated" + 인용. 중복 계상 안 되게 우선 판정 |
| 2026-09-03T05:37:37+09:00 | #neg-safety | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 감사는 아무것도 쓰지 않는다 — 기존 save_with_backup 승인 경로 유지 |
| 2026-09-03T05:37:42+09:00 | #dormant-precond | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | file_tokens (정규식 없이) + walk_project_files basename 집합 대조 |
| 2026-09-03T05:37:47+09:00 | #dormant-suppressed | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | rule_negation::sections 재사용, 억제 표지는 부정과 별도 목록 |
| 2026-09-03T05:37:53+09:00 | #dormant-toonew | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | Specta 가 i64 를 막아 age_days(Option u32) 로 — 분류기가 원하던 형태이기도 |
| 2026-09-03T05:37:58+09:00 | #dormant-genuine | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | triggerProposals 가 genuine 만 반환 — 나머지는 사실로만 표기 |
| 2026-09-03T05:38:04+09:00 | #dormant-panel | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | "설명 문제가 아닌 0회" 절 신설 — 상태 배지 + 근거 인용 |
| 2026-09-03T05:38:09+09:00 | #dormant-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 우선순위·null 나이·계측 전 침묵까지 10개로 고정 |
| 2026-09-03T05:38:24+09:00 | #dormant-action | claude-code | ☐→> | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 미구현 — 없는 파일 이름은 사유 문구에 이미 적히지만 '만들기' 버튼은 없다. EVALS.md 템플릿을 지어내기보다 project-inception 이 쓰는 씨앗과 잇는 게 맞아 보여 후속으로 미룸 |
| 2026-09-03T05:38:30+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | typecheck·test(2071)·lint·build·cargo test(1155)·clippy·fmt 전부 exit 0 직접 확인 |
| 2026-09-03T05:38:35+09:00 | #wrap-i18n | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | ko/en 20키 — lint:i18n 미번역 0개 |
| 2026-09-03T05:38:40+09:00 | #wrap-journal | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/0535_feature_context-budget-truth-four-gaps.md | 일지 1건 + 플랜 전 항목 갱신 |
<!-- oculpm:plan-log end -->
