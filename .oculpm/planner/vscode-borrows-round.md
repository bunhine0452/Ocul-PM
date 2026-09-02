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
- [ ] saveHygiene.ts — applyHygiene 순수 모듈 (docs 01 §B1 설계) {#hygiene-model}
  - [ ] 후행 공백 제거 · protectedLines(자동 저장 시 커서 줄) 보호 {#hygiene-trim}
  - [ ] 끝 빈 줄 정리 → 끝줄 삽입 순서 · cannotTouchLineNumber 규칙 {#hygiene-final}
  - [ ] .md/.markdown 은 후행 공백 정리 제외 (줄 끝 두 칸 = 강제 개행) {#hygiene-md}
  - [ ] 순수 테스트 — 경계 8종 + '이미 정돈된 본문은 같은 문자열' 계약 {#hygiene-test}
- [ ] 설정 5개 추가 (codeTrimTrailingWhitespace · codeInsertFinalNewline · codeTrimFinalNewlines · codeAutoSave · codeAutoSaveDelay) + CodeSettings.tsx + ko/en {#hygiene-settings}
- [ ] save(opts) 로 시그니처 확장 (호출 4곳) + 포맷 뒤·codeWrite 앞에서 정리 → replaceBufferText {#hygiene-wire}
- [ ] 자동 저장 — afterDelay(디바운스, 하한 250ms) · onFocusChange(경로 전환·창 포커스 상실·CM blur) {#autosave-hook}
  - [ ] 게이트: clean · saving · conflict != null · diffMode · fileView!=editor 이면 건너뛴다 {#autosave-gates}
  - [ ] auto:true 면 포맷 건너뛰기 (VS Code saveParticipants.ts:230 과 같은 결정) {#autosave-noformat}
  - [ ] 자동 저장 실패는 조용히 — 충돌은 배너만, 쓰기 실패는 경로당 1회 토스트 {#autosave-quiet}
- [ ] 상태줄 — 자동 저장이 켜져 있으면 '○ 자동 저장' · 저장 중 표시 {#autosave-status}
- [ ] 통합 테스트(fake timers 5종) · 4게이트 · 일지 · plan_update {#p1-close}

## Phase 2 — B3 미리보기 탭 {#p2-preview-tabs}
- [ ] codeTabs.ts — CodePaneTabs.preview 필드 · openFile(opts.preview) · pinTab · sanitizeTabs 방어 {#preview-model}
  - [ ] dirty 인 미리보기 탭은 교체하지 않고 새 탭으로 (미저장 편집이 화면에서 사라지는 경로 0) {#preview-dirty}
  - [ ] 분할·합치기에서 preview 가 창을 넘어가지 않게 {#preview-split}
  - [ ] code_tabs.test.ts — 교체·승격·닫기·sanitize 8종 {#preview-model-test}
- [ ] 입구 배선 — 트리 단일 클릭만 미리보기, 팔레트·검색·코드 이동·일지는 고정 (VS Code 기본과 동일) {#preview-open}
- [ ] 고정 승격 5경로 — 탭 더블클릭 · 트리 더블클릭 · 첫 편집 · 창 이동 · 컨텍스트 메뉴 {#preview-pin}
- [ ] 기울임 렌더(.code-tab.preview) · 컨텍스트 메뉴 항목 · codePreviewTabs 설정(기본 켜짐) · ko/en {#preview-ui}
- [ ] 4게이트 · 일지 · plan_update {#p2-close}

## Phase 3 — B4 심볼(⇧⌘O)·줄(⌃G) 이동 {#p3-goto}
- [ ] gotoModel.ts — parseGoto(':12:3' · '@foo' · 'foo') · rankSymbols(homeMatch 점수 재사용) · clampLine + 테스트 {#goto-model}
- [ ] CodeGoto.tsx — useModalBehavior 재사용 오버레이 · 목록 · 커서 이동마다 미리 점프 · Esc 면 원래 줄 복귀 {#goto-ui}
- [ ] 키 배선 ⇧⌘O / ⌃G (CM 키맵 충돌 확인) · 심볼 없는 파일은 줄 모드로 · shortcutRegistry 2줄 {#goto-keys}
- [ ] 컴포넌트 테스트(a11y 포함) · 4게이트 · 일지 · plan_update {#p3-close}

## Phase 4 — B7 스티키 스크롤 {#p4-sticky}
- [ ] stickyModel.ts — stickyFromSymbols(바깥→안쪽, max 절단은 안쪽부터) · stickyFromIndent 폴백 + 테스트 {#sticky-model}
- [ ] stickyScroll.ts — CM6 ViewPlugin + setStickySource effect · 클릭 점프 · 가로 스크롤 동기화 · 하이라이팅 없음 {#sticky-ext}
- [ ] 심볼을 CodeScreenV2 → CodePane → CodeEditor 로 전달 · 설정 2개(codeStickyScroll 기본 꺼짐 · codeStickyMaxLines 5) · 패인 320px 미만이면 그리지 않기 {#sticky-wire}
- [ ] 4게이트 · 일지 · plan_update {#p4-close}

## Phase 5 — B6 문제 패널 {#p5-problems}
- [ ] lsp_diagnostics_snapshot 커맨드 — 프로젝트 루트 접두로 raw_diagnostics 필터 + 좁은 타입 변환 · lib.rs 양쪽 등록 · cargo test 로 bindings 재생성 {#problems-cmd}
- [ ] problemsStore.ts(모듈 스코프 + useSyncExternalStore) · problemsModel.ts(groupByFile 정렬 · filterBySeverity · totalCounts) + 테스트 {#problems-store}
- [ ] CodeProblems.tsx — 참조 패널과 같은 자리·규약 · 파일당 50 + 더 보기 · 항목 클릭은 고정 탭으로 이동 {#problems-ui}
- [ ] 빈 상태는 '문제 없음' 이 아니라 '아직 아는 문제 없음' · 상태줄 총계 뱃지(패널 존재를 알리는 유일한 신호) {#problems-honesty}
- [ ] 프로젝트 전환 시 clearProject 확인 · 4게이트 · 일지 · plan_update {#p5-close}

## Phase 6 — B5 로컬 히스토리 {#p6-local-history}
- [ ] oculpm/history.rs — .oculpm/index/history/<h2>/<h16>/ 레이아웃 · meta.json 원자 교체 · 스냅샷 쓰기 {#history-core}
  - [ ] 보존 — 256KB 상한 · 파일당 50판 · 10초 병합창(같은 source 만) · 프로젝트 총 512MB {#history-retention}
  - [ ] 레이아웃·보존 판단을 순수 함수로 떼어 단위 테스트 가능하게 {#history-pure}
- [ ] 워처 7.5 단계에 캡처 훅 (hash_after 로 중복 제거, fire-and-forget) + HistoryState.note_self_write 로 user/agent 출처 판정 {#history-capture}
- [ ] 커맨드 4개 — list · read · restore(write_with_lock 통과) · forget + lib.rs 등록 + bindings 재생성 {#history-commands}
- [ ] 브레드크럼 시계 액션 + 팝오버(최신순·시각·출처·크기) · 행 클릭은 diffMode.kind='history' 로 기존 인라인 비교 재사용 · 되돌리기는 useConfirm {#history-ui}
- [ ] 설정 2개(codeLocalHistory 기본 켜짐 · codeLocalHistoryMaxEntries 50) + 사용 용량 표시 + 전부 지우기 {#history-settings}
- [ ] 안전장치 — .env* 제외 · 리네임 추적 · 삭제해도 판 보존 · 색인 정리가 history/ 를 지우지 않는지 확인 {#history-guards}
- [ ] Rust 통합 테스트(자기 억제·병합창·캡) + 프런트 테스트 · 4게이트 · 일지 · plan_update {#p6-close}

## Phase 7 — 라운드 마감 {#p7-round-close}
- [ ] 육안 1회 — 설치본 끄고 dev 로 7가지 한 바퀴 (설치본 도는 중 dev 빌드 금지) {#eyes}
- [ ] 릴리스 5면 — 버전 3파일 · CHANGELOG · README ko/en · landing 6곳 → 태그 푸시 → landing vercel --prod {#release}
- [ ] docs/20260902_vscode-borrows/00-master-plan.md 상태를 '구현 완료' 로 갱신 · 구현 중 뒤집힌 결정 기록 {#docs-sync}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
