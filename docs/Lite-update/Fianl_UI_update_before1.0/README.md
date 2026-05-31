# Final UI Update Before 1.0 — 문서 인덱스

> 상태: **초안 (1차)** · 작성일 2026-05-31 · 작성자 Claude (Opus 4.7)
> 선행 문서: [`docs/Lite-update/00-master-plan.md`](../00-master-plan.md), [`docs/Lite-update/04-ui-ux-redesign.md`](../04-ui-ux-redesign.md)
> 작업 디렉토리: `docs/Lite-update/Fianl_UI_update_before1.0/`
> 시각 SSOT: [`Ocul-PM1.0/`](./Ocul-PM1.0/) — Babel-standalone 으로 동작하는 라이브 목업.

---

## 0. 이 폴더의 위상

Lite-W6 의 Phase A → C 가 ✅ 인 시점(2026-05-31 기준 PR6.6 / PR10 Part 3 까지 머지)에서, **PR12 (출시 번들링) 직전 한 라운드의 UI 전면 개편** 을 잠그는 문서 묶음.

`docs/Lite-update/` 가 *"PM 정체성에 맞춰 비정상 표면을 잘라내는 라운드"* 였다면, 본 폴더는 **"잘라낸 결과물 위에 1.0 의 최종 외관을 입히는 라운드"** 다.

핵심 전환 (Lite-update 결정과의 *명시적 차이*):

1. **사이드바를 다시 채운다.** `docs/Lite-update/04-ui-ux-redesign.md` 의 *"3-IA strip 56px · 라벨 없음"* 결정을 **뒤집는다**. 새 사이드바는 **248px · 풀 라벨 · 7 항목 + 도구 섹션**. 이유: 실제 dogfooding 에서 ⌘1~⌘3 + ⌘B + ⌘\\ + ⌘J + ⌘⇧J + ⌘P 를 외워 쓰는 빈도가 낮았고, 사용자가 "어떤 기능이 있는지조차 잊는다" 는 회귀가 [`docs/Lite-update/retrospection/`](../retrospection/) 에 누적.
2. **Code Workbench 의 sub-tab 묶음을 해체한다.** Files/AI/Graph/Terminal 을 *최상위 IA* 또는 *전용 화면* 으로 승격. CodeSubTab union 자체 폐기.
3. **시맨틱 코드 검색을 일등 시민으로.** 기존 `⌘K` 팔레트 내부의 보조 기능 → 좌측 **"코드 검색"** 진입점 + ⌘K 는 명령 팔레트 전용으로 분리.
4. **변경 diff 전용 IA 신설.** Lite-W6-PR6 시리즈로 만든 `LocalDiffView` 를 Today 카드 내부 호출이 아닌 **사이드바 최상위 항목 "변경 diff"** 로 노출. 파일 목록 ↔ diff 본문의 2-pane 풀스크린.
5. **시각 시스템 교체.** Tailwind 토큰 기반 → **네이티브 macOS 톤** (단단한 흰색/회색 + 액센트 그린 #12a06b, 다크 모드 토글). 폰트 -apple-system 우선. Lucide 아이콘 단일 출처.

이 라운드의 산출물 = 본 폴더의 7 문서 + [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업 + 실제 코드의 PR-UI 시리즈.

---

## 1. 문서 구성

| 파일 | 역할 | 우선 독자 |
|---|---|---|
| [`00-master-plan.md`](./00-master-plan.md) | **마스터 플랜 (SSOT)**. 정체성 보정, 11 개 핵심 결정, PR-UI 일정. | 전원 |
| [`01-ia-and-shell.md`](./01-ia-and-shell.md) | 사이드바 248px 복귀 / 7 IA / 툴바·검색박스·프로젝트 스위처. 기존 §1 IA 결정을 뒤집는 근거. | PM(사용자) / 프론트 |
| [`02-screen-specs.md`](./02-screen-specs.md) | 8 화면 (Today / Journal / Diff / Planner / Search / Terminal / AI Panel / Settings) 의 인터랙션·데이터·상태. | 프론트 |
| [`03-design-system.md`](./03-design-system.md) | 토큰 (컬러·타이포·radius·shadow·motion) · 아이콘 셋 · 다크모드 매핑. | 프론트/디자인 |
| [`04-removal-and-migration.md`](./04-removal-and-migration.md) | Code Workbench · codeSubTab · AiOverlay 종속 · TerminalDock · SidePanel 의 처분 + WorkspaceContext schema bump. | 프론트 |
| [`05-implementation-checklist.md`](./05-implementation-checklist.md) | PR-UI 1~7 의 단위 분해, DoD, 회귀 lock. | 전원 |
| [`UI-MASTER-PROMPT.md`](./UI-MASTER-PROMPT.md) | **UI 작업 전용 마스터 프롬프트**. 외부 LLM (Claude Code / Cursor / Gemini CLI) 이 본 라운드의 PR 을 작업할 때 *.oculpm/agents/_template.md* 와 함께 읽어야 하는 시각 / IA / 금지 사항 규약. | LLM 에이전트 |
| [`Final_improvements_before1.0.md`](./Final_improvements_before1.0.md) | 사용자가 작성한 *시작 메모* (변경 동기). 본 폴더 도입 트리거. | 기록용 |

---

## 2. 빠른 요약 — 한 화면

**무엇을 바꾸나**:
1. **사이드바**: 56px 아이콘 strip → **248px 풀 라벨 사이드바**. 브랜드 + 프로젝트 스위처 + 메인 4 + 도구 3 + 푸터 (다크 토글 / 설정).
2. **IA**: 3 (Today/Plan/Code) → **7 + 도구 3 + 설정 1** (Today / 작업 일지 / 변경 diff / Planner · 도구: 코드 검색 / 터미널 / AI 패널 · 설정).
3. **Today**: 카드 토글 리스트 → **hero · 4 stat · 하이라이트/어제 · 주간 차트 · 에이전트 기여 · 다음 할 일** 6-블록 대시보드.
4. **Code Workbench 해체**: `CodeWorkbench` / `CodeSubTab` / `codeSubTab` state / ⌘3 의 Code 화면 → **제거**. Files 는 1.0 에서 *Diff 화면의 좌측 파일 패널* 로 흡수.
5. **시각 토큰 교체**: Tailwind shadcn 기본 → **고유 토큰 시스템** (`--bg-*`, `--text-*`, `--accent-*`, `--t-*` 트리거 색, `--diff-*`).
6. **다크모드**: `class="dark"` 분기 → **`data-theme="dark"` 속성 기반** 토글. `localStorage["oculpm-theme"]` 영속화.

**무엇을 안 바꾸나**:
- `.oculpm/` 파이프라인, 백엔드 커맨드, AGENTS.md 템플릿, Planner DB 스키마, LLM provider 추상화, Tauri 번들 설정 (PR12 에서만 손댐).
- 단축키 *기능 매핑* 자체는 유지하되, IA 변화에 맞춰 ⌘1~⌘7 재매핑 (§01 §3).

**가장 위험한 가정**:
- *"7 항목 사이드바가 3 항목보다 사용자 친화적이다"* — 사용자 발언 ("정리가 덜된 기능, 필요없는 기능") 과 표면적으로 충돌. 본 라운드는 *"잘라낸 후 다시 적절히 채운다"* 로 해석. 7 항목은 모두 **명확한 단일 책임** 을 가진다는 점이 정당화 근거 (§01 §2).
  → 대응: PR-UI 7 (사용자 dogfood 2 일) 에 회귀 신호 수집 후 IA 확정.

---

## 3. 핵심 의사결정 (1줄씩) — 자세한 표는 [`00-master-plan.md`](./00-master-plan.md) §3

- **사이드바**: 248px / 풀 라벨 / 브랜드 + 프로젝트 스위처 상단.
- **메인 IA (4)**: Today · 작업 일지 · 변경 diff · Planner.
- **도구 IA (3)**: 코드 검색 · 터미널 · AI 패널.
- **푸터 IA (2)**: 다크 토글 · 설정.
- **AiOverlay**: 유지하되 보조 통로. 기본 진입은 *AI 패널* 화면.
- **CodeWorkbench**: 제거. Files 는 *Diff 화면*, Graph 는 *v1.1 보류*.
- **TerminalDock**: 제거. Terminal 은 전용 화면 (탭 기반).
- **시각 시스템**: 네이티브 macOS 톤 + 액센트 그린.
- **다크모드**: `data-theme` 속성 + `localStorage["oculpm-theme"]`.
- **아이콘 라이브러리**: Lucide 단일 출처. `src/components/Icons.tsx` 의 alias 매핑 갱신.
- **카피 톤**: 한국어 기본 / 영문 fallback 없음 (현재와 동일).

---

## 4. 진행 상태 (2026-05-31)

- [x] 사용자 시작 메모 작성 — [`Final_improvements_before1.0.md`](./Final_improvements_before1.0.md)
- [x] **라이브 목업 배치** — [`Ocul-PM1.0/Ocul-PM.html`](./Ocul-PM1.0/Ocul-PM.html) (8 화면, 라이트/다크, mock data 포함)
- [x] **문서 1차 작성** (본 README + 5 기획 + 마스터 프롬프트)
- [ ] **PR-UI 0** (회귀 보호 + 토큰 시스템 격리) ← 다음 액션
- [ ] PR-UI 1 (사이드바 + Shell + 다크 토글)
- [ ] PR-UI 2 (Today 6-블록 대시보드)
- [ ] PR-UI 3 (작업 일지 timeline)
- [ ] PR-UI 4 (변경 diff 전용 화면 — 기존 LocalDiffView 흡수)
- [ ] PR-UI 5 (Planner / 코드 검색 / AI 패널 / Terminal — 4 화면 일괄)
- [ ] PR-UI 6 (Settings 재구성 + 데이터 키체인 UI)
- [ ] PR-UI 7 (Code Workbench 잔재 제거 + 단축키 재매핑 + 2 일 dogfood)
- [ ] **Lite-W6 PR12** 진입 (출시 번들링 — 본 라운드와 별개)

진행 순서:
1. PR-UI 0 머지 후 시각 토큰 격리 확인.
2. PR-UI 1 의 사이드바가 *기존 코드와 공존* (3 IA 와 7 IA 동시 mount → feature flag `ui_v2` 로 분기).
3. PR-UI 2~6 가 *flag-on 화면만* 갱신. flag-off 는 변경 없음.
4. PR-UI 7 에서 flag 제거 + Code Workbench 잔재 완전 삭제. 이 단계가 *복귀 불가능* 한 분기점.

> 본 문서들은 *살아있는 문서* — PR-UI 진행 중 발견되는 새 결정은 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 에 추가 + 본 §3 / §4 에 반영.

---

## 5. 본 폴더의 *목업* 사용법

[`Ocul-PM1.0/Ocul-PM.html`](./Ocul-PM1.0/Ocul-PM.html) 을 브라우저로 직접 열면 그대로 동작 (Babel-standalone + React 18 UMD). 의존성 설치 불필요.

목업의 위상:

- **시각 SSOT**. 본 문서들과 충돌이 생기면 *목업이 옳다*. 본 문서들이 갱신 대상.
- **라이트/다크 토글**: 좌측 사이드바 푸터의 "다크 모드 / 라이트 모드" 클릭.
- **mock data**: [`Ocul-PM1.0/src/data.jsx`](./Ocul-PM1.0/src/data.jsx) — 가상 프로젝트 `aurora-web` 시나리오. 실제 빌드 시 `WorkspaceContext` / `oculpmApi` 로 교체.
- **CSS 토큰**: [`Ocul-PM1.0/styles.css`](./Ocul-PM1.0/styles.css), [`Ocul-PM1.0/screens.css`](./Ocul-PM1.0/screens.css). [`03-design-system.md`](./03-design-system.md) 에 그대로 포팅.

목업은 *PR-UI 종료 후에도 보존*. 향후 다른 PR 에서 시각 회귀가 의심될 때 비교 기준.
