# 05. 구현 체크리스트 — PR-UI DoD · 회귀 보호 · 미해결 결정

> 본 문서의 위상: Final UI Update 라운드의 *진행 추적표*. 각 PR-UI 의 머지 시점에 본 문서의 해당 행이 ✅ 로 갱신된다.
> Lite-W6 의 [`../07-implementation-checklist.md`](../07-implementation-checklist.md) 와 같은 형식.

---

## 0. 시작 전 잠금 항목 (확정 완료 — 2026-05-31)

> **상태**: 본 라운드의 시각 SSOT 가 [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업이므로 *대부분의 결정은 목업 자체* 가 보유.
> 본 §0 는 *목업이 답하지 못한* / *코드 측 정책* 의 잠금만 다룬다.

### 0.1 [`01-ia-and-shell.md`](./01-ia-and-shell.md) §9

- [x] 사이드바 폭 **248px** (Lite-W6 의 56px 결정 reversal)
- [x] IA = **메인 4 + 도구 3 + 푸터 2**
- [x] 단축키 = ⌘1~⌘7 + ⌘, + 기존 ⌘K/⌘P/⌘R/⌘N/⌘F 유지
- [x] ⌘B/⌘J/⌘⇧J/⌘⇧\\ 폐기
- [x] AiOverlay (⌘\) **유지** (보조 통로)
- [x] Toolbar 52px / 백드롭 블러 18px
- [x] 프로젝트 스위처 사이드바 상단
- [x] 다크 토글 푸터 nav-item

### 0.2 [`02-screen-specs.md`](./02-screen-specs.md) §9 (WorkspaceContext 키)

- [x] schema v2 → v3 마이그레이션 *deletion-only* + neutral defaults *(write/deletion 은 PR-UI 7 — PR-UI 0 은 read-compat default 만)*
- [x] `activeView: "code"` → `"diff"` 자동 매핑 *(PR-UI 7 의 write 마이그레이션에서)*
- [x] 신규 키 **11 종** WorkspaceContext 영속 (12 종 중 `themeMode` 제외 — Decision A 로 SettingsContext 소유). read-compat default 는 PR-UI 0 에서 추가됨
- [x] **테마 = SettingsContext SSOT (Decision A, 2026-05-31)** — `themeMode` / `localStorage["oculpm-theme"]` 별도 store *없음*. SettingsContext 가 `.dark` class + `data-theme` 속성을 *동시* 적용. 영속은 SQLite (localStorage 미사용 → lint 무관)

### 0.3 [`03-design-system.md`](./03-design-system.md) §11

- [x] CSS 파일 분리 5 종 (`tokens/base/shell/primitives/screens`)
- [x] Tailwind `theme.extend.colors` **모두 삭제** (CSS variable 로 단일화)
- [x] `data-theme="dark"` 속성 토글 (class 분기 제거)
- [x] axe-core 자동 검사가 PR-UI 1 부터 DoD
- [x] `--text-3` 사용처 grep 점검 (메타 외 사용 0)
- [x] 아이콘 단일 출처 = `src/components/Icons.tsx` 가 lucide-react re-export only
- [x] 자체 SVG 정의 **0 개**

### 0.4 [`04-removal-and-migration.md`](./04-removal-and-migration.md) §5

- [x] `src/legacy/` 보존 — **영구**
- [x] AiOverlay 단축키 — **⌘\ 유지** (충돌 시 PR-UI 5 에서 ⌘⇧A 대체 검토)
- [x] 터미널 focus 시 글로벌 ⌘1~⌘7 — **글로벌 우선**, 터미널 내 탭 전환은 ⌘⌥1~9 로 대체
- [x] 다크 시스템 감지 — **첫 마운트 1 회만** (이후 사용자 토글 우선)
- [x] Code Graph — `src/legacy/code/Graph/` 로 이동, v1.1 검토

### 0.5 본 §0 결정 요약 (한 화면)

| 결정 | 잠금 값 |
|---|---|
| 시각 SSOT | [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업 |
| 사이드바 폭 | 248px (Lite-W6 §6 의 56px reversal) |
| 메인 IA | Today / 작업 일지 / 변경 diff / Planner |
| 도구 IA | 코드 검색 / 터미널 / AI 패널 |
| 푸터 | 다크 토글 / 설정 |
| 단축키 신설 | ⌘4 ~ ⌘7 |
| 단축키 폐기 | ⌘B / ⌘J / ⌘⇧J / ⌘⇧\ |
| AiOverlay | ⌘\ 유지 (보조) |
| 시각 토큰 시스템 | `--*` CSS variable (Tailwind colors 제거) |
| 다크 모드 토글 | `data-theme="dark"` 속성 (+ 레거시 `.dark` class 병행). 테마 SSOT = **SettingsContext (SQLite)**, `localStorage["oculpm-theme"]` *미사용* — Decision A |
| 시스템 다크 감지 | 첫 마운트 1 회 (SettingsContext `theme: "system"`) |
| 아이콘 | Lucide 단일, strokeWidth 1.75 기본 |
| Code Workbench | `src/legacy/` 영구 이동 (PR-UI 7) |
| WorkspaceContext schema | v2 → v3 *deletion-only* 마이그레이션 (write 는 PR-UI 7) |
| `ui_v2` feature flag | `src/lib/uiFlags.ts` (settings KEYS 레지스트리 *밖* — Decision B). PR-UI 0 도입(기본 OFF), PR-UI 7 영구 ON + 제거 |
| 시각 회귀 잠금 | 8 화면 × 2 테마 = 16 스냅샷 (PR-UI 0 베이스라인) |
| 카피 용어 사전 | [`UI-MASTER-PROMPT.md`](./UI-MASTER-PROMPT.md) §6 |

위 모든 결정이 잠겼으므로 **PR-UI 0** 진입 가능.

### 0.6 PR-UI 0 진행 중 추가 결정 (2026-05-31 잠금)

> §5 운영 흐름에 따라 PR-UI 0 작업 중 확정된 결정. 본 §0 + §0.5 표에 이미 반영됨.

- **Decision A — 테마 SSOT 는 SettingsContext.** 문서 초안의 *신규 `ThemeContext.tsx` + `localStorage["oculpm-theme"]`* 안을 *reversal*. 현 코드의 테마 상태(`light`/`dark`/`system`)는 이미 `SettingsContext` 가 SQLite 로 소유·적용 중이었음. 별도 store 신설은 *이중 상태 + lint allowlist 추가* 비용만 발생. 대신 `SettingsContext` 의 테마 적용 effect 가 레거시 `.dark` class 와 신 `data-theme` 속성을 *동시* 토글하도록 확장 (한 줄). `tokens.css` 는 `[data-theme="dark"]` 를 키로 사용하므로 그대로 호환. 영향: §9 의 `themeMode` 키는 WorkspaceContext 에 *추가하지 않음* (12 → 11 종).
- **Decision B — `ui_v2` flag 는 settings 레지스트리 밖.** `no_feature_flags.test.ts` 가 `src/lib/settings.ts` 의 `feature_*` 행을 금지하므로, flag 를 `src/lib/uiFlags.ts` 의 모듈 const (`isUiV2Enabled()`) 로 구현. settings KEYS / WorkspaceContext 어느 영속 레지스트리에도 들어가지 않아 기존 테스트 green 유지. PR-UI 7 에서 모듈째 삭제.
- **토큰 격리 방식.** 신 `--accent`(녹색)가 레거시 `src/App.css` 의 `--accent`(크림)와 *이름 충돌*. 전역 `:root` import 시 flag-off UI 가 변색됨. 따라서 PR-UI 0 은 `src/styles/*.css` 를 *생성만* 하고 전역 import 는 PR-UI 1 (ui_v2 shell 스코프)로 미룸. `src/styles/index.css` 가 5 파일 번들 진입점.

---

## 1. Phase A — Foundation (3~4 일)

### PR-UI 0 — 회귀 보호 + 토큰 격리 + flag

| 체크 | 항목 |
|---|---|
| ☑ | `src/styles/tokens.css` — :root + [data-theme="dark"] 정의 ([`03-design-system.md`](./03-design-system.md) §1~§3 그대로) |
| ☑ | `src/styles/base.css`, `shell.css`, `primitives.css`, `screens.css` 파일 생성 (빈 + import only) + `index.css` 번들 진입점 |
| ☑ | ~~`src/contexts/ThemeContext.tsx` 신규~~ → **Decision A**: SettingsContext 가 `data-theme` 속성 토글 (신규 context 미신설, §0.6) |
| ☑ | `src/__tests__/theme_toggle.test.ts` — `data-theme` round-trip + 시스템 감지 |
| ☑ | `src/__tests__/ui_v2_flag.test.ts` — flag-on/off 분기가 *각각 현 코드와 동일* 렌더 |
| ☑ | `src/App.tsx` 의 `ui_v2` flag 분기 (`WorkspaceShell` seam, flag-off 100% 무변경 보장) |
| ☑ | `WorkspaceContext` schema 의 *읽기 호환만* (신규 키 11 종 default 추가, write 변화 없음) |
| ☑ | `pnpm typecheck` green |
| ☑ | `pnpm test` green (56 passed \| 3 todo) |
| ☑ | `pnpm lint` green |
| ☑ | `cargo test` green (0 failed) |
| ☑ | `pre-cut-PR-UI0` annotated git tag (commit `5bb1bff`) |

**선행 조건**: Lite-W6 PR0~PR10 ✅, PR12 미진입.

### PR-UI 1 — Sidebar / Shell / Theme

| 체크 | 항목 |
|---|---|
| ☐ | `src/components/Sidebar.tsx` — 248px (목업의 `.sidebar` 그대로) |
| ☐ | `src/components/Toolbar.tsx` — 52px |
| ☐ | `src/styles/shell.css`, `primitives.css` 채움 |
| ☐ | flag-on 시 신 Shell 마운트, flag-off 시 기존 100% 유지 |
| ☐ | `useGlobalShortcuts` 에 ⌘1~⌘7 + ⌘, 등록 (flag-on 분기) |
| ☐ | 사이드바 9 슬롯 클릭 → activeView 갱신 (화면은 임시 placeholder OK) |
| ☐ | 다크 토글 즉시 반영, *layout shift 0* (Layers 패널 비교) |
| ☐ | axe-core: 사이드바 a11y violations 0 |
| ☐ | 시각 회귀 스냅샷 *베이스라인 등록* (16 장) |

### PR-UI 7 의 *원자적* 정리 작업의 단축키 매트릭스 (사전 공개)

| 화면 | 글로벌 단축키 | 화면 내 단축키 |
|---|---|---|
| Today | ⌘1, ⌘K, ⌘P, ⌘R, ⌘N (수동 entry), ⌘, | — |
| 작업 일지 | ⌘2, ⌘K, ⌘P, ⌘N, ⌘F | j/k 이동 |
| 변경 diff | ⌘3, ⌘K, ⌘P, ⌘F | j/k 파일 이동 |
| Planner | ⌘4, ⌘K, ⌘N (새 목표) | — |
| 코드 검색 | ⌘5, ⌘K | ⌘F input focus, ⌘N reset |
| 터미널 | ⌘6, ⌘K | ⌘T 새 탭, ⌘W 닫기, ⌘⌥1~9 탭 전환 |
| AI 패널 | ⌘7, ⌘K, ⌘\ (오버레이 호출) | — |
| Settings | ⌘, | — |

위 표는 [`02-screen-specs.md`](./02-screen-specs.md) 의 화면별 §Interaction 과 lock-step.

---

## 2. Phase B — Screens (1~1.5 주, 병렬 가능)

### PR-UI 2 — Today 6-블록 대시보드

| 체크 | 항목 |
|---|---|
| ☐ | `src/features/today/TodayScreen.tsx` flag-on 분기 구현 |
| ☐ | `StatCard.tsx`, `MiniEntry.tsx`, `WeekChart.tsx`, `AgentBreakdown.tsx`, `NextTasks.tsx` 신규 |
| ☐ | `src-tauri/src/commands/oculpm.rs` 에 `get_today_brief`, `get_today_highlights` 추가 |
| ☐ | `tauri-specta` 바인딩 재생성 |
| ☐ | vitest: 4 stat 값 = backend 응답 |
| ☐ | vitest: 빈 journal → empty hint + AGENTS.md 안내 |
| ☐ | MiniEntry 클릭 → 작업 일지 focus highlight |
| ☐ | "오늘 변경 검토" primary → 변경 diff 화면 |
| ☐ | axe-core 0 violations |

### PR-UI 3 — 작업 일지 timeline

| 체크 | 항목 |
|---|---|
| ☐ | `src/features/oculpm/JournalScreen.tsx` 신규 |
| ☐ | `JournalEntryCard.tsx` 의 시각만 `.jcard` 톤으로 갱신 (구조 보존) |
| ☐ | scope-chip 6 종 + filter 영속화 (`WorkspaceContext.journalFilter`) |
| ☐ | route.params.focus 시 ring-highlight 1.6s |
| ☐ | ⌘F in-page 검색 (title + summary substring) |
| ☐ | ⌘N → ManualEntry 모달 동작 (Lite-W6 의 기존 컴포넌트 재사용) |
| ☐ | axe-core 0 violations |

### PR-UI 4 — 변경 diff 전용 화면

| 체크 | 항목 |
|---|---|
| ☐ | `src/features/diff/DiffScreen.tsx` 신규 wrapper |
| ☐ | `DiffFileList.tsx`, `DiffMain.tsx` 신규 |
| ☐ | 기존 `LocalDiffView.tsx` 내부 로직 *무변경* (git/snapshot 분기) |
| ☐ | 통합/분할 토글 + 영속화 (`WorkspaceContext.diffMode`) |
| ☐ | 외부 에디터 열기 (Settings 의 명령) 동작 |
| ☐ | "검토 완료" → diffReadPaths 갱신 |
| ☐ | 기존 회귀 테스트 모두 green |
| ☐ | axe-core 0 violations |

---

## 3. Phase C — Tools (3~4 일)

### PR-UI 5 — 도구 4 화면 일괄 + Planner

| 체크 | 항목 |
|---|---|
| ☐ | `src/features/search/SearchScreen.tsx` 신규 — semantic/symbol/text scope |
| ☐ | `src/features/terminal/TerminalScreen.tsx` 신규 — 탭 시스템 |
| ☐ | `src/features/chat/AiPanelScreen.tsx` 신규 — 모델 칩 + thread |
| ☐ | `src/features/planner/PlannerScreen.tsx` 시각 갱신 (구조 보존) |
| ☐ | AiOverlay ↔ AiPanelScreen *thread state 공유* 확인 |
| ☐ | 터미널 탭 추가/닫기/전환 |
| ☐ | flag-on 시 `TerminalDock.tsx`, `SidePanel.tsx` 마운트 *안 함* |
| ☐ | ⌘B/⌘J/⌘⇧J 단축키 flag-on 시 비활성 |
| ☐ | axe-core 0 violations (각 화면) |

### PR-UI 6 — Settings 재구성

| 체크 | 항목 |
|---|---|
| ☐ | Toolbar + section-title + `.card.set-section` 시각 정렬 |
| ☐ | 외부 에디터 명령 input 신설 (디폴트 `code "%path"`) |
| ☐ | 다크/라이트 scope-chip 동작 (ThemeContext 와 동기화) |
| ☐ | API 키 row 의 keyring 상태 chip |
| ☐ | 데이터 폴더 열기 / 인덱스 재구축 / WorkspaceContext 초기화 액션 |
| ☐ | About 섹션 (버전 / 빌드 해시) |
| ☐ | axe-core 0 violations |

---

## 4. Phase D — Cleanup (2~3 일)

### PR-UI 7 — Code Workbench 잔재 제거 + Flag off

**주의**: 이 PR 머지는 *복귀 불가능*. 머지 전 2 일 dogfood 게이트 필수.

| 체크 | 항목 |
|---|---|
| ☐ | 2 일 dogfood 종료 + *치명적 회귀 0 건* 사인-오프 |
| ☐ | `src/legacy/` 디렉토리 생성 + 다음 파일 이동: |
| ☐ | &nbsp;&nbsp;`CodeWorkbench.tsx`, `AiWorkbench.tsx`, `TerminalDock.tsx`, `SidePanel.tsx` |
| ☐ | &nbsp;&nbsp;옛 `FileExplorer.tsx` (DiffScreen 이 사용하는 부분 분리 후) |
| ☐ | &nbsp;&nbsp;Code Graph 관련 파일 → `src/legacy/code/Graph/` |
| ☐ | `tsconfig.json` 의 `exclude` 에 `src/legacy/**` 추가 |
| ☐ | `WorkspaceContext.tsx` schema v3 *write 활성화* + v2→v3 마이그레이션 함수 적용 |
| ☐ | 기존 v2 키 (`codeSubTab`, `bottomDrawerTab`, `layoutMode`, `splitRatio`, `sidePanelOpen`) 제거 |
| ☐ | `useGlobalShortcuts.ts` 에서 ⌘B/⌘J/⌘⇧J/⌘⇧\\ 핸들러 제거 |
| ☐ | `App.tsx` 의 옛 `Workspace`, `PRIMARY_NAV`, `CODE_SUB_NAV` 제거 |
| ☐ | `ui_v2` flag 의 *모든 분기 코드 제거* — flag 변수 자체 삭제 |
| ☐ | grep `CodeWorkbench\\|AiWorkbench\\|TerminalDock\\|SidePanel\\|codeSubTab\\|bottomDrawerTab\\|layoutMode\\|splitRatio\\|sidePanelOpen` → **0** (legacy 제외) |
| ☐ | grep `ui_v2` → **0** |
| ☐ | grep `dark:` (Tailwind variant) → **0** |
| ☐ | grep `theme.extend.colors` 의 사용처 → **0** (config 본문에서) |
| ☐ | grep `classList.toggle\\("dark"\\)` → **0** |
| ☐ | `pnpm typecheck` / `pnpm test` / `pnpm lint` green |
| ☐ | `cargo test` green |
| ☐ | 시각 회귀 스냅샷 16 장 검수 (목업과 일치) |
| ☐ | `pre-cut-PR-UI7` annotated git tag (rollback 보존) |

이 PR 머지 후 **Lite-W6 PR12 (배포 번들링) 진입** 가능.

---

## 5. 운영 — PR-UI 진행 중 새 결정의 흐름

본 라운드 진행 중 새 결정이 발생하면:

1. PR 안에서 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 (본 §) 에 *새 항목 추가*.
2. 영향 받는 후속 문서 (§00~§04) 의 *동일 PR* 에서 동기화.
3. 본 §의 *결정 요약 한 화면* (§0.5) 도 갱신.

이 3 단이 *한 PR 내* 에서 끝나지 않으면 결정은 *잠금 안 됨* — 후속 PR 에서 다른 결정이 등장하면 우선순위 충돌.

---

## 6. 비상 — 회귀 발생 시

| 단계 | 처리 |
|---|---|
| PR-UI 0~5 중 회귀 | `ui_v2` flag OFF + 해당 PR revert. 사용자 영향 0. |
| PR-UI 6 회귀 | Settings 만 영향. flag OFF 로 기존 SettingsPanel 복귀. |
| PR-UI 7 머지 후 회귀 | `pre-cut-PR-UI7` 태그로 cherry-pick / hard reset. WorkspaceContext v3 → v2 *역 마이그레이션은 없음* — 사용자 영속 state 의 신 키만 *무시*. |

PR-UI 7 머지 후 24h 안에 치명적 회귀 발생 시 *역 마이그레이션 함수* 를 hotfix 로 추가하는 것을 검토. 그 전엔 *flag-on 사용자만* 의 회귀 — Lite-W6 cleanup 코드는 이미 legacy 로 이동했으므로 *현 사용자가 본 화면 = ui_v2*.

---

## 7. 진행 상태 (2026-05-31 작성 시점)

| PR-UI | 상태 | 머지 해시 |
|---|---|---|
| 0 — Foundation | ✅ done | `5bb1bff` |
| 1 — Sidebar/Shell/Theme | ⬜ pending | — |
| 2 — Today | ⬜ pending | — |
| 3 — 작업 일지 | ⬜ pending | — |
| 4 — 변경 diff | ⬜ pending | — |
| 5 — 도구 4 + Planner | ⬜ pending | — |
| 6 — Settings | ⬜ pending | — |
| 7 — Cleanup + Flag off | ⬜ pending | — |

각 PR 머지 시 본 표의 상태 (`⬜` → `✅`) + 해시를 갱신.
