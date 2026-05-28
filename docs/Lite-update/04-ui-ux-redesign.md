# 04. UI/UX 재설계 — 사이드바 의존 ↓, 레이아웃 유연 ↑

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) D6 의 구체 화면.
> [`03-feature-revisions.md`](./03-feature-revisions.md) 의 4 요소를 한 레이아웃으로 묶는다.

---

## 0. 사용자 핵심 발언

> *"현재 왼쪽 사이드바를 통해서 앱이 다양한 기능들을 주어지고 있으나, 정리가 덜된 기능, 필요없는 기능이 현재 다수이기에 사용자 친화적으로 UI를 전반적으로 개편이 되길 바람. 그리고 UI의 유연함을 제공하여 사이드바에 너무 의존하지 않았으면 좋겠음."*

이 발언이 본 문서의 *지배 명령*. 사이드바 strip 의 *개수* 와 *비중* 을 동시에 낮춘다.

---

## 1. 현재 IA → 1.0 IA

### 1.1 현재 (W5)

```
┌──┬──┬───────────────────────────────────────────┐
│🔥│  │                                           │
│📊│  │                                           │
│📅│  │       primary content                     │
│📋│  │                                           │
│💻│  │  Code 화면 안엔 sub-strip:                 │
│  │  │     [Files] [AI] [Graph] [Terminal] [Git] │
│  │  │                                           │
│⚙ │  │                                           │
└──┴──┴───────────────────────────────────────────┘
  5 IA (Today/Overview/Plan/Changelog/Code)
  Code 안 5 sub-tabs
```

문제:
- 5 IA + 5 sub = 10 진입점. *PM 도구에 비해 과다*.
- *Changelog* 는 PR4 에서 삭제.
- *Code* 는 *Files / Graph* 만 의미 있음 (AI 는 D9 로, Terminal 은 D7 로 흡수).

### 1.2 1.0 IA (안 A — 권장)

```
┌──┬──────────────────────────────────────────────┐
│🔥│  Today                                       │
│📅│                                              │
│⚙ │                                              │
│  │                                              │
│↗ │                                              │
│  │                                              │
└──┴──────────────────────────────────────────────┘
  3 IA: Today · Plan · Settings
       (Overview 는 Today 의 *상단 카드* 로 흡수)
       (Code 는 *제거* — Files + Diff 는 Today 안)
```

- **Today (⌘1)**: 활동 + 변경 파일 + Plan 위젯. *기본 화면* (현재 default 와 일치).
- **Plan (⌘2)**: Goal 관리. 큰 화면 전용.
- **Settings (⌘,)**: 기존과 동일.

오버레이 / 도크로 호출되는 *2 차 표면*:
- AI 패널 (⌘\ 또는 ⌘⇧\) — 오버레이 / 분리 윈도우.
- Terminal (⌘J / ⌘⇧J) — 메인 도크 하단 / 풀스크린.
- File Tree + Diff (⌘B) — 좌측 *플레아블 패널*. Today 안에서 ⌘B 토글.
- Command Palette (⌘K) — 어디서든 fuzzy.
- Project Switcher (⌘P) — 신규. 멀티 프로젝트 빠른 전환.

### 1.3 1.0 IA (안 B — 대안)

```
┌──┬──────────────────────────────────────────────┐
│🔥│  Today                                       │
│📊│                                              │
│📅│                                              │
│⚙ │                                              │
└──┴──────────────────────────────────────────────┘
  4 IA: Today · Overview · Plan · Settings
```

- *Overview* 를 별도 슬롯으로 유지 (위젯/통계가 많아서 Today 의 상단 카드로 흡수하기엔 부담된다고 판단되면).

**선택 기준**:
- 안 A 가 *발언 의도* (사이드바 의존 ↓) 에 더 충실.
- 안 B 가 *현재 Overview 자산* (heatmap, agent breakdown 등 5종 위젯) 의 가치를 유지.
- **권장: 안 A**. Overview 의 위젯은 Today 의 *접을 수 있는 섹션* 으로 흡수.

---

## 2. Today 의 새 구조 (안 A 기준)

```
┌──────────────────────────────────────────────────────────────┐
│ Ocul-PM · ai-pm · ● main · +4   [↗ AI ⌘\]  [⚙]               │  ← TitleBar
├──┬───────────────────────────────────────────────────────────┤
│🔥│ 오늘 · 2026-06-15           [← 어제] [내일 →]   [↻ 새로고침]│
│📅│ ┌────────────────────────────────────────────────────────┐│
│⚙ │ │ ▾ 오늘의 포커스                                          ││
│  │ │   • Lite-W6 PR3 머지                                    ││
│  │ │   • LocalDiffView 첫 인터랙션                            ││
│  │ └────────────────────────────────────────────────────────┘│
│  │ ┌────────────────────────────────────────────────────────┐│
│  │ │ ▾ 활동 (journal)                          [+ 수동 작성]  ││
│  │ │   14:22 [feature] useGoals hook 분리                   ││
│  │ │   11:05 [refactor] FileExplorer 변경 하이라이트          ││
│  │ └────────────────────────────────────────────────────────┘│
│  │ ┌────────────────────────────────────────────────────────┐│
│  │ │ ▾ 변경된 파일 (4)   [reindex + diff]    [4개 비우기]      ││
│  │ │   ● src/features/diff/LocalDiffView.tsx   M             ││
│  │ │   ● src-tauri/src/commands/diff.rs        A             ││
│  │ │   ● ...                                                ││
│  │ └────────────────────────────────────────────────────────┘│
│  │ ┌────────────────────────────────────────────────────────┐│
│  │ │ ▸ Overview (정체성 / 스택 / 위젯)                        ││
│  │ └────────────────────────────────────────────────────────┘│
├──┴───────────────────────────────────────────────────────────┤
│ ▾ Terminal  (⌘J · 풀스크린 ⌘⇧J)                              │
└──────────────────────────────────────────────────────────────┘
```

각 섹션이 *접을 수 있는 카드*. 사용자가 자신의 작업 흐름에 맞게 *Overview 를 닫아둘 수 있고*, *변경 파일 카드를 항상 열어둘 수 있다*. 영속화는 WorkspaceContext 의 `todaySectionsCollapsed: Record<string, boolean>`.

좌측 *플레아블* 패널 (⌘B 토글):

```
┌─────────────┬─ Today ────┐
│             │            │
│  File Tree  │            │
│   + Diff    │            │
│  highlight  │            │
│             │            │
└─────────────┴────────────┘
```

⌘B 가 *FileTree + Diff 패널* 을 좌측에 도크. 닫으면 0 픽셀. 기본 상태: 닫힘 (Today 가 풀 폭). 사용자가 *변경 파일 카드의 항목 클릭* 시 자동으로 ⌘B 패널을 열고 그 파일의 diff 를 표시.

---

## 3. 단축키 매핑 (1.0)

```
⌘1 — Today
⌘2 — Plan
⌘,  — Settings
⌘K — Command Palette
⌘P — Project Switcher (신규)
⌘B — Side Panel (FileTree + Diff)
⌘J — Terminal (main-only ↔ split 토글)
⌘⇧J — Terminal-only 풀스크린
⌘\ — AI Overlay
⌘⇧\ — AI 분리 윈도우
⌘N — New Goal (in Plan)
⌘R — Reindex 현재 프로젝트
ESC — 모달/오버레이 닫기
```

매핑 변경:
- 폐기: ⌘3 (Plan 으로 흡수), ⌘4 (Changelog 제거), ⌘5 (Code 제거).
- 신설: ⌘P, ⌘B, ⌘⇧J, ⌘⇧\, ⌘R.

`src/hooks/useGlobalShortcuts.ts` 를 *PR7 에서* 전면 갱신.

---

## 4. *유연함* 의 정의

사용자 발언의 *유연함* 을 다음 4 가지 동작으로 구체화:

1. **3 단 레이아웃 모드 (`layoutMode`)** — main-only / split / terminal-only.
2. **좌측 사이드 패널 토글 (⌘B)** — FileTree + Diff 가 필요할 때만 표시.
3. **AI 오버레이 / 분리 윈도우** — 컨텍스트와 무관하게 어디서든.
4. **Today 의 카드 접기/펴기** — 각 사용자가 자신의 *오늘 화면 구성* 을 영속화.

이 4 가지가 함께 동작하므로 *최소 화면* (Today + 1 카드만) 부터 *풀 워크벤치* (Today + FileTree + Terminal + AI 오버레이) 까지 연속 변화.

---

## 5. 디자인 토큰 — 변하지 않는 것

`docs/refactor/MASTER-GUIDE.md §6.4` 의 토큰을 *그대로* 사용:
- 타이포 (EB Garamond / SUITE / D2Coding / Inter).
- 카테고리 컬러 (`--cat-feature`, `--cat-fix`, 등).
- 모서리 (`rounded-2xl` 카드, `rounded-lg` 버튼).
- 모션 200ms 이내.

신규 추가:
- `--accent-recent-change: #f59e0b` — FileTree 의 변경 하이라이트 dot.
- `--accent-uncommitted: #ef4444` — Git chip 의 +N 표시.

---

## 6. *사이드바* 자체의 미세 디자인

3 IA strip 의 디자인:

```
폭: 56px (현재 60px 에서 -4px)
상단: 3 아이콘 (Today · Plan · Settings) 수직 배열, 각 padding 12px
하단: 분리선 + Avatar / Profile (없음) / project switcher trigger (⌘P 의 시각화)
hover: 우측 +4px 슬라이드 + bg-accent
active: bg-primary text-primary-foreground
focus-visible: outline 2px primary
```

각 슬롯의 *우측 호버 시 라벨* — 작은 popover 로 "Today · ⌘1" 표시. 영구 라벨은 안 보임 (폭 절약).

---

## 7. *완성 후의 한 화면 비주얼*

```
═══════════════════════════════════════════════════════════════════════════════
  Ocul-PM · ai-pm · ● main · +4   |   ⌘K · ⌘P · ⌘\ · ⌘J             [⚙]
───────────────────────────────────────────────────────────────────────────────
┃ 🔥  ┃                                                                       ┃
┃ 📅  ┃     ☀ 오늘 · 2026-06-15                                  [← 어제]    ┃
┃ ⚙   ┃                                                                       ┃
┃     ┃     ┌─ 변경된 파일 (4) ────────────────────────────────────┐         ┃
┃     ┃     │  ● LocalDiffView.tsx       M   →   [diff]            │         ┃
┃     ┃     │  ● diff.rs                 A   →   [diff]            │         ┃
┃     ┃     │  [reindex + diff 보기]                                │         ┃
┃     ┃     └─────────────────────────────────────────────────────┘         ┃
┃     ┃     ┌─ 활동 (journal) ──────────────────────────────────────┐        ┃
┃     ┃     │  14:22 [feature] useGoals hook 분리                  │        ┃
┃     ┃     │  11:05 [refactor] FileExplorer 변경 하이라이트         │        ┃
┃     ┃     │  09:50 [docs] Lite-update 마스터링 문서 1차 완료       │        ┃
┃     ┃     └─────────────────────────────────────────────────────┘        ┃
┃     ┃     ┌─ 오늘의 포커스 ────────────────────────────────────┐          ┃
┃     ┃     │  • Lite-W6 PR3 (Session UI 삭제) 코드 리뷰         │          ┃
┃     ┃     │  • LocalDiffView 첫 인터랙션 dogfood                │          ┃
┃     ┃     └────────────────────────────────────────────────┘          ┃
┃     ┃     ▸ Overview                                                       ┃
┃     ┃                                                                       ┃
═══════════════════════════════════════════════════════════════════════════════
  ▾ Terminal · zsh                                                       ⌘⇧J
  $ claude-code "useGoals hook 을 별도 파일로 분리해줘"
  ...
═══════════════════════════════════════════════════════════════════════════════
```

이 화면은:
- 3 IA strip (좌).
- Today 본문 (중) — 카드 4 개 + 접힌 Overview.
- Terminal (하) — split 모드 기본.
- Git chip (titlebar 의 우측).
- 사이드 패널 (⌘B) 은 *현재 닫힌 상태* → 0px.

---

## 8. 빈 상태 / 로딩 / 에러

`W6 원안 PR8` 의 a11y / 빈 상태 매트릭스를 *Lite 후 잔존 화면* 에만 적용:
- Today (project 없음, journal 없음, journal 있음 3종)
- Plan (goal 없음, 있음, 필터로 0)
- FileTree (인덱싱 안됨, indexing 중, 완료)
- AI Overlay (project 없음, message 없음)
- Terminal (세션 없음 — auto-create)
- Settings (정상)

각 상태의 카피 (한국어) 와 액션 (예: "프로젝트 추가") 을 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §3 에 표로 정리.

---

## 9. 다크모드

현재 `App.css` 의 `dark` 클래스 분기 그대로. 새 토큰 2 개 (`--accent-recent-change`, `--accent-uncommitted`) 의 다크 변형:
- `--accent-recent-change`: light `#f59e0b`, dark `#fbbf24`.
- `--accent-uncommitted`: light `#ef4444`, dark `#f87171`.

a11y: 변경 하이라이트는 *색 + dot + 배지* 3중. 색만으로 의미 전달 금지 (a11y AA).

---

## 10. 결정 완료 항목 (2026-05-28 잠금)

본 §의 결정은 모두 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0.5 에서 잠금.

1. **IA** → **안 A** (Today / Plan / Settings). Overview 는 Today 의 접힌 카드.
2. **Project Switcher (⌘P)** → **신설**. StartScreen 의 프로젝트 카드 그리드 오버레이로 동작.
3. **Today 카드 기본 접힘** → **포커스 / 활동 / 변경 파일 = 펴짐**, **Overview = 접힘**.
4. **사이드바 strip 폭** → **56px**.
5. **TitleBar 우측 콘텐츠** → **Git chip · AI (⌘\\) · 설정 (⌘,)** 3 요소.
