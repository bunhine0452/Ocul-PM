---
oculpm_plan: v1
id: any-project-best-results-20261028
title: "「어떤 프로젝트여도」 — 플랜이 없는 작업에도 다섯 원칙이 닿게"
status: active
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

사용자 말(2026-10-28): "oculpm을 사용하면 에이전트를 사용했을때 최고의 결과를 내주게 해줘야해. 어떤 프로젝트여도." 최고의 결과 라운드(best-results-round-20261028)는 다섯 원칙을 **플랜**(완료 조건·확인 명령)에 박았다. 그런데 가장 흔한 경우 — 막 추적을 시작한 프로젝트, 플랜 없이 "이거 고쳐" 한 줄로 시작하는 작업, Cursor·Gemini 처럼 훅이 없는 에이전트 — 에는 기록 규칙만 닿고 운용 규율은 닿지 않는다. 시작 훅은 플랜·일지가 없으면 침묵하고, 템플릿은 「어떻게 기록하나」만 말하고 「어떻게 일하나」는 말하지 않으며, check 없이 만든 플랜은 통과/실패를 내는 것 없이 산다. 이 라운드는 그 세 구멍을 기계로 메운다 — 새 화면·새 도구 없이(범위 동결), 템플릿 한 절·훅 두 줄·plan_create 기본값으로.

**완료 조건:** .oculpm 만 있는 빈 프로젝트(플랜 0·일지 0)에서 새 세션의 에이전트가 시작 컨텍스트로 「플랜·일지 없음 → 완료 조건·확인 명령부터」 한 줄과 매니페스트(package.json·Cargo.toml·pyproject·go.mod·Makefile)에서 감지한 확인 명령 후보를 받고, 템플릿 v18 「작업 규율」 절이 플랜 유무와 무관하게 한 작업마다 완료 조건·확인 명령·결과 끝 줄·남은 일 이월을 요구하며, check 없이 만든 플랜은 plan_create 가 감지한 확인 명령을 채우고 warnings 로 알린다(못 찾으면 없다고 경고).
**확인 명령:** pnpm test && (cd src-tauri && cargo test --lib agents:: && cargo test --lib mcp::tools::tests && cargo test --test plugin_xplat && cargo test --test plugin_hook_no_plan)

## 템플릿 — 기록 규칙에 운용 규율 한 절 {#p-template}
- [x] 템플릿 v18 ko/en — §「작업 규율」: 코드 전 완료 조건·확인 명령 한 줄(모호하면 세 질문 이내, 두 단계 넘으면 plan_create) · 범위 안에서, 두 번 실패하면 접근 교체 · 끝엔 확인 명령 결과 끝 줄, 초록이어도 실제로 띄워 보기 · 남은 일은 대화가 아니라 플랜 항목으로. 예산 ko 4,800→5,300 · en 6,500→7,100, 근거를 tests.rs 이력에 {#template-v18}

## 시작 훅 — 플랜이 없어도 말한다 {#p-hook}
- [x] plan-context.sh(claude·codex 동일) — 활성 플랜 미완 항목 0 이고 일지 0 이면 「플랜·일지 없음 → 두 단계 넘는 작업은 plan_create(done_when·check)부터, 한 단위 끝나면 journal_write」 한 줄 {#hook-empty}
- [x] plan-context.sh — 확인 명령 없는 활성 플랜이 있거나 플랜이 없을 때 매니페스트에서 확인 명령 후보 감지(package.json scripts.test → pnpm/npm/yarn test by lockfile · Cargo.toml → cargo test · pyproject/pytest.ini → pytest · go.mod → go test ./... · Makefile test: → make test) 한 줄, 순수 sh·네트워크 0 {#hook-check-candidate}
- [x] 새 통합 테스트 파일 src-tauri/tests/plugin_hook_no_plan.rs (plugin_xplat.rs 는 래칫 935줄) — 빈 프로젝트 안내 줄 · Cargo.toml+package.json 후보 줄 · 플랜에 확인 명령이 있으면 후보 줄 없음 {#hook-tests}

## plan_create — 확인 명령은 기본값이 있다 {#p-create}
- [x] check 생략 시 프로젝트 루트에서 같은 규칙으로 감지해 **확인 명령:** 줄을 채우고 warnings 에 「감지한 명령을 적었다 — 틀리면 그 줄을 고쳐라」, 못 찾으면 warnings 에 「확인 명령 없음 — 통과/실패를 내는 것이 없는 플랜은 주장으로 닫힌다」. 감지 함수는 Rust 한 자리(oculpm/check_infer.rs)로 두고 훅 sh 와 규칙을 맞춘다. plan_goal 테스트 {#create-default-check}

## 문서 {#p-docs}
- [x] PROMISE.md 다섯 원칙 표 ①②의 자리 열에 「플랜이 없어도」(훅 빈 프로젝트 줄 · 템플릿 v18 작업 규율 · plan_create 기본 확인 명령), 측정 목표 「확인 명령 있는 플랜」 행에 생성 시 기본값 명시. plugin README 재개 컨텍스트 행 갱신 {#docs-promise}

## 확인 날 — 눈으로 {#p-eyes}
- [ ] [사용자] 플러그인 업데이트 뒤 .oculpm 만 있는 새 폴더에서 claude 새 세션 — 시작 컨텍스트에 「플랜·일지 없음」 줄과 확인 명령 후보가 실리는지, Cursor 에서 AGENTS.md v18 만으로 완료 조건 한 줄을 먼저 말하는지 {#eyes-empty-project}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-28T19:45:02+09:00 | #template-v18 | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | §1 작업 규율 ko/en, §2~6 재번호, ko 5,147 · en 7,275, 예산 5,300/7,400 근거 tests.rs 이력 |
| 2026-10-28T19:45:10+09:00 | #hook-empty | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | 미완 0·일지 0 → 「무엇부터」 한 줄, 전달 원장은 body/rels 있을 때만 |
| 2026-10-28T19:45:19+09:00 | #hook-check-candidate | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | package.json "test": →락파일 러너 · Cargo.toml · pyproject/pytest.ini · go.mod · Makefile test:, 없으면 「후보 없음」 |
| 2026-10-28T19:45:27+09:00 | #hook-tests | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | tests/plugin_hook_no_plan.rs 4 passed; resume_context 빈 프로젝트 테스트를 「안내만·원장 없음」으로 |
| 2026-10-28T19:45:36+09:00 | #create-default-check | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | check_infer.rs default_check + plan_create warnings, plan_goal 테스트, parity 테스트가 sh 를 문다 |
| 2026-10-28T19:46:06+09:00 | #docs-promise | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/1944_feature_any-project-best-results.md | PROMISE.md ①② 자리 열 + 측정 행, plugin README 재개 행, plugin.html ko/en plan_create 행 |
<!-- oculpm:plan-log end -->
