---
oculpm_plan: v1
id: vscode-borrows-round
title: "VS Code 에서 가져오는 7가지 — 코드 화면 라운드"
status: active
created: 2026-09-02
updated: 2026-09-02
owner: claude-code
---

코드 화면에 "하루 종일 켜 두는 편집기의 위생" 7가지를 가져온다. 설계 SSOT 는 docs/20260902_vscode-borrows/ (00-master-plan.md + 기능별 6문서). 구현 순서는 비용 오름차순이고, Phase 마다 4게이트(typecheck/test/lint/build) → 일지 → plan_update 로 닫는다. 릴리스는 라운드 끝에 한 번.

## Phase 1 — 저장 위생 (B1 저장 시 정리 · B2 자동 저장) {#p1-save-hygiene}
- [x] saveHygiene.ts — applyHygiene 순수 모듈 (docs 01 §B1 설계) {#hygiene-model}
  - [x] 후행 공백 제거 · protectedLines(자동 저장 시 커서 줄) 보호 {#hygiene-trim}
  - [x] 끝 빈 줄 정리 → 끝줄 삽입 순서 · cannotTouchLineNumber 규칙 {#hygiene-final}
  - [x] .md/.markdown 은 후행 공백 정리 제외 (줄 끝 두 칸 = 강제 개행) {#hygiene-md}
  - [x] 순수 테스트 — 경계 8종 + '이미 정돈된 본문은 같은 문자열' 계약 {#hygiene-test}
- [x] 설정 5개 추가 (codeTrimTrailingWhitespace · codeInsertFinalNewline · codeTrimFinalNewlines · codeAutoSave · codeAutoSaveDelay) + CodeSettings.tsx + ko/en {#hygiene-settings}
- [x] save(opts) 로 시그니처 확장 (호출 4곳) + 포맷 뒤·codeWrite 앞에서 정리 → replaceBufferText {#hygiene-wire}
- [x] 자동 저장 — afterDelay(디바운스, 하한 250ms) · onFocusChange(경로 전환·창 포커스 상실·CM blur) {#autosave-hook}
  - [x] 게이트: clean · saving · conflict != null · diffMode · fileView!=editor 이면 건너뛴다 {#autosave-gates}
  - [x] auto:true 면 포맷 건너뛰기 (VS Code saveParticipants.ts:230 과 같은 결정) {#autosave-noformat}
  - [x] 자동 저장 실패는 조용히 — 충돌은 배너만, 쓰기 실패는 경로당 1회 토스트 {#autosave-quiet}
- [x] 상태줄 — 자동 저장이 켜져 있으면 '○ 자동 저장' · 저장 중 표시 {#autosave-status}
- [x] 통합 테스트(fake timers 5종) · 4게이트 · 일지 · plan_update {#p1-close}

## Phase 2 — B3 미리보기 탭 {#p2-preview-tabs}
- [x] codeTabs.ts — CodePaneTabs.preview 필드 · openFile(opts.preview) · pinTab · sanitizeTabs 방어 {#preview-model}
  - [x] dirty 인 미리보기 탭은 교체하지 않고 새 탭으로 (미저장 편집이 화면에서 사라지는 경로 0) {#preview-dirty}
  - [x] 분할·합치기에서 preview 가 창을 넘어가지 않게 {#preview-split}
  - [x] code_tabs.test.ts — 교체·승격·닫기·sanitize 8종 {#preview-model-test}
- [x] 입구 배선 — 트리 단일 클릭만 미리보기, 팔레트·검색·코드 이동·일지는 고정 (VS Code 기본과 동일) {#preview-open}
- [x] 고정 승격 5경로 — 탭 더블클릭 · 트리 더블클릭 · 첫 편집 · 창 이동 · 컨텍스트 메뉴 {#preview-pin}
- [x] 기울임 렌더(.code-tab.preview) · 컨텍스트 메뉴 항목 · codePreviewTabs 설정(기본 켜짐) · ko/en {#preview-ui}
- [x] 4게이트 · 일지 · plan_update {#p2-close}

## Phase 3 — B4 심볼(⇧⌘O)·줄(⌃G) 이동 {#p3-goto}
- [x] gotoModel.ts — parseGoto(':12:3' · '@foo' · 'foo') · rankSymbols(homeMatch 점수 재사용) · clampLine + 테스트 {#goto-model}
- [x] CodeGoto.tsx — useModalBehavior 재사용 오버레이 · 목록 · 커서 이동마다 미리 점프 · Esc 면 원래 줄 복귀 {#goto-ui}
- [x] 키 배선 ⇧⌘O / ⌃G (CM 키맵 충돌 확인) · 심볼 없는 파일은 줄 모드로 · shortcutRegistry 2줄 {#goto-keys}
- [x] 컴포넌트 테스트(a11y 포함) · 4게이트 · 일지 · plan_update {#p3-close}

## Phase 4 — B7 스티키 스크롤 {#p4-sticky}
- [x] stickyModel.ts — stickyFromSymbols(바깥→안쪽, max 절단은 안쪽부터) · stickyFromIndent 폴백 + 테스트 {#sticky-model}
- [x] stickyScroll.ts — CM6 ViewPlugin + setStickySource effect · 클릭 점프 · 가로 스크롤 동기화 · 하이라이팅 없음 {#sticky-ext}
- [x] 심볼을 CodeScreenV2 → CodePane → CodeEditor 로 전달 · 설정 2개(codeStickyScroll 기본 꺼짐 · codeStickyMaxLines 5) · 패인 320px 미만이면 그리지 않기 {#sticky-wire}
- [x] 4게이트 · 일지 · plan_update {#p4-close}

## Phase 5 — B6 문제 패널 {#p5-problems}
- [x] lsp_diagnostics_snapshot 커맨드 — 프로젝트 루트 접두로 raw_diagnostics 필터 + 좁은 타입 변환 · lib.rs 양쪽 등록 · cargo test 로 bindings 재생성 {#problems-cmd}
- [x] problemsStore.ts(모듈 스코프 + useSyncExternalStore) · problemsModel.ts(groupByFile 정렬 · filterBySeverity · totalCounts) + 테스트 {#problems-store}
- [x] CodeProblems.tsx — 참조 패널과 같은 자리·규약 · 파일당 50 + 더 보기 · 항목 클릭은 고정 탭으로 이동 {#problems-ui}
- [x] 빈 상태는 '문제 없음' 이 아니라 '아직 아는 문제 없음' · 상태줄 총계 뱃지(패널 존재를 알리는 유일한 신호) {#problems-honesty}
- [x] 프로젝트 전환 시 clearProject 확인 · 4게이트 · 일지 · plan_update {#p5-close}

## Phase 6 — B5 로컬 히스토리 {#p6-local-history}
- [x] oculpm/history.rs — .oculpm/index/history/<h2>/<h16>/ 레이아웃 · meta.json 원자 교체 · 스냅샷 쓰기 {#history-core}
  - [x] 보존 — 256KB 상한 · 파일당 50판 · 10초 병합창(같은 source 만) · 프로젝트 총 512MB {#history-retention}
  - [x] 레이아웃·보존 판단을 순수 함수로 떼어 단위 테스트 가능하게 {#history-pure}
- [x] 워처 7.5 단계에 캡처 훅 (hash_after 로 중복 제거, fire-and-forget) + HistoryState.note_self_write 로 user/agent 출처 판정 {#history-capture}
- [x] 커맨드 4개 — list · read · restore(write_with_lock 통과) · forget + lib.rs 등록 + bindings 재생성 {#history-commands}
- [x] 브레드크럼 시계 액션 + 팝오버(최신순·시각·출처·크기) · 행 클릭은 diffMode.kind='history' 로 기존 인라인 비교 재사용 · 되돌리기는 useConfirm {#history-ui}
- [x] 설정 2개(codeLocalHistory 기본 켜짐 · codeLocalHistoryMaxEntries 50) + 사용 용량 표시 + 전부 지우기 {#history-settings}
- [x] 안전장치 — .env* 제외 · 리네임 추적 · 삭제해도 판 보존 · 색인 정리가 history/ 를 지우지 않는지 확인 {#history-guards}
- [x] Rust 통합 테스트(자기 억제·병합창·캡) + 프런트 테스트 · 4게이트 · 일지 · plan_update {#p6-close}

## Phase 7 — 라운드 마감 {#p7-round-close}
- [x] 육안 1회 — 설치본 끄고 dev 로 7가지 한 바퀴 (설치본 도는 중 dev 빌드 금지) {#eyes}
- [x] 릴리스 5면 — 버전 3파일 · CHANGELOG · README ko/en · landing 6곳 → 태그 푸시 → landing vercel --prod {#release}
- [x] docs/20260902_vscode-borrows/00-master-plan.md 상태를 '구현 완료' 로 갱신 · 구현 중 뒤집힌 결정 기록 {#docs-sync}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-02T15:37:42+09:00 | #hygiene-trim | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | protectedLines 는 줄 전체 보호 (열 단위 아님) |
| 2026-09-02T15:37:47+09:00 | #hygiene-final | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | 전부 빈 줄인 파일은 손대지 않음 — VS Code 와 의도적 분기 |
| 2026-09-02T15:37:52+09:00 | #hygiene-md | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | hygieneForPath 로 분리 — .mdx 는 대상 |
| 2026-09-02T15:37:57+09:00 | #hygiene-test | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | 18건 — 경계 + 무변경 계약 |
| 2026-09-02T15:38:02+09:00 | #hygiene-settings | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | 설정 5개 + 자동 저장 전용 Section · ko/en |
| 2026-09-02T15:38:06+09:00 | #hygiene-wire | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | save(opts) — 호출 4곳 중 overwriteDisk 만 인자 변경 |
| 2026-09-02T15:38:13+09:00 | #autosave-gates | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | canAutoSave 하나로 모음 |
| 2026-09-02T15:38:18+09:00 | #autosave-noformat | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | save() 안 auto 분기. jsdom 에서 관측 불가라 통합 테스트 없음 |
| 2026-09-02T15:38:23+09:00 | #autosave-quiet | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | autoFailedRef 로 경로당 1회 |
| 2026-09-02T15:38:28+09:00 | #autosave-status | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | ○ 자동 저장 · 저장 중… |
| 2026-09-02T15:38:32+09:00 | #p1-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md | fake timers 는 훅 테스트로 · 통합은 onFocusChange · 4게이트 exit 0 |
| 2026-09-02T16:12:56+09:00 | #preview-dirty | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | dirtyPaths 를 openFile 옵션으로 받아 방어 |
| 2026-09-02T16:13:01+09:00 | #preview-split | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | 새 창 씨앗은 고정 · 합칠 땐 첫 창 것만 |
| 2026-09-02T16:13:06+09:00 | #preview-model-test | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | 12건 (설계 8종 + 이름바꾸기·삭제·pinTab 동일성) |
| 2026-09-02T16:13:12+09:00 | #preview-open | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | openPath 4번째 인자에 preview 합류 (기존 ch/len 과 같은 객체) |
| 2026-09-02T16:13:17+09:00 | #preview-pin | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | 창 이동은 메뉴·드롭 양쪽 다 고정 |
| 2026-09-02T16:13:22+09:00 | #preview-ui | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | 설정 끄면 기울임·메뉴가 즉시 사라지게 렌더에서 게이트 |
| 2026-09-02T16:13:27+09:00 | #p2-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1612_feature_preview-tabs-in-code.md | 기존 탭 테스트를 더블클릭 고정으로 갱신 · 4게이트 exit 0 |
| 2026-09-02T17:22:21+09:00 | #goto-model | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1722_feature_goto-symbol-and-line-in-file.md | line 을 number\|null 로 넓힘 (`:` 만 친 상태). 약어 규칙 90점을 scoreName 위에 얹음 |
| 2026-09-02T17:22:26+09:00 | #goto-ui | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1722_feature_goto-symbol-and-line-in-file.md | 미리 점프는 사용자가 움직인 뒤부터 — 여는 것만으로 화면이 흔들리지 않는다 |
| 2026-09-02T17:22:32+09:00 | #goto-keys | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1722_feature_goto-symbol-and-line-in-file.md | CM6 에 Ctrl-g 없음 확인 (Mod-g=⌘G 검색 · Ctrl-o=splitLine 은 다른 조합). 점프에 focus 플래그 추가 |
| 2026-09-02T17:22:42+09:00 | #p3-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1722_feature_goto-symbol-and-line-in-file.md | 신규 44건(순수 26 + 위젯·배선 18, a11y 포함) · 4게이트 exit 0 |
| 2026-09-02T17:54:34+09:00 | #sticky-model | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1754_feature_sticky-scroll-in-code-editor.md | 주석 판정은 //·/*·*·&lt;!-- 만 — # 와 -- 는 CSS·SQL 에서 주석이 아니다 |
| 2026-09-02T17:54:40+09:00 | #sticky-ext | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1754_feature_sticky-scroll-in-code-editor.md | 심볼 시작 줄을 문서 오프셋으로 들고 mapPos 로 따라간다 (편집 뒤 거짓말 방지). tr.state 대신 tr.newDoc |
| 2026-09-02T17:54:46+09:00 | #sticky-wire | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1754_feature_sticky-scroll-in-code-editor.md | 설정 토글은 CodeEditor key 재마운트로 즉시 반영 (확장은 마운트 시점 결정 규약) |
| 2026-09-02T17:54:52+09:00 | #p4-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1754_feature_sticky-scroll-in-code-editor.md | 순수 21건 · 4게이트 exit 0 (병렬 세션 WIP 때문에 임시 워크트리에서 typecheck/build 확인) |
| 2026-09-02T18:14:12+09:00 | #problems-cmd | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1814_feature_problems-panel-workspace-diagnostics.md | 서버를 띄우지 않는다(읽기만) · 빈 파일 제거 + 경로 정렬 · Rust 테스트 2건 |
| 2026-09-02T18:14:17+09:00 | #problems-store | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1814_feature_problems-panel-workspace-diagnostics.md | touched 집합 추가 — 지운 경로를 스냅샷이 되살리는 구멍을 테스트에서 잡았다 |
| 2026-09-02T18:14:23+09:00 | #problems-ui | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1814_feature_problems-panel-workspace-diagnostics.md | 참조 패널 뼈대(.code-refs) 재사용 · 자리는 하나라 여는 쪽이 상대를 닫는다 |
| 2026-09-02T18:14:29+09:00 | #problems-honesty | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1814_feature_problems-panel-workspace-diagnostics.md | 뱃지는 0 일 때도 남긴다 — 감추면 빈 상태 문구를 읽을 길이 없어진다 |
| 2026-09-02T18:14:34+09:00 | #p5-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/1814_feature_problems-panel-workspace-diagnostics.md | clearProject 는 projectId effect 정리에서 · 프런트 25 + Rust 2 · 6게이트 exit 0(cargo test·clippy 포함) |
| 2026-09-02T20:38:11+09:00 | #history-retention | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 병합의 '같은 source' 조건이 심장. 예산 정리는 파일마다 최신 한 판을 남긴다 |
| 2026-09-02T20:38:16+09:00 | #history-pure | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | decide_capture · plan_budget_eviction · should_capture · looks_binary — 순수 13건 |
| 2026-09-02T20:38:21+09:00 | #history-capture | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 7.55 단계. 판이 이미 있으면 Create→Update 로 내린다 (macOS 원자 저장이 rename 이라) |
| 2026-09-02T20:38:27+09:00 | #history-commands | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 6개 (설정용 usage·clear 합류). ts 는 경계에서만 십진 문자열 — specta 가 i64 를 막는다 |
| 2026-09-02T20:38:32+09:00 | #history-ui | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 되돌리기는 목록이 아니라 비교 배너에 — 무엇으로 바뀌는지 보고 누르게 |
| 2026-09-02T20:38:37+09:00 | #history-settings | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 기본 켜짐 — 소급 불가라 이 라운드의 유일한 예외. 용량 표시 + 전부 지우기 |
| 2026-09-02T20:38:43+09:00 | #history-guards | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | 리네임은 code_rename 이 다리 (워처는 Delete+Create 라 못 잇는다). 색인 정리는 history/ 를 안 지운다 — 확인함 |
| 2026-09-02T20:38:50+09:00 | #p6-close | claude-code | ☐→x | .oculpm/journal/20260902/Features_to_add/2038_feature_local-history-versions-between-commits.md | Rust 9+13+1 · 프런트 15 · 7게이트 exit 0. Phase 5 의 seed 배열 가드도 동승(pnpm test 가 exit 1 이었다) |
| 2026-09-02T22:24:27+09:00 | #release | claude-code | ☐→x | .oculpm/journal/20260902/Chores/2224_chore_release-v2-34-0.md | v2.34.0 태그 푸시 · 5면 전부 · 랜딩 vercel --prod (oculpm.com 별칭 확인). 중간에 붉은 CI 1건(ts_ms 신원 충돌) 수리 동승 |
| 2026-09-02T22:24:33+09:00 | #docs-sync | claude-code | ☐→x | .oculpm/journal/20260902/Chores/2224_chore_release-v2-34-0.md | master-plan 상태 '구현 완료' + 구현 중 뒤집힌 결정 9건 기록 |
| 2026-09-02T13:26:41.737904+00:00 | #eyes | user | ☐→~ |  |  |
| 2026-09-02T13:26:43.244959+00:00 | #eyes | user | ~→x |  |  |
<!-- oculpm:plan-log end -->
