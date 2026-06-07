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

---

## 작업 일지 (PR-JR + PR-FIX B3/B4)

**결정 D1:** 카드에서 파일 목록 제거, 카드 클릭 → 풍부한 2-pane 모달.

- **#1 카드 정리** — `src/features/oculpm/JournalCardV2.tsx`: 파일 칩·`getJournalEntry` 하이드레이션·`fmtBytes` 제거. 카드 = trigger/agent/time/title/status/tags. 본문 클릭 → `EntryDiffModal` 열기. foot 에 "변경 diff 화면"(라이브) 버튼만 유지(`onOpenDiff`). → `+0` 버그 자연 해소.
- **#6 서술 + #5 동일이름 + #2 잘림** — `src/features/oculpm/EntryDiffModal.tsx` 2-pane 재작성:
  - 좌(`<aside overflow-auto>`): 메타(trigger/agent/time/tags) + **변경된 파일 목록**(`frontmatter.files_touched`, op 배지 `dstatus A/M/D`, `disambiguateLabels` 로 동일이름 구분, 삭제 파일은 "삭제됨") + **일지 서술**(`detail.body_markdown` → `Markdown`).
  - 우(`<section flex-col>`): 기록된 파일 탭 + `.diff-code`(단일 스크롤러) + `PatchView`.
  - **#2 해소**: 각 pane 이 독립 bounded 스크롤(`flex-1 min-h-0` + `overflow-auto`), header/탭은 `shrink-0` → 큰 파일에서 상단 안 잘림.
  - **후속 fix (도그푸딩 재발견)**: 카드가 `.page.fade-in`(transform 애니메이션, `primitives.css`) 안에 있어 `position:fixed` 모달이 그 *containing block* 에 갇힘 → 툴바 아래로 밀리고 헤더(닫기 버튼 포함)가 잘리는 회귀. **`createPortal(…, document.body)`** 로 모달을 body 루트에 렌더해 해결. 테마는 `data-theme` 가 `<html>` 에 설정되므로 포털 후에도 유지(`SettingsContext`).
  - 헬퍼 `disambiguateLabels(paths)`: 같은 basename 이 둘 이상이면 마지막 2 세그먼트, 그래도 충돌 시 전체 경로.
  - CSS: `src/styles/screens.css` `.entry-narrative` (좁은 좌 pane 에서 Markdown 컨테인).
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
