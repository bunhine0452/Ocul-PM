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
- [x] 프로젝트 삭제가 워처·세션·자동화를 떼지 않는다 — `delete_project` 가 매니저에서 프로젝트를 release 하고, 자동화 tick 이 DB 에 없는 프로젝트를 스스로 걷어낸다 (9,820줄 WARN 재현) {#a1-delete-detach}
- [x] 전체 색인이 사라진·무시된 파일 행을 지우지 않는다 — `index_project` 끝에 walk 집합 밖의 files 행 삭제 (ai-pm 1,459 중 101 고아) {#a2-index-reconcile}
- [x] Monaco WebKit 클립보드 우회가 키 입력마다 NotAllowedError+Canceled ERROR 2줄 — 클립보드 서비스 오버라이드 또는 소음 차단 (251/일) {#a3-monaco-clipboard}
- [x] 정상 종료가 세션을 AppQuit 으로 닫지 않아 매 기동이 crash_recovered — ExitRequested 에서 세션 액터 Shutdown 을 1초 한도로 기다린다 {#a4-appquit-session}
- [x] 로컬 히스토리 캡처 실패 WARN 4,451건/주 — rename 저장의 중간 이벤트(파일 없음)는 debug 로 내리고 다음 이벤트가 판을 찍는지 확인 {#a5-history-warn}

## Phase B — LLM 어댑터 호환 {#p2}
- [x] Anthropic 에 temperature 를 항상 보내 Claude 5 / 4.7+ 가 400 — 4.6 이하만 보내고 그 밖은 생략 {#b1-anthropic-temperature}
- [x] 기본·예시 모델 최신화(Sonnet 5 · 퇴역 haiku placeholder 제거) + OpenAI 는 max_completion_tokens·reasoning 모델 temperature 생략 + 모델 목록 피커(/v1/models) {#b2-model-defaults}

## Phase C — 막다른 UI {#p3}
- [x] Notion 설정만 남고 내보내기 트리거가 없다 — 일지 상세에 「Notion 으로 보내기」 복원(토큰 없으면 숨김) {#c1-notion-trigger}
- [x] 일지가 앱 안에서 읽기 전용 — updateEntryBody/Meta 를 상세 화면 인라인 편집으로 잇고 미호출 커맨드(compareLayers·exportDigest) 정리 {#c2-journal-edit}
- [x] 에이전트 승인 대기·턴 종료를 창이 비활성일 때 OS 알림으로 (설정 옵인, 일지 알림과 같은 스로틀) {#c3-acp-attention}

## Phase D — 저장 공간 위생 {#p4}
- [x] 로컬 히스토리 전역 바이트 예산(기본 200MB) + 삭제된 파일의 히스토리 정리 — 설정에 현재 용량·상한 노출 {#d1-history-budget}
- [x] fastembed 옛 모델 디렉터리(e5-small 465MB) 기동 시 정리 {#d2-embed-cache-cleanup}
- [x] 삭제된 프로젝트의 workspace localStorage 레코드 정리 {#d3-ls-orphans}
- [x] claude-events.jsonl 무한 append — 소비한 오프셋까지 주기 절단 {#d4-hook-inbox-rotate}

## Phase E — 제품 UX 갭 {#p5}
- [x] 업데이트 확인을 기동 1회에서 일 1회 + 깨어날 때로 {#e1-update-periodic}
- [x] 플래너 항목 이동 — `PlanEditOp::move_item {item_id, phase, before}` + 문서형 행 드래그 {#e2-plan-move-item}
- [x] 화면 뒤로/앞으로 (⌘[ / ⌘]) — WorkspaceContext 링 버퍼 + 단축키 레지스트리 {#e3-nav-history}
- [x] 기동 시 살아 있는 인스턴스의 락을 무조건 뺏는 것 — 같은 번들 두 번째 인스턴스는 기존 창을 앞으로 (single-instance) {#e4-single-instance}

## Phase F — 문서·릴리스 위생 {#p6}
- [x] CLAUDE.md 화면 목록(16→15, Retro·Docs 삭제·Branch 추가)·features 폴더 목록 갱신 {#f1-claude-md}
- [x] 위키 shortcuts.md ⌘9/⌘0 · screens.md 화면 이름 갱신 + build.mjs 재빌드 {#f2-wiki-shortcuts}
- [x] scripts/bump-version.mjs — 버전 6파일 + 랜딩 ko/en 각 6곳을 한 번에 {#f3-bump-script}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-11T15:09:24+09:00 | #a1-delete-detach | claude-code | ☐→x |  | forget_project + 자동화 tick 자기정리 |
| 2026-09-11T15:09:30+09:00 | #a2-index-reconcile | claude-code | ☐→x |  | delete_files_by_paths 화해, IndexResult.files_removed |
| 2026-09-11T15:09:35+09:00 | #a3-monaco-clipboard | claude-code | ☐→x |  | WebviewClipboardService 오버라이드 (언어 등록 전 initialize) |
| 2026-09-11T15:09:40+09:00 | #a4-appquit-session | claude-code | ☐→x |  | shutdown_all_blocking 이 세션 Shutdown 을 1초 기다림 (teardown.rs) |
| 2026-09-11T15:09:46+09:00 | #a5-history-warn | claude-code | ☐→x |  | 원인은 소음이 아니라 같은 파일 캡처 경합(같은 tmp 이름) — 파일당 게이트 + 일련번호 |
| 2026-09-11T15:09:51+09:00 | #b1-anthropic-temperature | claude-code | ☐→x |  | accepts_sampling_params — 4.6 이하·Haiku 4.5·3.x 만 |
| 2026-09-11T15:09:57+09:00 | #b2-model-defaults | claude-code | ☐→x |  | llm_list_models + datalist 피커 · Sonnet 5 기본 · OpenAI max_completion_tokens |
| 2026-09-11T15:10:02+09:00 | #c1-notion-trigger | claude-code | ☐→x |  | 일지 상세 「Notion 으로」 — 토큰 없으면 비노출 |
| 2026-09-11T15:10:08+09:00 | #c2-journal-edit | claude-code | ☐→x |  | 본문 인라인 편집 + 다이제스트 내보내기 복귀 · compare_layers 커맨드 제거(export_digest 는 살림) |
| 2026-09-11T15:10:13+09:00 | #c3-acp-attention | claude-code | ☐→x |  | notify_agent_attention · tray.notify_agent 기본 켜짐 · 실기기 미확인 |
| 2026-09-11T15:10:21+09:00 | #d1-history-budget | claude-code | ☐→x |  | 예산은 이미 512MB 상수로 있었다 — 설정(64~8192MB)으로 노출. 삭제 파일의 히스토리는 복구 가치가 있어 그대로 둠 |
| 2026-09-11T15:10:26+09:00 | #d2-embed-cache-cleanup | claude-code | ☐→x |  | prune_retired_model_caches — 기동 스레드 |
| 2026-09-11T15:10:31+09:00 | #d3-ls-orphans | claude-code | ☐→x |  | workspacePrune.ts — 프로젝트 목록을 받는 자리에서 |
| 2026-09-11T15:10:36+09:00 | #d4-hook-inbox-rotate | claude-code | ☐→x |  | compact_inbox — 전부 소비 + 1MB 초과면 비움 |
| 2026-09-11T15:10:41+09:00 | #e1-update-periodic | claude-code | ☐→x |  | 하루 1회 + 깨어날 때(6h) · 배너 닫기는 버전별 |
| 2026-09-11T15:10:46+09:00 | #e2-plan-move-item | claude-code | ☐→x |  | move_item op + 문서 뷰 행 드래그 (행=앞, 단계 머리=끝) |
| 2026-09-11T15:10:52+09:00 | #e3-nav-history | claude-code | ☐→x |  | WorkspaceContext 대신 관찰 기반 useNavHistory (800줄 래칫) · 치트시트에 행 추가 |
| 2026-09-11T15:10:58+09:00 | #e4-single-instance | claude-code | ☐→x |  | tauri-plugin-single-instance — 두 번째 인스턴스는 show_main 뒤 종료 (dev↔설치본도 같은 identifier) |
| 2026-09-11T15:11:03+09:00 | #f1-claude-md | claude-code | ☐→x |  |  |
| 2026-09-11T15:11:07+09:00 | #f2-wiki-shortcuts | claude-code | ☐→x |  |  |
| 2026-09-11T15:11:13+09:00 | #f3-bump-script | claude-code | ☐→x |  | scripts/bump-version.mjs + 실제 파일 dry-run 테스트 · RELEASE.md §1 |
<!-- oculpm:plan-log end -->
