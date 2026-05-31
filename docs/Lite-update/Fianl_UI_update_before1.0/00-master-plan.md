# 00. Final UI Update — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-05-31.
> 선행 SSOT: [`../00-master-plan.md`](../00-master-plan.md) (Lite-W6 SSOT — 본 문서의 *모(parent)*).

---

## 0. Executive Summary (한 페이지)

`docs/Lite-update/00-master-plan.md` 가 *"비정상 표면을 잘라낸다"* 였다면, 본 문서는 **그 결과물 위에 1.0 의 최종 외관을 입히는 라운드** 다.

Lite-W6 PR0~PR10 의 머지가 끝난 2026-05-31 시점에서 현재 ai-pm 은:

- **여전히 Tailwind shadcn 토큰** 으로 칠해진 *Lite 화면* 이다. 외관이 *과도기*.
- **3 IA (Today / Plan / Code)** 가 적용됐지만, Code 화면 안에 *4 sub-tab (Files/AI/Graph/Terminal)* 이 남아 — 사용자가 "탭 안의 탭" 을 매번 인지해야 함.
- **AiOverlay (⌘\\)** 는 동작하지만, 사용 빈도가 낮음 (사용자 발언 — *"AI 패널이 있는지조차 잊는다"*).
- **`LocalDiffView`** 는 Today 의 변경 파일 카드에서만 호출 가능 → 변경 검토 동선이 *Today → 카드 클릭* 한 갈래.
- **시맨틱 코드 검색** 은 ⌘K 명령 팔레트 내부 보조 기능 → 검색만을 위해 ⌘K 를 누르는 사용자가 *왜 이게 명령 팔레트 안에 있는지 모름*.

이 라운드의 명령은 단순하다: **목업 ([`Ocul-PM1.0/`](./Ocul-PM1.0/)) 의 외관과 IA 로 코드를 통일시킨다.**

---

## 1. 1.0 외관의 정체성

> "AI PM 도구가 *우리 운영체제의 일부* 처럼 느껴진다."

| 기둥 | 1.0 에서의 의미 |
|---|---|
| **고요함 (Calm)** | 사용자가 *현재 어디에 있는지* 와 *방금 무엇이 바뀌었는지* 만 봐야 한다. 나머지는 보이지 않거나 한 클릭 뒤. |
| **단단함 (Solid)** | macOS 의 흰 / 회색 surface, 1px 분리선, 작은 그림자. Tailwind 의 *생기 있는* 라운드 / 그림자 / 그라데이션을 절제. |
| **연속성 (Continuity)** | 라이트 / 다크 어느 쪽이든 *같은 위계 정보* 가 같은 위치에 있다. 토큰 1 개의 라이트/다크 값만 다르게. |

이 세 기둥에 *속하지 않는* 모든 시각 요소는 — 줄인다.

비-기둥 시각 요소 식별:

- ❌ `bg-gradient-to-*`, `bg-clip-text`, 다중 색상 그라데이션 (현재 일부 카드에 잔존)
- ❌ `shadow-2xl`, `shadow-purple-500/20` 같은 색 입힌 그림자
- ❌ 8px 미만 / 24px 초과의 border-radius
- ❌ 단일 화면 내 *3 종 이상의 폰트 크기 위계* (h1 22 → h2 14 → body 13 → meta 11.5 의 4 단으로 제한)
- ❌ 액센트 컬러가 *2 개 이상* 인 화면 (그린 1 + 트리거 5 색 외 사용 금지)

---

## 2. 위험 전제 (Risk Premise)

> 사용자의 핵심 우려는 *Lite-W6* 와 동일하다 — *"필요없는 로직을 걷어내며 코드를 삭제할 때 로직이 깨지지 않도록 주의한다."*

본 라운드는 *시각* 라운드지만, IA 와 컴포넌트 트리 변경이 *데이터 흐름과 영속화 상태* 를 건드린다. 다음 invariant 들은 **PR-UI 별 회귀 테스트로 잠근다**:

| Invariant | 보호 방법 |
|---|---|
| `WorkspaceContext` 의 schema 마이그레이션은 *deletion-only*. v2 → v3 의 새 키를 *추가만* 한다. | `useWorkspace` 의 `migrateState` 단위 테스트 + `aipm:workspace:v1` 영속 키의 round-trip 테스트 |
| `useGlobalShortcuts` 의 단축키 → 액션 매핑이 ⌘1~⌘7 로 *확장* 되어도 기존 ⌘K / ⌘, / ⌘P / ⌘B / ⌘J / ⌘⇧J 는 동작 변화 없음 | vitest 시나리오: 모든 key combo emit 후 expected handler call 확인 |
| `LocalDiffView` 의 git / snapshot fallback 분기는 *변경되지 않음* (시각 wrapper 만 교체) | `tests/diff_view.test.tsx` 보존 + 새 wrapper 의 mount/unmount 테스트 |
| Today 의 journal 카드 클릭 → 작업 일지 화면 *focus highlight* 동선 | vitest 시나리오: 클릭 후 `route.params.focus` 가 채워지고 카드에 ring class 적용 |
| 다크 모드 토큰의 *AA 대비* (4.5:1) — `--diff-add-text`, `--diff-del-text` 등 코드 영역 텍스트 | axe-core 자동 검사 + [`03-design-system.md`](./03-design-system.md) §6 의 매트릭스 |
| Settings 의 API 키 keyring 저장/조회 | 백엔드 통합 테스트 보존, UI 는 wrapper 만 |
| 외부 LLM 에이전트의 journal 작성 (마스터 프롬프트 v1) 이 정상 작동 | `.oculpm/agents/_template.md` 는 *본 라운드에서 변경 금지* (시각 라운드는 프롬프트와 무관) |

회귀 테스트 보강 PR (**PR-UI 0**) 가 다른 모든 시각 PR 의 *선행 조건*. 보호망부터 친 후 손을 댄다.

---

## 3. 11 가지 핵심 결정

| # | 결정 | 근거 | 영향 받는 파일 (대표) |
|---|---|---|---|
| U1 | **사이드바를 248px 풀 라벨로 되돌린다** | `docs/Lite-update/04-ui-ux-redesign.md` §6 의 *56px 결정* 이 dogfooding 에서 "기능을 잊는다" 회귀를 만들었다. 사이드바 의존도가 *낮아진 게 아니라 무지가 늘었다*. | `src/App.tsx` (PRIMARY_NAV), `src/components/TitleBar.tsx`, 사이드바 신규 `src/components/Sidebar.tsx`. |
| U2 | **메인 IA 7 + 푸터 2 로 확장** | Code Workbench 의 sub-tab 묶음을 IA 레벨로 끌어올림. 각 항목은 *단일 책임*. | `WorkspaceContext.activeView` union 갱신. ⌘1~⌘7 + ⌘, 재매핑. |
| U3 | **변경 diff 를 전용 IA 로 승격** | `LocalDiffView` 가 Today 카드 안에서만 호출되던 동선은 *그 화면에서 길을 잃기 쉽다*. 사이드바에서 한 클릭으로 접근. | `src/features/diff/LocalDiffView.tsx` 를 `DiffScreen` wrapper 로 감쌈. Today 의 카드는 `go("diff", { entry })` 로 단순화. |
| U4 | **시맨틱 코드 검색 전용 화면** | 현재 ⌘K 팔레트 내부의 검색 모드를 별도 IA `search` 로 분리. ⌘K 는 *명령 실행만*. | 신규 `src/features/search/SearchScreen.tsx`. CommandPalette 의 검색 모드 코드 제거. |
| U5 | **Terminal 전용 화면 + 탭 시스템** | 메인 도크에서 *세션 1 개* 만 다루던 한계 제거. zsh / claude-code / cursor 등 *탭 단위* 로 동시 운영. | 기존 `TerminalDock` 제거, 신규 `src/features/terminal/TerminalScreen.tsx` (탭 + watch indicator). |
| U6 | **AI 패널 전용 화면 + 모델 칩 토글** | AiOverlay 는 *보조 통로* 로만 유지. 기본 진입은 화면. 멀티 LLM 모델 칩으로 *같은 컨텍스트에 여러 답변* 비교 가능. | 신규 `src/features/chat/AiPanelScreen.tsx`. 기존 `AiOverlay` 는 `⌘\\` 단축키 전용으로 유지. |
| U7 | **Code Workbench 완전 제거** | sub-tab 자체가 *과도기 IA*. PR-UI 7 에서 `CodeWorkbench.tsx`, `AiWorkbench.tsx` (사용처 변환 후), `codeSubTab` state 모두 삭제. | `src/features/code/*` 디렉토리 전체 정리 (필요 시 `src/legacy/code/` 로 이동). |
| U8 | **시각 토큰 시스템 전면 교체** | Tailwind shadcn 토큰 → 고유 `--*` 변수 시스템. Tailwind 자체는 *유틸 클래스용* 으로 유지하되, *색 / 폰트 / 그림자 토큰은 CSS variable 로 통일*. | `src/App.css` 전면 갱신. 신규 `src/styles/tokens.css`. shadcn 컴포넌트는 wrapper 로 토큰 매핑. |
| U9 | **다크 모드 토글 메커니즘 교체** | `document.documentElement.classList` 분기 → `data-theme="dark"` 속성 + `localStorage["oculpm-theme"]`. | `src/contexts/ThemeContext.tsx` 신규. 기존 다크 분기 코드 wrapping. |
| U10 | **아이콘 라이브러리 일원화** | 현재 `lucide-react` + 자체 `components/Icons.tsx` 혼용. 목업의 *얇은 stroke 1.75* 톤으로 통일. | `src/components/Icons.tsx` 가 *모든 lucide-react import 의 단일 출구* 가 되도록 alias. |
| U11 | **카피 톤 가벼움 + 전문 용어 일관성** | "에이전트" / "워크데이" / "트리거" / "일지" 등 본 라운드에서 결정 잠금. 다른 표현 (예: "에이전트" 를 "AI" 로 줄여 부르기) 금지. | [`UI-MASTER-PROMPT.md`](./UI-MASTER-PROMPT.md) §6 의 용어 사전. |

각 결정의 *세부* 와 *대체 안* 은 후속 문서에서 다룬다.

---

## 4. 통합 일정 (PR-UI 시리즈)

Lite-W6 PR12 (출시 번들링) 진입 전 **2 ~ 3 주** 로 추산.

```
┌───────────────────────────────────────────────────────────────┐
│ Phase A — Foundation (3~4 일)                                 │
│   PR-UI 0: 회귀 테스트 + 토큰 시스템 격리 + ui_v2 flag         │
│   PR-UI 1: Sidebar(248px) + Shell + 다크 토글 (data-theme)     │
├───────────────────────────────────────────────────────────────┤
│ Phase B — Screens (1~1.5 주, 병렬 가능)                        │
│   PR-UI 2: Today 6-블록 대시보드                                │
│   PR-UI 3: 작업 일지 timeline                                   │
│   PR-UI 4: 변경 diff 전용 화면 (LocalDiffView 흡수)             │
├───────────────────────────────────────────────────────────────┤
│ Phase C — Tools (3~4 일)                                       │
│   PR-UI 5: Planner / 코드 검색 / AI 패널 / Terminal — 일괄      │
│   PR-UI 6: Settings 재구성                                      │
├───────────────────────────────────────────────────────────────┤
│ Phase D — Cleanup (2~3 일)                                     │
│   PR-UI 7: Code Workbench 잔재 제거 + 단축키 재매핑             │
│           + ui_v2 flag 영구 ON + 2일 dogfood + IA 확정 sign-off │
└───────────────────────────────────────────────────────────────┘
```

순서 원칙:
- **PR-UI 0 이 모든 시각 PR 의 선행** — 회귀 테스트와 토큰 시스템 격리 없이는 다른 PR 의 변경이 *어디까지 의도된 시각 변경인지* 판단 불가.
- **`ui_v2` feature flag** 가 PR-UI 1 부터 도입. PR-UI 7 까지 *기존 IA 코드와 신 IA 코드가 공존*. 사용자가 토글 가능.
- **Phase B 의 3 PR 은 병렬 가능** — Today / Journal / Diff 가 서로 독립적 화면.
- **Phase D 의 dogfood 가 IA 확정의 마지막 게이트** — 2 일간 PR-UI 7 의 flag-ON 만 사용해 회귀 신호를 수집. 신호가 없으면 flag 제거 머지.

각 PR 의 DoD 와 회귀 보호 체크는 [`05-implementation-checklist.md`](./05-implementation-checklist.md) 에 정리.

---

## 5. 비전 — PR-UI 완료 후 사용자가 보는 화면

```
┌──────────────────────────────────────────────────────────────────┐
│  ▣ Ocul-PM         Today                          [⌘K 검색…  ]   │
│  로컬-우선 · v1.0                                                │
│                                                                  │
│  ┌──────────────────────────┐                                    │
│  │  ai-pm                   │   오늘 6건의 작업이 기록됐어요      │
│  │  ~/dev/ai-pm        ↕    │   AI 에이전트가 코드를 쓰는 동안   │
│  └──────────────────────────┘   Ocul-PM이 자동으로 일지를 작성    │
│                                                                  │
│  ☀  Today                  ●6   ┌────┬────┬────┬────┐            │
│  📓 작업 일지              ●14   │ 6건│13개│ 1회│ 3개│            │
│  ⤧  변경 diff                    │작업│파일│복구│에이전트│           │
│  ◎  Planner                     └────┴────┴────┴────┘            │
│                                  ┌──────────────┬──────────┐     │
│  도구                            │ 오늘의       │ 이번 주  │     │
│  🔍 코드 검색                    │ 하이라이트    │ 작업량   │     │
│  ▦  터미널                       │ ...          │ ▁▃▂▆▄▁▂  │     │
│  ✦  AI 패널                      │              │          │     │
│                                  │ 어제 마무리   │ 에이전트  │     │
│  ──────────────                  │              │ 별 기여  │     │
│  ☾  다크 모드                                                    │
│  ⚙  설정                                                         │
└──────────────────────────────────────────────────────────────────┘
```

이게 1.0 의 *기본 화면*. 좌측 사이드바는 *닫지 않고 늘 보이는* 248px 정착 영역.

---

## 6. 명시적 *안티* 비전

본 라운드에서 *의도적으로* 하지 않는 것:

- ❌ 사이드바를 *접을 수 있게* 만들기 (collapsible). 248px 고정 — 폭이 부담되면 윈도우 자체를 키운다.
- ❌ 화면 간 *애니메이션 트랜지션* (fade-in 0.24s 한 단계만 허용 — `fade-in` 클래스).
- ❌ 추가 라이브러리 도입 (`framer-motion`, `react-spring`, `radix-themes` 등). 모션은 CSS transition / keyframe 만.
- ❌ Tailwind 의 임의 색 클래스 (`bg-red-500/30`) 사용 — 모두 토큰을 통해서만.
- ❌ 컴포넌트 라이브러리 교체 (shadcn 유지). 단 wrapping 으로 토큰 매핑.
- ❌ 새 화면 추가 (8 개로 잠금). v1.1 에서 *추가* 는 검토.
- ❌ 모바일 / 반응형 디자인 (`min-width` 1024px 데스크톱 가정 유지).

---

## 7. 성공 지표 (PR-UI 완료 기준)

| 지표 | 목표 | 측정 |
|---|---|---|
| 사이드바 → 메인 7 + 도구 3 + 푸터 2 항목 모두 첫 화면에서 보임 | 100% | 시각 회귀 스냅샷 |
| 다크 → 라이트 토글 시 *layout shift* | 0 (모든 토큰만 변경) | DevTools layers 비교 |
| 임의 화면 진입 후 단축키 안내 (⌘N/⌘R 등) 가 *툴바 또는 hover* 에서 보임 | 100% (모든 IA) | 화면별 수동 점검 |
| `data-theme` 속성 외 다크 분기 코드 | 0 | grep `\\.dark[\\s:]` 결과 0 |
| `codeSubTab` / `CodeWorkbench` / `AiWorkbench` reference | 0 (PR-UI 7 이후) | grep 결과 0 |
| Tailwind 임의 색 클래스 (`bg-(red\|blue\|...)-\\d+`) | 0 (토큰만 사용) | ESLint plugin or grep |
| axe-core 자동 검사 (각 화면) | 0 violations | vitest-axe |
| 라이트/다크 둘 다 4.5:1 AA 대비 | 100% (모든 텍스트) | `03-design-system.md` §6 매트릭스 자동 검사 |
| 콜드 스타트 | < 1.5초 (현재 ~1.2초 유지) | 측정 스크립트 |

---

## 8. 의존 그래프 (PR-UI 내부)

```
                  PR-UI 0 (Foundation)
                       │
                       ▼
                  PR-UI 1 (Sidebar/Shell/Theme)
                       │
       ┌───────┬───────┴───────┐
       ▼       ▼               ▼
    PR-UI 2  PR-UI 3        PR-UI 4
   (Today)  (Journal)       (Diff)
       │       │               │
       └───────┼───────────────┘
               ▼
            PR-UI 5
       (Tools 4 화면 일괄)
               │
               ▼
            PR-UI 6
          (Settings)
               │
               ▼
            PR-UI 7
        (Cleanup + Flag off)
```

- Phase B (PR-UI 2~4) 는 *병렬 가능*. PR-UI 1 만 선행.
- Phase C (PR-UI 5~6) 는 Phase B 후. PR-UI 5 가 PR-UI 6 보다 먼저 (Settings 의 액션 일부가 다른 화면을 deep-link).
- Phase D (PR-UI 7) 는 Phase C 완료 후. 이게 *복귀 불가능* 한 분기점.

---

## 9. 본 라운드와 *Lite-W6 잔여* 의 관계

본 라운드와 [`../07-implementation-checklist.md`](../07-implementation-checklist.md) 의 잔여 PR (PR12) 의 동시 진행 가능 여부:

| Lite-W6 잔여 | 본 라운드와 충돌? | 처리 |
|---|---|---|
| PR12 (tauri bundle, 코드 서명, GitHub Releases) | ❌ 충돌 없음 | 본 라운드와 *순차* 진행. PR-UI 7 머지 → PR12 진입. |

PR-UI 가 끝나기 전에 PR12 (배포 빌드) 가 먼저 진행되면 *과도기 UI 가 1.0 으로 굳어진다*. 명시적 금지.

---

## 10. 부록 A. 본 라운드에서 *건드리지 않는* 영역

- LLM provider 추상화 (`src-tauri/src/llm/`)
- AST / 임베딩 / 인덱싱 파이프라인
- Planner DB 스키마 / 백엔드 커맨드
- Settings 의 LLM provider/model 저장 / Keyring
- `.oculpm/` watcher / IndexWriter / journal parser
- `.oculpm/agents/_template.md` (마스터 프롬프트 v1)
- `tauri-specta` 바인딩 생성
- Greenfield Wizard / StartScreen 의 *백엔드 흐름*

위 영역에 손이 가는 PR 은 의심한다. *시각 라운드* 에서 *데이터 흐름* 을 건드리면 scope creep.

---

## 11. 부록 B. 결정 완료 항목 (2026-05-31 잠금)

본 라운드 시작 전 결정 사항은 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 에서 잠금. 요약:

1. **목업이 시각 SSOT** — 본 문서들과 충돌 시 목업이 옳다.
2. **사이드바 248px** (Lite §6 의 56px 결정 *공식 reversal*).
3. **메인 IA = Today / 작업 일지 / 변경 diff / Planner** (4).
4. **도구 IA = 코드 검색 / 터미널 / AI 패널** (3).
5. **푸터 IA = 다크 토글 / 설정** (2).
6. **Code Workbench 제거** (Lite-W6 의 `src/features/code/` → PR-UI 7 에서 정리).
7. **`ui_v2` feature flag** 로 phased rollout. PR-UI 7 에서 영구 ON + flag 코드 제거.
8. **시각 토큰 시스템** = `--*` CSS variable (목업의 `styles.css`/`screens.css` 그대로 포팅).
9. **다크 모드** = `data-theme="dark"` 속성.
10. **단축키** = ⌘1~⌘7 (IA 순서) + ⌘, (Settings) + 기존 ⌘K/⌘P/⌘B/⌘J/⌘\ 유지.
11. **카피 용어 사전** = [`UI-MASTER-PROMPT.md`](./UI-MASTER-PROMPT.md) §6 에서 잠금.

이후 변경 시 §0 / §11 가 SSOT — 본 부록은 그 요약에 불과하다.
