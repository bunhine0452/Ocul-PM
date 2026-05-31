# 01. IA · Shell · 사이드바 — 3 → 7+3+2 의 정당화

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) U1, U2 의 구체 화면 + Lite-W6 §6 (사이드바 56px) 의 reversal 근거.
> 시각 SSOT: [`Ocul-PM1.0/src/shell.jsx`](./Ocul-PM1.0/src/shell.jsx).

---

## 0. 사용자 핵심 발언 (원안 vs 현시점)

| 시점 | 발언 |
|---|---|
| 2026-05-28 (Lite-W6 04 §0) | *"사이드바에 너무 의존하지 않았으면 좋겠음."* |
| 2026-05-31 (본 라운드 트리거 — [`Final_improvements_before1.0.md`](./Final_improvements_before1.0.md)) | *"현재 느껴지는 불편사항에 따라 수정 계획을 세우고 전체적인 UI를 개편한다."* |

두 발언은 표면적으로 충돌하지만, *dogfooding 회고* 가 첫 번째 발언의 *해석을 갱신*:

- *"의존하지 않았으면 좋겠음"* → **시각적 의존을 줄이라는 뜻이 아니라, 사이드바가 *기능을 숨기지* 말라는 뜻** 으로 재해석.
- 56px 아이콘만으로는 *어떤 기능이 있는지 한눈에 안 잡힘* → 사용자가 ⌘K 로 매번 *기능 자체를 검색* 하는 현상 발생 (회귀 신호 1).
- ⌘B 패널을 *어떻게 여는지 기억 못함* → ⌘B 자체를 안 씀, FileTree 가 사실상 숨겨진 기능이 됨 (회귀 신호 2).
- AiOverlay 도 같은 운명. ⌘\ 단축키 안 외움 (회귀 신호 3).

→ **사이드바를 다시 *명시적인 진입점 카탈로그* 로 되돌린다.** 다만 248px 라는 *충분히 넓은 폭* 에 *풀 라벨* 을 두어, 사용자가 *모든 기능을 한 번에 본다*.

---

## 1. 현재 IA → 1.0 IA

### 1.1 현재 (Lite-W6 적용 후)

```
┌──┬──────────────────────────────────────────────┐
│🔥│  Today                                       │
│📅│                                              │
│⚙ │  Code 화면 안:                                │
│  │   [Files] [AI] [Graph] [Terminal]            │
│  │                                              │
└──┴──────────────────────────────────────────────┘
  3 IA (Today/Plan/Code) · 56px strip · 라벨 hover-only
  + Code 안 4 sub-tabs (⌘3 진입 후 다시 선택)
```

문제:
- *2-tier 진입* (사이드바 → Code → sub-tab) 이 다시 *9 단계 이전 IA* 와 비슷한 깊이.
- ⌘B / ⌘\\ / ⌘P 같은 *오버레이 진입점이 시각 표현 0* → 학습 불가.

### 1.2 1.0 IA — 7 main + 3 도구 + 2 푸터

```
┌────────────────────┬──────────────────────────────┐
│ ▣ Ocul-PM          │                              │
│ 로컬-우선 · v1.0    │                              │
│                    │                              │
│ ┌────────────────┐ │                              │
│ │ ai-pm        ↕ │ │                              │
│ │ ~/dev/ai-pm    │ │                              │
│ └────────────────┘ │                              │
│                    │       primary content        │
│ ☀ Today      ●6   │                              │
│ 📓 작업 일지  ●14   │                              │
│ ⤧  변경 diff      │                              │
│ ◎ Planner         │                              │
│                    │                              │
│ 도구               │                              │
│ 🔍 코드 검색       │                              │
│ ▦ 터미널           │                              │
│ ✦ AI 패널          │                              │
│                    │                              │
│ ──────────────     │                              │
│ ☾ 다크 모드        │                              │
│ ⚙ 설정             │                              │
└────────────────────┴──────────────────────────────┘
  248px 사이드바 (고정) + 1 콘텐츠 영역
```

각 슬롯의 분류:

| 슬롯 | 라벨 | 아이콘 (Lucide) | 단축키 | 책임 |
|---|---|---|---|---|
| Main 1 | Today | `Sunrise` | ⌘1 | 오늘의 대시보드 (변경 stats, 하이라이트, 다음 할 일) |
| Main 2 | 작업 일지 | `NotebookText` | ⌘2 | journal markdown 타임라인 (필터 / 검색) |
| Main 3 | 변경 diff | `GitCompareArrows` | ⌘3 | LocalDiffView 의 전용 풀스크린 (파일 목록 + diff) |
| Main 4 | Planner | `Target` | ⌘4 | 목표 → 서브태스크 → 일지 연결 |
| Tools 1 | 코드 검색 | `Search` | ⌘5 | 시맨틱 / 심볼 / 정확 일치 검색 |
| Tools 2 | 터미널 | `SquareTerminal` | ⌘6 | 탭 기반 PTY (zsh / claude-code / cursor 동시) |
| Tools 3 | AI 패널 | `Sparkles` | ⌘7 | 모델 칩 토글 멀티-LLM |
| Footer 1 | 다크 모드 | `Moon`/`Sun` | (단축키 없음 — 클릭) | data-theme 토글 |
| Footer 2 | 설정 | `Settings` | ⌘, | Settings 화면 |

브랜드 헤더 + 프로젝트 스위처는 *진입점이 아닌 컨텍스트 표시* — 클릭 시 ⌘P 와 동일하게 프로젝트 카드 오버레이.

---

## 2. *7 항목이 3 항목보다 친화적* 인 근거

| 비교 차원 | 3 IA (Lite-W6) | 7 IA (본 라운드) |
|---|---|---|
| 한 화면에서 보이는 진입점 수 | 3 + ⌘K 6 (총 9 — 하지만 ⌘K 안은 *검색 후* 가시) | 9 + ⌘K 의 *명령 실행만* (시각 가시도 ↑) |
| sub-tab 깊이 | Code 안 4 sub-tab → 2-tier | 0 — flat |
| 단축키 학습 부담 | ⌘1~⌘3 + ⌘B + ⌘\\ + ⌘J + ⌘⇧J + ⌘P + ⌘K = 8 종 (∴ 사용 빈도 분산) | ⌘1~⌘7 + ⌘, + ⌘K = 9 종 (∴ 첫 6 개가 직관적 매핑) |
| *기능이 있는지 몰라서 안 쓰는* 회귀 | 발생 (회고 §3.1) | 0 (모두 라벨 가시) |
| 사이드바 폭 점유 | 56px | 248px (윈도우 minWidth 960px 의 25.8%) |

→ *유연함의 정의* 도 갱신:

- ❌ "필요할 때만 화면을 띄운다" 는 의미의 *동적 유연함* (Lite-W6 04 §4 의 가설) — **포기**.
- ✅ "어떤 기능을 어디서 찾는지 매번 같다" 는 의미의 *예측 가능성* — 본 라운드의 정의.

---

## 3. 단축키 매핑 (1.0 최종)

```
⌘1 — Today
⌘2 — 작업 일지
⌘3 — 변경 diff
⌘4 — Planner
⌘5 — 코드 검색
⌘6 — 터미널
⌘7 — AI 패널
⌘,  — Settings
⌘K — Command Palette (명령 실행만)
⌘P — Project Switcher
⌘R — Reindex 현재 프로젝트
⌘N — New (현재 화면 컨텍스트에 따라 — Planner 에선 새 목표, Journal 에선 수동 entry)
⌘F — 현재 화면 내 in-page 검색 (Journal / Diff / Search)
ESC — 모달 / 오버레이 닫기
```

**폐기**:
- ⌘B (SidePanel) — 사이드 패널 자체 폐기. Files 는 변경 diff 화면 내장.
- ⌘\\ (AiOverlay) — 단축키 *유지* (오버레이는 보조 통로). 단 *기본 진입은 ⌘7*.
- ⌘J / ⌘⇧J (Terminal 도크) — 폐기. Terminal 은 ⌘6 전용 화면.
- ⌘⇧\\ (AI 분리 윈도우) — v1.1 로 미룸.

**신설**:
- ⌘4, ⌘5, ⌘6, ⌘7 (메인 / 도구 IA 의 4, 5, 6, 7번째 슬롯).
- ⌘F (in-page 검색 — Journal / Diff / Search 화면에서).

`src/hooks/useGlobalShortcuts.ts` 를 PR-UI 1 에서 전면 재작성.

---

## 4. Shell 구조

전체 shell:

```
┌───────────────────────────────────────────────────────────┐
│ Sidebar (248px)        │  Content (1fr)                   │
│  ┌──────────────────┐  │  ┌─────────────────────────────┐ │
│  │ Brand            │  │  │ Toolbar (52px)               │ │
│  │ Project switcher │  │  │  title · sub · spacer · 액션│ │
│  │ Main 4           │  │  ├─────────────────────────────┤ │
│  │ ─── 도구 ───     │  │  │                              │ │
│  │ Tools 3          │  │  │ Scroll area                  │ │
│  │ (spacer)         │  │  │   .page (padding 24px 28px)  │ │
│  │ ─────────────    │  │  │                              │ │
│  │ Footer 2         │  │  │                              │ │
│  └──────────────────┘  │  └─────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

- **Sidebar** 는 *고정 폭 248px*. CSS Grid `grid-template-columns: 248px 1fr`.
- **Toolbar** 는 *각 화면의 최상단 52px 영역*. 좌측 = `toolbar-title` (15px / 650 weight), `toolbar-sub` (12px / `--text-3`). 우측 = 화면별 액션 (`Toolbar` 의 children prop).
- **Scroll area** 는 *Toolbar 아래 전체* — content padding `24px 28px 60px`, max-width 1180px 중앙 정렬.

Toolbar 의 children 슬롯 표준:
- *검색박스 (`.search-box`)* — Today / Settings 등에 등장. 클릭 시 ⌘K *또는 화면 내 search* 와 같음.
- *chip* — 화면 메타 (`1,284개 심볼 인덱싱됨`, `1.0 변경 감시중`).
- *button.ghost.sm* — 보조 액션.
- *button / button.primary* — 주된 액션 (최대 1 개).

---

## 5. 사이드바 — 시각 세부

[`Ocul-PM1.0/styles.css`](./Ocul-PM1.0/styles.css) `.sidebar` ~ `.nav-item`:

```
폭: 248px 고정 (CSS Grid 좌측 column)
패딩: 14px 12px 12px
배경: var(--bg-sidebar)
구분선: 1px solid var(--sep) (우측)

브랜드 헤더:
  높이: padding 4px 8px 14px
  아이콘: 28x28 둥근 8px, var(--accent) 채움
  Brand name: 14px / 650 weight / letter-spacing -0.01em
  Sub: "로컬-우선 · v1.0" 10.5px / var(--text-3)

프로젝트 스위처 (.proj-switch):
  height: ~44px (8px 9px 패딩)
  background: var(--bg-card)
  border: 1px solid var(--border-card)
  radius: 9px
  shadow: var(--shadow-card)
  내용: 26x26 그라데이션 아이콘 + 프로젝트명 + 모노 폰트 경로 + ChevronsUpDown
  클릭: 프로젝트 카드 오버레이 (⌘P 와 동일)

Nav row (.nav-item):
  height: ~34px (7px 10px 패딩)
  font: 13px / 500 weight
  gap: 10px (아이콘 + 라벨)
  hover: bg-hover
  active: bg-accent + #fff 텍스트 + font 560
  badge: 우측 정렬, 11px / 600 weight, bg-active 칩

도구 섹션 라벨 (.nav-section-label):
  font: 10.5px / 600 weight / letter-spacing 0.04em / uppercase
  color: var(--text-3)
  padding: 12px 10px 4px

푸터:
  분리선 (1px) 위에 다크 토글 + 설정 nav-item 두 개
```

---

## 6. 사이드바와 *반응형*

본 라운드는 *데스크톱 단일 폼팩터*. minWidth 960px (현재 `tauri.conf.json`) 에서:

- 960px 윈도우 → 콘텐츠 712px. *충분*.
- 1150px 기본 윈도우 → 콘텐츠 902px. *기준*.
- 1600px+ → max-width 1180px 의 .page 가 중앙 정렬, 양옆 여백.

사이드바가 *접히는 모드는 없음*. 폭이 부담스러우면 윈도우를 키운다 (Tauri 의 `minWidth: 960` 은 그대로 유지).

---

## 7. Empty / 로딩 / 에러 상태

각 IA 의 0-상태:

| IA | 빈 상태 | 로딩 | 에러 |
|---|---|---|---|
| Today | "오늘 0건의 작업이 기록됐어요" + 안내 ("AI 에이전트에게 작업을 요청해보세요") + 마스터 프롬프트 배포 버튼 | Skeleton (4 stat / 2 panel) | 에러 메시지 + 재시도 |
| 작업 일지 | "아직 일지가 없어요" + AGENTS.md 배포 안내 | timeline node skeleton 5 개 | 동일 |
| 변경 diff | "이 브랜치엔 아직 변경 없음" + git status / file_snapshots 안내 | 좌측 파일 목록 skeleton + 우측 코드 skeleton | 동일 |
| Planner | "첫 목표를 만들어보세요" + 새 목표 버튼 (primary) | goal card skeleton 2 개 | 동일 |
| 코드 검색 | "검색어를 입력하면 의미 기반으로 관련 코드를 찾아줍니다" | 인덱싱 progress bar (필요 시) | "인덱스가 비어있어요" + reindex 버튼 |
| 터미널 | 신규 zsh 세션 자동 생성 + cursor blink | 세션 spawn skeleton | "PTY 생성 실패" + 재시도 |
| AI 패널 | "코드베이스에 대해 무엇이든 물어보세요" + 첫 질문 예시 chip 3 개 | thinking dot | API 키 미설정 시 Settings 진입 link |
| Settings | (빈 상태 없음 — 항상 데이터 있음) | section skeleton | 키 저장 실패 시 toast |

각 상태의 카피와 액션은 [`02-screen-specs.md`](./02-screen-specs.md) §화면별 부록 표에 정리.

---

## 8. *유연함* 의 재정의

Lite-W6 의 *유연함 = 화면 자유 배치* 는 *학습 부담* 으로 귀결됐다. 본 라운드의 정의:

1. **예측 가능성** — 어떤 IA 가 어디에 있는지 *항상 같은 자리*. 사용자가 *기능을 검색하지 않는다*.
2. **즉각 액션** — Toolbar 우측이 *현재 화면의 최우선 액션*. 예: Today 의 "오늘 변경 검토" primary 버튼 → 변경 diff 화면 진입.
3. **상태 보존** — 화면을 이동했다가 돌아와도 *스크롤 / 필터 / 선택 상태* 유지. `WorkspaceContext` 의 화면별 state 키 추가 (필요 시).
4. **다크 / 라이트 즉시 전환** — Footer 다크 토글 클릭 시 *layout shift 없이 토큰만 교체*.

이 4 가지가 사용자 발언 *"전체적인 UI를 개편"* 의 구체화.

---

## 9. 결정 완료 항목 (2026-05-31 잠금)

본 §의 결정은 모두 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0.1 에서 잠금.

1. **사이드바 폭** → **248px 고정**. *접힘 불가*.
2. **IA** → **메인 4 + 도구 3 + 푸터 2 = 9 슬롯**. 사이드바 1 단계 깊이.
3. **단축키** → **⌘1~⌘7 + ⌘, + 기존 ⌘K/⌘P/⌘R/⌘N/⌘F 유지**, ⌘B/⌘J/⌘⇧J/⌘⇧\ 폐기.
4. **Toolbar** → **52px 높이, 화면별 children**, 백드롭 블러 18px + saturate 1.4.
5. **프로젝트 스위처** → **사이드바 상단**, 클릭 시 ⌘P 오버레이.
6. **다크 토글** → **사이드바 푸터의 nav-item**, ⌘ 단축키 없음.
7. **AiOverlay** → **보조 통로로 유지** (⌘\), 기본 진입은 ⌘7 AI 패널 화면.
