---
oculpm_plan: v1
id: polish-round
title: "완성도 라운드 — 결함 · UX 프리미티브 · 여정 · 성능 · 설계 · 토큰"
status: active
created: 2026-08-30
updated: 2026-08-30
owner: claude-code
---

v2.24.0 직후의 완성도 감사(5 렌즈: UX 일관성 · 핵심 여정 · 성능 · 설계 정교함 · 시각 디자인 시스템)를 실행한다.
순서는 사용자 체감과 위험 순 — 폴리시로 위장한 결함부터, 그다음 화면 14개에 공통으로 먹는 프리미티브, 여정, 성능, 설계, 토큰.
`commands/window.rs` 는 병렬 세션(drag-and-drop-round) 영역이라 건드리지 않는다.

## Phase 0 — 폴리시가 아니라 결함 {#defects}
- [x] plan-log 파서가 `agent`·`시각`·`에이전트` 를 포함한 데이터 행을 헤더로 버림(이 저장소 22행 소실) — 첫 셀이 숫자로 시작하면 데이터, `\|` 이스케이프 왕복 (`planner/parse.rs:759`, `plan_edit.rs render_row`) {#planlog-parser}
- [x] 워처 상태 표시기가 항상 "감시 꺼짐" — `get_status.watcher_state` 를 실제 워처 상태로 (`manager/lifecycle.rs:190`, `TerminalSurface.tsx:998`) {#watcher-state-truth}
- [x] ⌘K 팔레트가 Esc 로 안 닫히고 포커스 복원 없음 — `useModalBehavior` 얹음 (`CommandPalette.tsx`) {#palette-esc}
- [x] 터미널 「일지로 남기기」·팔레트 「수동 일지」가 일지 화면 밖에서 무반응 — 셸이 요청을 붙들고 일지 화면으로 이동(`holdManualEntryRequest`) (`journalCompose.ts`, `ShellV2.tsx`) {#compose-anywhere}
- [x] config.toml 죽은 키 7개 제거(구조체·기본값·UI 토글·i18n) — `auto_close_on_*`·`crash_recovery_grace_minutes`·`auto_detect_on_open`·`auto_sync_adapters`·`batch_max_events`·`journal_committed` (`spec.rs`, `OculpmSettings.tsx`) {#dead-config-keys}
- [x] 미정의 CSS 토큰 `--bg-2`·`--bg-elevated` → `--bg-card` (`code.css:2100`, `skills.css:405`) {#undefined-tokens}
- [x] Today 마운트마다 git 프로세스 ~15개 — deps 이중 조회 제거 + `primary_repo` 30초 캐시 + git 커맨드 4종 `spawn_blocking` (`useTodayMonitor.ts:99`, `git.rs:282`, `commands/git.rs`) {#today-git-fanout}

## Phase 1 — UX 프리미티브 (14화면 공통) {#ux-primitives}
- [x] `ErrorCard`(오류+재시도) 공용화 → 재시도 없던 5화면(논의·회고·검색·문서·Diff) 적용 {#error-card}
- [x] 로딩 규칙 통일 — 목록은 `SkeletonList`, 단일 대기는 `OculSpinner`; 평문 로딩(문서·스킬·코드·설정) 제거, 영문 하드코딩 3곳 i18n {#loading-rule}
- [x] `useConfirm()` 하나로 파괴 확인 통일 + 무확인 3곳(대화 삭제·설정 초기화·Notion 토큰 제거) 확인 추가, `window.confirm` 제거 {#confirm-unify}
- [x] 툴바 제목은 `t(nav.*)` 로 — Planner 하드코딩·Diff/AI 불일치 정정, 새로고침 아이콘은 액션 묶음 첫 자리 규칙 {#toolbar-rule}
- [x] 용어 통일 — 검증/검토/확인(verified_by_user=확인), 일지/기록, 재구축/재인덱싱; 팔레트 중복 설정 항목 제거 {#terminology}
- [x] 설정 탭 딥링크 API(`openSettings(tab)`) + 틀린 경로 문구 3곳을 버튼으로 (`ko.ts:2461`, `:2136`, `:1312`, `JournalMissingCard`) {#settings-deeplink}

## Phase 2 — 여정 {#journeys}
- [ ] 첫 init 1회 카드 — 무엇을 썼는지(AGENTS.md 블록·.gitignore·.oculpm/) + 커밋 안내; `notActive` 에 재시도 버튼; 죽은 "EmptyToday 활성화 카드" 문구 정정 (`ProjectTab.tsx:100`, `TodayScreenV2.tsx:190`) {#first-run-card}
- [ ] 마지막 탭 ⌘W → 앱 종료 전 실행 중 PTY/ACP 확인 다이얼로그 (`tray.rs:480` 경로는 window.rs 밖에서) {#last-tab-confirm}
- [ ] 진단 탭 "닥터"화 — 워처·락·ACP·키·마지막 색인 시각 한 표 + 최근 무결성 경고 목록, 토스트에 "진단에서 보기" {#doctor-tab}
- [ ] "색인 없음"을 "결과 없음"으로 말하던 검색·코드맵 분기 + 임베딩 배너 닫기/다시 받기 {#index-empty-state}
- [ ] ⌘/ 단축키 치트시트(navRegistry·메뉴·화면별 로컬키 자동 생성) + 업데이트 후 1회 What's-new 카드 (`lastSeenVersion`) {#cheatsheet-whatsnew}
- [ ] 새 기록 토스트에 "열기" 액션, diff 그룹 헤더에 검증 토글, Today 에 회고 진입점 {#today-review-loop}

## Phase 3 — 성능 {#performance}
- [ ] i18n 사전 분리 — 진입 청크의 45%(ko+en 정적) → 해석된 언어만 로드 (`i18n/index.ts`) {#i18n-split}
- [ ] `SettingsOverlay`→`SettingsPanel`, `StartTab`→`GreenfieldWizard` lazy 복원 {#lazy-restore}
- [ ] 인덱싱 진행률 스로틀(Rust ≥100ms) + 컨텍스트 밖 스토어 (`project.rs:208`, `ProjectTab.tsx:195`) {#index-progress}
- [ ] vec0 `project_id PARTITION KEY` + 색인 정리 후 VACUUM, KNN 전역 스캔 제거 (`code_index.rs:161`, `002_chunks.sql`) {#vec-partition}
- [ ] `oculpm_workday_brief` 날짜별 왕복 → 단일 `workday IN` 쿼리; HonestyAudit 워크데이 단위 비교 {#brief-single-query}
- [ ] 초당 틱 단일 스토어(`useSecondTick`) + 워처 diff 캡처의 git 호출 묶기 {#tick-and-diff-batch}

## Phase 4 — 설계 {#design-rigor}
- [ ] `SessionId` 뉴타입(Watcher/Manual/Mcp/GitBackfill) + `current_workday` 커맨드 하나로 workday 파생 7곳 통일 {#session-id-newtype}
- [ ] 오류 규약 — 백엔드 `AppError{code,detail}`(UI 언어 금지) + 프런트 `invoke` 단일 래퍼, `bindings` 직접 import lint {#error-convention}
- [ ] WorkspaceContext 3분할(ProjectWorkspace/UiPrefs/Runtime) + 셀렉터; 터미널 탭 목록 lost-update 제거 {#workspace-split}
- [ ] 이벤트 보강 — `OculpmWorkdayChanged`·`AcpSessionChanged`, 죽은 `OculpmAgentsTemplateChanged` 정리, `OculpmDataArea` 에 Rules/Retro {#events-over-polling}
- [ ] 버스 7종 → `createStore/createIntentSlot` 헬퍼; 헬퍼 중복(relativeTime×6·formatBytes×3) 단일화; `oculpm/*`→`commands::*` 역의존 3곳 이동 {#bus-and-helpers}

## Phase 5 — 디자인 토큰 {#design-tokens}
- [ ] 상태색 토큰 `--ok/--warn/--danger/--info`(+soft, light/dark/프리셋) + fallback 24곳 치환 {#status-tokens}
- [ ] 글자크기 7단 스케일 + z-index 7단 + 모션 `--ease-out` 단일화·원시값 55곳 치환 {#scale-tokens}
- [ ] 아이콘버튼 14벌·칩 11벌 → `.iconbtn` 3크기·`.chip` 수정자로 흡수, 프리미티브를 전역 `styles/primitives.css` 로 {#primitive-merge}
- [ ] App.css 죽은 토큰·클래스 ~120줄 + `@fontsource/eb-garamond` 제거, 프로젝트 색·Claude 코랄 단일 정의 {#dead-css}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-30T15:11:00+09:00 | #planlog-parser | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1511_bug_planlog-parser-dropped-rows.md | 첫 셀 숫자 판정 + split_table_cells(\|) + render_row 이스케이프. 실데이터 행 회귀 테스트 |
| 2026-08-30T15:11:00+09:00 | #watcher-state-truth | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1511_bug_watcher-state-always-off.md | get_status 가 entry.watcher.status().state |
| 2026-08-30T15:11:00+09:00 | #palette-esc #compose-anywhere | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1511_bug_palette-esc-and-compose-anywhere.md | useModalBehavior 를 팔레트에 · ShellV2 가 요청을 붙들고 일지로 이동 |
| 2026-08-30T15:11:00+09:00 | #dead-config-keys #undefined-tokens | claude-code | ☐→[x] | .oculpm/journal/20260830/Chores/1511_chore_dead-config-keys-and-undefined-tokens.md | 키 7개 제거(journal_committed 포함) · --bg-card |
| 2026-08-30T15:11:00+09:00 | #today-git-fanout | claude-code | ☐→[x] | .oculpm/journal/20260830/Bugs/1511_bug_today-git-process-fanout.md | deps 정리 + primary_repo 30s 캐시 + spawn_blocking ×4 |
| 2026-08-30T15:26:00+09:00 | #error-card #confirm-unify #settings-deeplink | claude-code | ☐→[x] | .oculpm/journal/20260830/Features_to_add/1526_feature_error-card-confirm-settings-deeplink.md | ErrorCard 8화면 · useConfirm(window.confirm 0, 무확인 3곳 확인) · openSettings(tab) 딥링크 |
| 2026-08-30T15:26:00+09:00 | #loading-rule #toolbar-rule #terminology | claude-code | ☐→[x] | .oculpm/journal/20260830/Chores/1526_chore_loading-rule-toolbar-terminology.md | SkeletonList/OculSpinner 규칙 · t(nav.*) 제목 · 확인/인덱스 재구축 |
<!-- oculpm:plan-log end -->
