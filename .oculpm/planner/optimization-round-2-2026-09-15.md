---
oculpm_plan: v1
id: optimization-round-2-2026-09-15
title: "최적화 라운드 2 (2026-09-15) — 원장에 남은 것: 800줄 부채 상위 7 · AI 컨텍스트 왕복 · 스케줄링 계측"
status: done
created: 2026-09-15
updated: 2026-09-21
owner: claude-code
---

docs/optimization/00-ledger.md 에서 아직 안 고친 것만. chunks.content·FileIdMap 은 09-12 에 재서 기각(§3), Today 이월 3건은 v3-release 가 이미 해결해 닫음. 병렬 worktree 세션이 파일 하나씩 맡고 오케스트레이터가 합류·게이트·원장 §4 갱신. 행동 변화 없는 분할만 — 공개 경로(lib.rs·bindings·import 경로) 불변.

## Phase 1 — 800줄 부채 상위 7 (원장 §2.3 {#file-size-debt}, ← improvement-round #big-files) {#p1-file-size}
- [x] commands/window.rs 3,028줄 → commands/window/ 모듈 폴더 (이벤트 타입·탭 상태·드래그·터미널 창·프로젝트 창 등 책임별), `crate::commands::window::*` 공개 경로 불변(lib.rs 무변경), 전부 ≤800 {#split-window-rs}
- [x] commands/code.rs 2,251줄 → commands/code/ 모듈 폴더, 공개 경로 불변, 전부 ≤800 {#split-code-rs}
- [x] oculpm/watcher.rs 2,161줄 → oculpm/watcher/ 모듈 폴더(이벤트 분류·처리 루프·상태·테스트), 공개 경로 불변, 전부 ≤800 — 이 세션이 #scheduling-telemetry 도 이어서 {#split-watcher-rs}
- [x] git.rs 1,580줄 → git/ 모듈 폴더(diff·log/graph·status·테스트), `crate::git::*` 불변, local_diff 통합 스위트 통과 {#split-git-rs}
- [x] features/code/CodePane.tsx 1,555줄 → 훅·하위 컴포넌트 추출(features/code/codePane/*), default export 경로 불변, 전부 ≤800 {#split-codepane}
- [x] features/code/CodeScreenV2.tsx 1,471줄 → 훅·하위 컴포넌트 추출, lazy 청크 경로 불변, 전부 ≤800 {#split-codescreen}
- [x] features/terminal/TerminalSurface.tsx 1,445줄 → 훅·하위 컴포넌트 추출, 공개 경로 불변, 전부 ≤800 {#split-terminalsurface}

## Phase 2 — 왕복·계측 {#p2-measure}
- [x] AI 컨텍스트 직렬 왕복 4 → 2 (원장 §1.1 잔여) — aiContext.ts 의 buildPlannerSystemContext·buildOculpmSystemContext 호출을 Promise.all 로, candidates 적재 순서 보존을 테스트로 물 것 {#ai-context-callsite}
- [x] 스케줄링 계측 (perf-baseline §7, ← v3-release #scheduling-telemetry) — WatcherStatus 에 dropped_total·queue_depth(현재/최대)·handle_event 누적 ms 노출(spec.rs+bindings), 진단 탭에 표시, perf_baseline 하니스가 같은 값을 찍는다 {#scheduling-telemetry}

## Phase 3 — 합류·원장·육안 {#p3-merge}
- [x] 병렬 세션 브랜치 합류 → typecheck·test·lint(래칫 포함)·build·cargo fmt/clippy/test 전부 exit 0 → PR → CI 초록이면 rebase 머지 {#merge-gates}
- [x] docs/optimization/00-ledger.md §2.3 재측(초과 파일 수·초과 줄 합) + §4 잔고 표 2026-09-15 열 추가(AI 컨텍스트 왕복 2 포함) {#ledger-update}
- [x] 실기기: 설치본에서 창 탭 드래그·코드 화면 편집/포매터·터미널 확대/리사이즈·브랜치 전환 시 워처 — 분할 뒤 회귀 없는지 (설치본 도는 중 dev 빌드 금지) {#eyes-split-regression}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-15T22:43:07+09:00 | #split-window-rs | claude-code | ☐→~ |  | 병렬 세션 W 착수 (worktree) — 8세션 동시 |
| 2026-09-15T22:43:11+09:00 | #split-code-rs | claude-code | ☐→~ |  | 병렬 세션 C 착수 |
| 2026-09-15T22:43:16+09:00 | #split-watcher-rs | claude-code | ☐→~ |  | 병렬 세션 WT 착수 — 분할 뒤 #scheduling-telemetry 이어서 |
| 2026-09-15T22:43:21+09:00 | #split-git-rs | claude-code | ☐→~ |  | 병렬 세션 G 착수 |
| 2026-09-15T22:43:26+09:00 | #split-codepane | claude-code | ☐→~ |  | 병렬 세션 CP 착수 (codePane/) |
| 2026-09-15T22:43:30+09:00 | #split-codescreen | claude-code | ☐→~ |  | 병렬 세션 CS 착수 (codeScreen/) |
| 2026-09-15T22:43:34+09:00 | #split-terminalsurface | claude-code | ☐→~ |  | 병렬 세션 TS 착수 (terminalSurface/) |
| 2026-09-15T22:43:39+09:00 | #ai-context-callsite | claude-code | ☐→~ |  | 병렬 세션 AI 착수 |
| 2026-09-15T22:50:41+09:00 | #ai-context-callsite | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2250_refactor_ai-context-callsite-parallel.md | AI 완료 19bfb72e — 16조합 바이트 동일 + 동시성 테스트(옛 코드에서 빨감 확인), 원장 §4 행 2 달성 |
| 2026-09-15T22:56:56+09:00 | #split-git-rs | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2256_refactor_split-git-rs.md | G 완료 fc28e904 — git/ 10파일 최대 250줄, 다중집합 diff 로 순수 이동 증명, bindings 0줄 |
| 2026-09-15T23:00:25+09:00 | #split-terminalsurface | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2300_refactor_split-terminalsurface.md | TS 완료 02eae369 — 1,445→756 + 9파일(최대 430), 효과 순서 전역 보존, 226 테스트 |
| 2026-09-15T23:01:16+09:00 | #split-codepane | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2301_refactor_split-codepane.md | CP 완료 deeef3a0 — 1,555→798 + 15파일, code_* 411/411. lint:bindings allowlist +5(순수 이동, #api-facades 후속) |
| 2026-09-15T23:02:05+09:00 | #split-window-rs | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2301_refactor_split-window-rs.md | W 완료 eae3cc0e — 3,028→11파일(최대 640 tests), 48 테스트, menu.rs include_str 가드 경로 갱신, pub 65개 집합 동일 |
| 2026-09-15T23:02:35+09:00 | #split-codescreen | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2302_refactor_split-codescreen.md | CS 완료 1e52c026 — 1,471→780 + 11파일, 517/517. bindings allowlist 는 CodeScreenV2 빠지고 훅 4 추가 |
| 2026-09-15T23:03:41+09:00 | #split-code-rs | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2303_refactor_split-code-rs.md | C 완료 c583b727 — 2,251→9파일(최대 770 tests), 39/39, 글롭 재수출로 가시성 보존, bindings 0줄 |
| 2026-09-15T23:14:49+09:00 | #split-watcher-rs | claude-code | ~→x | .oculpm/journal/20260915/Refactors/2314_refactor_split-watcher-rs.md | WT 완료 a0f6d9d7 — 2,161→8파일(최대 539 tests), 16 테스트, lib/bindings 무변경 |
| 2026-09-15T23:14:55+09:00 | #scheduling-telemetry | claude-code | ☐→x | .oculpm/journal/20260915/Features_to_add/2314_feature_watcher-scheduling-telemetry.md | WT 완료 e732a476 — WatcherSchedStats·진단 탭·M2c(드레인 3.6s 중 handle_event 32ms 실측). v3-release #scheduling-telemetry 도 닫을 것 |
| 2026-09-15T23:18:16+09:00 | #ledger-update | claude-code | ☐→x |  | 원장 §2.3 재측정 블록(37→26 파일, 17,923→7,924 줄) + §4 에 2026-09-15 열(DB 673MB dbstat·M2c 행 추가) + perf-baseline §7 정정 |
| 2026-09-15T23:26:15+09:00 | #merge-gates | claude-code | ☐→x |  | PR #25 CI 3잡 success → rebase 머지, main f042e241. 로컬 게이트 전부 0 |
| 2026-09-21T10:15:46.637057+00:00 | #eyes-split-regression | user | ☐→x |  |  |
<!-- oculpm:plan-log end -->
