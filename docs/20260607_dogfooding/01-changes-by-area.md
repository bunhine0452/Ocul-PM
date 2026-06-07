<!-- schema_version: 1 -->
# 01 — 영역별 변경 내역 (구현 기록)

> 각 항목: 원인 → 수정 → 근거(`file:function`). 라인 번호는 변동되므로 함수/심볼 기준.

---

## 사이드바 (PR-SB)

접기 + 호버 노출. 상태는 `WorkspaceContext` 가 소유(영속), 호버는 휘발.

- 상태: `WorkspaceState.sidebarCollapsed` 추가 (`src/contexts/WorkspaceContext.tsx`, 인터페이스 + `DEFAULT_STATE`). `persistToStorage` 가 휘발 필드만 제외하므로 자동 영속.
- 셸: `src/features/shell/ShellV2.tsx` — `collapsed`(영속) + `hovering`(useState). `toggleSidebar`. 접힘 시 좌측 `.side-hover-zone`(onMouseEnter→hovering) 렌더, `Sidebar` 에 `onMouseLeave` 전달. `appClass` 로 `.app` 에 `sidebar-collapsed`/`sidebar-hover` 토글.
- 컴포넌트: `src/components/Sidebar.tsx` — brand row 에 `.side-collapse-btn`(`PanelLeft` 아이콘). props `onToggleCollapse`/`collapsed`/`onMouseLeave`.
- 아이콘: `src/components/Icons.tsx` — `PanelLeft` 추가.
- CSS: `src/styles/shell.css` — `.app{position:relative}`, `.app.sidebar-collapsed{grid-template-columns:1fr}`, `.sidebar` absolute + `translateX(-100%)` transition, `.sidebar-hover .sidebar{translateX(0)}`, `.side-hover-zone`, `.side-collapse-btn`.
- **후속 fix (2차 — macOS traffic lights)**: 접힘 시 콘텐츠가 x=0 까지 차서 toolbar 제목이 신호등 아래로 겹침. `ShellV2` 가 `.app` 에 `is-mac` 클래스 부여, `src/styles/shell.css` `.app.is-mac.sidebar-collapsed .toolbar{padding-left:84px}` 로 신호등 폭 확보.

---

## 작업 일지 (PR-JR + PR-FIX B3/B4)

**결정 D1:** 카드에서 파일 목록 제거, 카드 클릭 → 풍부한 상세 화면.

- **#1 카드 정리** — `src/features/oculpm/JournalCardV2.tsx`: 파일 칩·`fmtBytes` 제거. 카드 = trigger/agent/time/title/status/tags. 본문 클릭 → `onOpenEntry`(상세 화면). foot 에 "변경 diff 화면"(라이브) 버튼만 유지(`onOpenDiff`). → `+0` 버그 자연 해소.
- **#6 서술 + #5 동일이름 + #2 잘림** — 처음엔 2-pane **모달**(`EntryDiffModal`)로 구현했으나, 카드가 `.page.fade-in`(transform, `primitives.css`)의 *containing block* 에 갇혀 `position:fixed` 가 툴바 아래로 밀리고 헤더가 잘리는 문제 + 모달 UX 불만 → **전용 상세 화면 `EntryDetailView` (마스터-디테일)** 로 전환:
  - `src/features/oculpm/EntryDetailView.tsx` — 콘텐츠 영역을 가득 채움. `Toolbar`(뒤로가기 `leading` + 제목 + 메타 + "변경 diff 화면") + 2-pane.
  - 좌(`.entry-detail-side`): 태그 + **변경된 파일 목록**(`files_touched`, op 배지, `disambiguateLabels` 동일이름 구분, 삭제="삭제됨") + **서술**(`stripLeadingTitle` 로 본문 첫 줄(제목) 중복 제거 후 `Markdown`).
  - 우(`.entry-detail-main`): 기록된 파일 탭 + `.diff-code`(단일 스크롤러) + `PatchView`.
  - `src/features/oculpm/JournalScreenV2.tsx` 가 `detailEntry` 상태로 타임라인 ↔ 상세를 전환(뒤로가기로 복귀). `JournalCardV2` 는 `onOpenEntry` 로 호출. 모달(`EntryDiffModal.tsx`)·`createPortal` 경로는 **삭제**.
  - `Toolbar` 에 `leading` prop 추가(`src/components/Toolbar.tsx`).
  - **#2 잘림 해소**: 오버레이가 아니라 화면 자체라 containing-block 문제 자체가 사라짐. 각 pane 독립 스크롤.
  - **#2b 제목 중복**: 일지 본문 첫 줄이 곧 제목(`[x] …`)이라 헤더와 중복 → `stripLeadingTitle(body, title)` 로 제거.
  - 헬퍼 `disambiguateLabels(paths)`: 같은 basename 이 둘 이상이면 마지막 2 세그먼트, 그래도 충돌 시 전체 경로.
  - CSS: `src/styles/screens.css` `.entry-detail*` + `.entry-narrative`.
- **후속 (3차 — 가독성)**:
  - **구문 강조**: diff 각 줄을 marker(+/-/space)와 코드로 분리, `highlight.js/lib/common` 으로 코드만 하이라이트(`langFromPath` 로 언어 감지). 토큰 색은 `.hljs-*` 규칙(라이트/다크, `screens.css`)로 정의 — diff 와 Markdown 코드블록 공용. (그동안 `rehype-highlight` 가 클래스만 달고 테마 CSS 가 없어 무색이었음.) `PatchView` 에 `lang` prop, `DiffScreenV2`·`EntryDetailView` 가 전달.
  - **파일명 바**: 우 pane 의 파일경로를 스크롤되는 `.hunk-head` 대신 **고정 바 `.entry-detail-fname`**(shrink-0)로 분리 → 가로 스크롤 시 헤더가 짧게 잘리던 문제 해소.
  - **Markdown 가독성**: `.entry-narrative` 강화 — heading 위계/여백, 불릿 커스텀(accent dot), inline `code` 칩, blockquote/hr/table, 줄간격 1.72, 링크 등.
- **#3 단일행 diff** (`PR-FIX B4`, diff 화면과 공유) — `src/styles/screens.css`: `.dl-x{white-space:pre}`, `.diff-content{min-width:max-content}`, `.dl{grid-template-columns:44px minmax(max-content,1fr); min-width:100%}`. `src/features/diff/PatchView.tsx` 가 hunks 를 `.diff-content` 래퍼로 감쌈 → `.diff-code` 가로 스크롤.
- **#4** — 코드 변경 없음(00 §4 참조).

---

## Planner (PR-PLN6)

**결정 D2:** 수동 완료·잠금. 잠금 = frontmatter `status` 가 `active` 가 아님(`done`/`archived`).

- 순수 마크다운 수술: `src-tauri/src/oculpm/planner/plan_edit.rs::set_plan_status` — frontmatter `status:` 재작성(+`updated:` 갱신, 없으면 `title:` 뒤 삽입). 단위테스트 2종.
- 커맨드: `src-tauri/src/commands/plan.rs::plan_set_status`(`active`/`done`/`archived` 검증). 
- **쓰기 가드**: 동 파일 `is_plan_locked` + `LOCKED_MSG`. `plan_apply_edit`·`plan_ai_refresh` 가 비-active plan 이면 거부.
- 등록: `src-tauri/src/lib.rs` (import + `collect_commands!`).
- AGENTS.md: `src-tauri/src/oculpm/agents/templates/master_ko.md.tpl` §7 규칙에 "완료·잠금된 plan 은 절대 수정 말 것 — 새 plan 에서 진행" 추가.
- 프론트: `src/features/planner/PlannerScreenV2.tsx` — `setPlanLock`, `locked = status!=="active"`. 잠금 시 AI 갱신/항목추가/상태토글/완료? 비활성. PlanBody 헤더에 "완료·잠금"/"잠금 해제" 버튼 + 🔒 배지 + 읽기전용 안내. plan 칩 정렬(active 먼저)·🔒. (#2 다중 plan 내비는 기존 칩 강화.)

---

## 변경 diff (PR-FIX + PR-DF-GROUP)

- **#1 삭제 파일** — `src-tauri/src/commands/diff.rs::snapshot_diff`: `fs::read` 가 `NotFound` 면 디스크 내용을 빈 것으로 보고 전삭제 patch 생성(그 외 IO 에러만 전파). 프론트 `src/features/diff/DiffScreenV2.tsx`: `snapshots_unavailable` + op=="D" 면 `readProjectFile` 건너뛰고 `DiffBody` 가 "삭제됨" 안내(`deleted` prop).
- **#2 임시/캐시·redacted** — 백엔드 `src-tauri/src/oculpm/watcher.rs::is_self_suppressed`: basename 에 `!` 포함 시 억제(테스트 추가). 프론트 `src/contexts/WorkspaceContext.tsx` `oculpmFileChanged`: `**redacted/sensitive**` 시작 path 는 `recentChanges` 에 미추가.
- **#4 모두 검토 완료** — `DiffScreenV2`: `onMarkAllReviewed`(모든 `recentChanges` → `diffReadPaths`), Toolbar 버튼 + `allReviewed` 비활성.
- **#3 그룹화** — 결정 D3(일지 + plan):
  - 역인덱스: `src-tauri/src/oculpm/cache.rs::JournalCache::group_changes` — `oculpm_journal_files`(file_path 별 최신 일지) + `oculpm_plan_item_updates.journal_ref LIKE '%'||relative_path`(→ plan 항목). DTO `ChangeGroup`/`ChangePlanRef`. 미귀속 파일은 `entry_path: None` 버킷, 그룹은 최신순.
  - 커맨드: `src-tauri/src/commands/oculpm.rs::oculpm_group_changes` + `lib.rs` 등록.
  - UI: `DiffScreenV2` 좌 패널 — `groups` 로드(pathKey 변경 시), 일지 헤더(제목·날짜·plan 칩 `TargetIcon`) 아래 파일 묶음. 실패 시 평면 목록 fallback. 일지 제목 클릭 → `onOpenEntry`(ShellV2 가 journal 화면으로). CSS `.diff-group*`.
