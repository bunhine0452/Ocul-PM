---
oculpm_plan: v1
id: acp-adapter-073
title: "ACP 어댑터 0.73.0 상향 + 계획모드 선택지 표시"
status: done
created: 2026-09-02
updated: 2026-09-02
owner: claude-code
---

고정 어댑터를 `@agentclientprotocol/claude-agent-acp` 0.70.0 → 0.73.0 으로 올린다. 내장 Claude Code(`@anthropic-ai/claude-agent-sdk`)가 0.3.232 → 0.3.257 로 함께 올라간다. dist 대조 결과 우리가 파싱하는 `session/update` 10종과 `_meta.jetbrains.air.*` 경로는 전부 불변 — 새 종류(subagent/async_task)는 전부 capability opt-in 뒤에 있다. 함께, 0.71.0 이 ExitPlanMode 승인에 추가한 **컨텍스트 비우기** 선택지가 기존 "그냥 허용"과 구분 없이 보이는 문제를 카드에서 잡는다.

## 어댑터 상향 {#bump}
- [x] adapter.rs PINNED_VERSION 0.70.0 → 0.73.0 및 상향 근거 주석 갱신 (SDK 0.3.232→0.3.257, session/update 불변) {#bump-pin}
- [x] client capabilities 배열은 [sessionFailure, agentFileChangeReport] 유지 — nativeSubagentSessions·asyncTasks 는 Rust 스키마 미지원이라 광고 금지, 근거를 process.rs 주석에 남긴다 {#bump-caps}
- [x] 코드·테스트의 "어댑터 0.70.0" 표기 정리 (session.rs 3곳, process.rs, commands/acp.rs, acpTurns.ts, acpTitle.ts, 테스트 픽스처 3개) {#bump-refs}

## 계획모드 선택지 표시 {#exitplan}
- [x] 컨텍스트 비우기 선택지 판별 순수 헬퍼 — optionId 접두사 exit-plan-clear- 기준, 라벨(영문·가변 %)에 기대지 않는다 {#exitplan-detect}
  - [x] 헬퍼 단위 테스트 — clear 3종 판별 · 비-clear 오탐 없음 · 모르는 id 는 일반 취급 {#exitplan-detect-test}
- [x] PermissionCard 에서 파괴적 선택지를 시각 분리 + 무엇이 사라지는지 한 줄 설명 {#exitplan-card}
  - [x] agent.css 에 .btn.perm-destructive — 토큰만 사용(design_tokens 게이트), perm-always 와 확실히 구분 {#exitplan-css}
- [x] i18n ko/en 문구 추가 (설명줄) {#exitplan-i18n}

## 검증 {#verify}
- [x] 스파이크 재실행(docs/acp-panel/spike/acp_spike.py)으로 0.73.0 의 session/update 종류가 늘지 않았음을 실측 확인 {#verify-spike}
- [x] cargo test — bindings.ts 재생성 포함 {#verify-cargo}
- [x] pnpm typecheck / test / lint / build 4게이트 exit 0 직접 확인 {#verify-gates}

## 릴리스 {#release}
- [x] 릴리스 여부 사용자 확인 (버전 번호 결정 포함) {#release-ask}
- [x] 5면 기재 — 버전 3파일, CHANGELOG, README ko/en, landing 6곳 {#release-surfaces}
- [x] 커밋·태그 푸시 후 release.yml CI conclusion 확인, landing 은 landing/ 에서 vercel --prod {#release-tag}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-02T10:32:40+09:00 | #bump-pin | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | PINNED_VERSION 0.73.0 · 상향 근거 주석 재작성 |
| 2026-09-02T10:32:42+09:00 | #bump-caps | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | 유지 + 미광고 근거를 process.rs 주석에 |
| 2026-09-02T10:32:49+09:00 | #bump-refs | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | acpTitle.ts 전제 갱신 + 픽스처 2곳. 나머지 "0.70.0" 은 도입 시점 기록이라 그대로 둠 |
| 2026-09-02T10:32:51+09:00 | #exitplan-detect-test | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | acp_permission_options.test.ts 3건 |
| 2026-09-02T10:32:57+09:00 | #exitplan-css | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | --warn 계열 토큰만 사용 · .perm-note 동반 |
| 2026-09-02T10:32:58+09:00 | #exitplan-i18n | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | acp.perm.clearContext ko/en |
| 2026-09-02T10:33:03+09:00 | #verify-spike | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | 0.73.0 실측 — 새 session/update 종류 없음, protocolVersion 1 유지 |
| 2026-09-02T10:33:05+09:00 | #verify-cargo | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | exit 0 · bindings.ts diff 없음 · fmt/clippy 동반 확인 |
| 2026-09-02T10:33:10+09:00 | #verify-gates | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | typecheck·test(148/1850)·lint·build 전부 exit 0 |
| 2026-09-02T10:39:20+09:00 | #release-ask | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | v2.32.0 로 릴리스 승인받음 |
| 2026-09-02T10:39:22+09:00 | #release-surfaces | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | 버전 5파일·CHANGELOG·README ko/en·landing 6곳+FAQ·featureList·wiki 재빌드 |
| 2026-09-02T11:17:33+09:00 | #release-tag | claude-code | ☐→x | 20260902/Features_to_add/1032_feature_acp-adapter-073-and-clear-context-option.md | v2.32.0 release.yml success · 에셋 4개 · 노트 1074자 · oculpm.com 갱신 |
<!-- oculpm:plan-log end -->
