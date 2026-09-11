---
oculpm_plan: v1
id: audit-round-2026-09-11
title: "개선점 감사 라운드 — 로그·DB 실측 결함 21건 (2026-09-11)"
status: active
created: 2026-09-11
updated: 2026-09-11
owner: claude-code
---

## Phase A — 실측 결함 {#p1}
- [ ] 프로젝트 삭제가 워처·세션·자동화를 떼지 않는다 — `delete_project` 가 매니저에서 프로젝트를 release 하고, 자동화 tick 이 DB 에 없는 프로젝트를 스스로 걷어낸다 (9,820줄 WARN 재현) {#a1-delete-detach}
- [ ] 전체 색인이 사라진·무시된 파일 행을 지우지 않는다 — `index_project` 끝에 walk 집합 밖의 files 행 삭제 (ai-pm 1,459 중 101 고아) {#a2-index-reconcile}
- [ ] Monaco WebKit 클립보드 우회가 키 입력마다 NotAllowedError+Canceled ERROR 2줄 — 클립보드 서비스 오버라이드 또는 소음 차단 (251/일) {#a3-monaco-clipboard}
- [ ] 정상 종료가 세션을 AppQuit 으로 닫지 않아 매 기동이 crash_recovered — ExitRequested 에서 세션 액터 Shutdown 을 1초 한도로 기다린다 {#a4-appquit-session}
- [ ] 로컬 히스토리 캡처 실패 WARN 4,451건/주 — rename 저장의 중간 이벤트(파일 없음)는 debug 로 내리고 다음 이벤트가 판을 찍는지 확인 {#a5-history-warn}

## Phase B — LLM 어댑터 호환 {#p2}
- [ ] Anthropic 에 temperature 를 항상 보내 Claude 5 / 4.7+ 가 400 — 4.6 이하만 보내고 그 밖은 생략 {#b1-anthropic-temperature}
- [ ] 기본·예시 모델 최신화(Sonnet 5 · 퇴역 haiku placeholder 제거) + OpenAI 는 max_completion_tokens·reasoning 모델 temperature 생략 + 모델 목록 피커(/v1/models) {#b2-model-defaults}

## Phase C — 막다른 UI {#p3}
- [ ] Notion 설정만 남고 내보내기 트리거가 없다 — 일지 상세에 「Notion 으로 보내기」 복원(토큰 없으면 숨김) {#c1-notion-trigger}
- [ ] 일지가 앱 안에서 읽기 전용 — updateEntryBody/Meta 를 상세 화면 인라인 편집으로 잇고 미호출 커맨드(compareLayers·exportDigest) 정리 {#c2-journal-edit}
- [ ] 에이전트 승인 대기·턴 종료를 창이 비활성일 때 OS 알림으로 (설정 옵인, 일지 알림과 같은 스로틀) {#c3-acp-attention}

## Phase D — 저장 공간 위생 {#p4}
- [ ] 로컬 히스토리 전역 바이트 예산(기본 200MB) + 삭제된 파일의 히스토리 정리 — 설정에 현재 용량·상한 노출 {#d1-history-budget}
- [ ] fastembed 옛 모델 디렉터리(e5-small 465MB) 기동 시 정리 {#d2-embed-cache-cleanup}
- [ ] 삭제된 프로젝트의 workspace localStorage 레코드 정리 {#d3-ls-orphans}
- [ ] claude-events.jsonl 무한 append — 소비한 오프셋까지 주기 절단 {#d4-hook-inbox-rotate}

## Phase E — 제품 UX 갭 {#p5}
- [ ] 업데이트 확인을 기동 1회에서 일 1회 + 깨어날 때로 {#e1-update-periodic}
- [ ] 플래너 항목 이동 — `PlanEditOp::move_item {item_id, phase, before}` + 문서형 행 드래그 {#e2-plan-move-item}
- [ ] 화면 뒤로/앞으로 (⌘[ / ⌘]) — WorkspaceContext 링 버퍼 + 단축키 레지스트리 {#e3-nav-history}
- [ ] 기동 시 살아 있는 인스턴스의 락을 무조건 뺏는 것 — 같은 번들 두 번째 인스턴스는 기존 창을 앞으로 (single-instance) {#e4-single-instance}

## Phase F — 문서·릴리스 위생 {#p6}
- [ ] CLAUDE.md 화면 목록(16→15, Retro·Docs 삭제·Branch 추가)·features 폴더 목록 갱신 {#f1-claude-md}
- [ ] 위키 shortcuts.md ⌘9/⌘0 · screens.md 화면 이름 갱신 + build.mjs 재빌드 {#f2-wiki-shortcuts}
- [ ] scripts/bump-version.mjs — 버전 6파일 + 랜딩 ko/en 각 6곳을 한 번에 {#f3-bump-script}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
