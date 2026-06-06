<!-- schema_version: 1 -->
# 00. 배포-실용성 리팩토링 — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-06-06.
> 선행 SSOT: [`../Lite-update/Fianl_UI_update_before1.0/00-master-plan.md`](../Lite-update/Fianl_UI_update_before1.0/00-master-plan.md) (Final UI Update — 본 라운드의 *모(parent)*).

---

## 0. Executive Summary (한 페이지)

직전 라운드(Final UI Update)가 *"목업의 외관과 IA 로 코드를 통일했다"* 였다면, 본 라운드는 **그 위에서 "처음 받은 유저가 실제로 성공하는가" 를 마감한다.**

2026-06-06 시점의 ai-pm 은:

- **시각은 완성** — ui_v2 8 화면이 token-pure. 다크/라이트, 사이드바, Toolbar, 모든 화면이 목업과 정렬됨.
- 그러나 **죽은 표면이 남아 있다** — Today "다음 할 일" 은 영구 빈 칸, 코드 검색의 절반(심볼/정확)은 비활성, AI "대화 기록" 버튼은 눌리지 않고, 작업 일지 ⌘N(수동 일지)은 단축키 매트릭스에 있으나 동작하지 않는다.
- **첫 실행이 불친절하다** — StartScreen 은 프로젝트 추가 버튼만 있을 뿐, 이 앱의 *핵심 가치 루프*("외부 코딩 에이전트가 `AGENTS.md` 규칙에 따라 작업 일지를 자동으로 남기고, 이 앱이 그걸 보여준다")를 한 번도 설명하지 않는다. 새 유저는 프로젝트를 추가해도 *빈 Today* 를 보고 "그래서 뭘 하라는 거지?" 에서 멈춘다.
- **핵심 루프에 미완 한계가 있다** — entry-diff(변경 diff 영구 기록)는 비-git 프로젝트나 커밋 후 작성된 일지에서 빈 patch 가 되어 *조용히 미기록*된다.

이 라운드의 명령은 단순하다: **"설치 → 이해 → 첫 일지" 의 길을 막는 모든 마찰을 제거하고, 사용자에게 보이는 모든 컨트롤이 *실제로 동작하거나 정직하게 사라지게* 한다.**

---

## 1. 1.0 제품의 정체성 (재확인)

> "AI PM 도구가 *내 코딩 에이전트의 작업을 대신 기록해주는 비서* 처럼 느껴진다."

본 앱의 한 줄 가치: **로컬-퍼스트. 외부 코딩 에이전트(Claude Code / Cursor / Antigravity / Gemini CLI)가 `AGENTS.md` 규칙에 따라 작업할 때마다 *작업 일지*를 남기고, ai-pm 이 그것을 Today / 작업 일지 / 변경 diff 로 한눈에 보여준다.**

이 정체성에서 도출되는 실용성 기둥:

| 기둥 | 본 라운드에서의 의미 |
|---|---|
| **이해됨 (Legible)** | 처음 본 유저가 *왜 이 앱이 필요한지*, *무엇을 먼저 해야 하는지* 를 안내 없이도 안다. 빈 화면은 항상 *다음 행동* 을 가리킨다. |
| **정직함 (Honest)** | 화면에 보이는 모든 버튼/칩/블록은 *동작한다*. 동작 안 하면 노출하지 않는다 (비활성 회색 칩으로 "1.1 예정" 을 남발하지 않는다). |
| **견고함 (Robust)** | 핵심 루프(프로젝트 init → AGENTS.md 동기화 → 외부 에이전트 작성 → UI 갱신 → diff 기록)가 *비-git·커밋후·앱 꺼짐* 같은 현실 케이스에서도 조용히 실패하지 않는다. |

이 세 기둥에 *기여하지 않는* 작업은 — 본 라운드 스코프 밖(1.1 이후).

---

## 2. 위험 전제 (Risk Premise)

본 라운드는 *실용성* 라운드지만, 두 종류의 회귀를 동시에 피해야 한다.

### 2.1 시각 회귀 (직전 라운드 잠금을 깨면 안 됨)

직전 라운드가 잠근 ui_v2 시각 시스템은 **불변**이다. 본 라운드의 어떤 PR 도 아래를 되돌리면 안 된다:

| Invariant | 보호 방법 |
|---|---|
| `dark:` Tailwind variant = 0 (legacy 제외) | grep 게이트 (`02-fix-checklist.md` §8) |
| `classList.toggle("dark")` = 0 | grep 게이트 |
| lucide-react 직접 import = 0 (`Icons.tsx` 제외) | grep 게이트 |
| localStorage 직접 접근 = 0 (allowlist 제외) | `pnpm lint` (check-no-localstorage) |
| 토큰 격리 — 메인 css 에 ui_v2 녹색(`12a06b`) 누출 0 | `pnpm build` 후 청크 확인 |
| ui_v2 8 화면 = 목업과 시각적 동일 | dogfood 수동 비교 |

→ 새 UI 를 *추가*할 때는 반드시 ui_v2 토큰(`--bg-*`/`--text-*`/`--accent`/`--t-*`/`--diff-*`) + `@/components/Icons` + `useTheme`/`useWorkspace` 만 사용. shadcn/Tailwind 임의 색 금지. 규약 전체는 [`REFACTOR-MASTER-PROMPT.md`](./REFACTOR-MASTER-PROMPT.md).

### 2.2 데이터 루프 회귀 (백엔드를 건드리므로 신규)

직전 라운드와 달리 본 라운드는 **백엔드를 건드릴 수 있다** (entry-diff snapshot fallback, 수동 일지 작성 등). 따라서 데이터 invariant 를 새로 잠근다:

| Invariant | 보호 방법 |
|---|---|
| 기존 `#[tauri::command]` 시그니처 변경 시 `tauri-specta` 바인딩 재생성 + `cargo test` green | `02-fix-checklist.md` 의 PR DoD |
| watcher 의 `is_self_suppressed` / journal cache 무효화 경로 무변경 (또는 테스트로 보호) | `cargo test --lib oculpm` |
| `WorkspaceContext` schema 변경은 *deletion-only* 또는 *additive* (역 마이그레이션 불요) | `useWorkspace` migrate 단위 테스트 |
| session resume / 종료 탐지 로직 변경 시 기존 resume 테스트 보존 | `cargo test --lib oculpm::session` |
| 외부 LLM 의 journal 작성 흐름(`AGENTS.md` 마스터 규칙) 무변경 | `.oculpm/agents/_template.md` 본문 동결 |

회귀 보호 확인 PR (**PR-R0**) 가 다른 모든 fix PR 의 *선행 조건*. 현재 게이트가 green 임을 베이스라인으로 박고(`pre-refactor` 태그) 시작한다.

---

## 3. 스코프 경계 (무엇을 / 무엇을 안 하나)

### 3.1 본 라운드가 *하는* 것

- 사용자에게 보이는 **죽은/미완성 컨트롤** 을 연결하거나 제거.
- **첫 실행 / 빈 상태 / 온보딩** 카피 + 흐름.
- **핵심 데이터 루프** 의 현실 케이스 보강(entry-diff fallback, opener, session).
- **시각 일관성 마감** (직전 라운드 PR-UI 8 이월분 — StartScreen/오버레이).
- **배포 위생** (번들 크기, 빌드 lint).
- 위 목적에 *필요한 한도 내* 신규 백엔드 command / migration / `tauri-specta` 재생성.

### 3.2 본 라운드가 *안 하는* 것

- ❌ ui_v2 시각 시스템 재논의 / 재디자인 (직전 라운드 잠금).
- ❌ `.oculpm/agents/_template.md` 의 *일지 작성 규칙 본문* 변경. (단, 온보딩에서 그 규칙을 *어떻게 사용자에게 설명/배포* 하는지는 본 라운드 대상.)
- ❌ 새 IA 슬롯 추가 / 사이드바 9 슬롯 변경 (직전 라운드 잠금).
- ❌ "1.1 예정" 으로 명시된 *신기능* 의 실제 구현 (심볼/정확 검색 엔진 등) — 본 라운드는 *그 비활성 칩을 어떻게 처리할지* 만 결정.
- ❌ LLM provider 추가 / Planner DB 재설계.
- ❌ "겸사겸사" 리팩터 — 현재 PR 의 DoD 밖 코드 정리는 별도 PR.

### 3.3 회색 지대 — 명시적 판정

| 항목 | 판정 |
|---|---|
| 신규 백엔드 command 추가 | ✅ 허용 (목적에 필요하면). 단 specta 재생성 + cargo test 필수. |
| 기존 command 시그니처 변경 | ⚠ 가급적 회피. 불가피하면 호출부 전수 + specta + cargo test. |
| DB migration 추가 | ✅ 허용 (entry-diff sidecar 는 DB 무관이나, 수동 일지 등은 가능). additive only. |
| `AGENTS.md` 템플릿 카피 수정 | ⚠ 일지 *작성 규칙* 본문은 동결. *온보딩 설명/주석* 추가는 가능 — 경계 모호하면 open question. |
| shadcn 컴포넌트를 ui_v2 토큰으로 re-skin | ✅ 허용 (PR-UI 8 이월분, Option 2 변수 remap 패턴 계승). |

---

## 4. 핵심 결정 (잠금 후보)

> 아래는 *제안* 이다. 본 라운드 진행 중 사용자 확인으로 잠근다. 잠긴 결정은 [`02-fix-checklist.md`](./02-fix-checklist.md) §0 에 기록.

| # | 결정(제안) | 근거 |
|---|---|---|
| R1 | **죽은 컨트롤은 "연결" 또는 "제거" 중 택1 — 비활성 회색 유지 금지** | 정직함 기둥. "1.1 예정" 칩은 미완성을 광고. 데이터가 이미 있으면(예: Planner subtask) 연결, 없으면 깔끔히 제거. |
| R2 | **Today "다음 할 일" 은 *연결*** | Planner subtask 데이터가 이미 실연동(PlannerScreenV2). 상위 N 개 미완료 subtask 를 끌어오면 됨 — 블록 구조도 목업대로 준비됨. |
| R3 | **코드 검색 심볼/정확 칩은 *제거*** (단일 "의미 검색" 으로) | 1.1 엔진이 없으면 칩 자체가 거짓 약속. 단일 검색으로 단순화하고, 1.1 에서 재도입. |
| R4 | **온보딩 = StartScreen 내 인라인 가이드 + 첫 빈 Today 의 행동 유도** (별도 풀스크린 마법사 아님) | 마찰 최소. 핵심 루프 3 단계("프로젝트 추가 → AGENTS.md 가 에이전트에 규칙 주입 → 에이전트가 일지 작성")를 한 카드로. |
| R5 | **entry-diff 는 PR-R3 에서 머지 + 비-git/커밋후 fallback 보강** | 현재 main 미머지. 한계를 안고 머지하면 "변경 diff 가 가끔 비어있다" 회귀. snapshot fallback 또는 *명시적 안내* 둘 중 하나 필요. |
| R6 | **시각 마감(PR-R4)은 PR-UI 8b 의 "Option 2 변수 remap" 패턴 계승** | 새 mockup 없음. shadcn 변수 값만 ui_v2 팔레트로 — 레이아웃 유지, dogfood 튜닝. |

---

## 5. 통합 일정 (PR-R 시리즈)

1.0 출시(Lite-W6 PR12 번들링) 직전 **1 ~ 2 주** 추산.

```
┌──────────────────────────────────────────────────────────────┐
│ Phase A — Foundation (0.5 일)                                 │
│   PR-R0: 회귀 보호망 확인 + pre-refactor 태그 + 게이트 green  │
├──────────────────────────────────────────────────────────────┤
│ Phase B — 정직성 (2~3 일)                                     │
│   PR-R1: 죽은/미완성 UI 표면 정리 (연결 or 제거)              │
│   PR-R2: 첫 실행 / 온보딩 / 빈 상태 가이드                    │
├──────────────────────────────────────────────────────────────┤
│ Phase C — 견고성 (2~3 일)                                     │
│   PR-R3: 핵심 데이터 루프 (entry-diff 머지+보강, opener, ...) │
├──────────────────────────────────────────────────────────────┤
│ Phase D — 마감 (2~3 일)                                       │
│   PR-R4: 시각 일관성 (StartScreen/오버레이 — PR-UI 8 이월)    │
│   PR-R5: 배포 위생 (번들/lint) + 2일 dogfood + 1.0 태그       │
└──────────────────────────────────────────────────────────────┘
```

순서 원칙:
- **PR-R0 이 선행** — 현 게이트 green 을 베이스라인으로 박지 않으면, 이후 변경이 *기존 회귀인지 내가 만든 회귀인지* 판단 불가.
- **PR-R1/R2 (정직성) 먼저** — 가장 사용자 가시적이고 저위험.
- **PR-R3 (백엔드) 격리** — 데이터 루프 변경은 다른 PR 과 섞지 않음. cargo test 게이트가 여기 집중.
- **PR-R5 의 dogfood 가 1.0 출시의 마지막 게이트** — 2 일간 실사용 후 치명 회귀 0 이면 1.0 태그.

각 PR 의 DoD 는 [`02-fix-checklist.md`](./02-fix-checklist.md).

---

## 6. 성공 기준 (이 라운드가 끝났다고 말할 수 있는 조건)

- [ ] 새 유저 시나리오: *앱 설치 → 프로젝트 추가 → 안내 따라 외부 에이전트 1 회 실행 → Today 에 첫 일지 표시* 가 **막힘 없이** 동작 (dogfood 영상/스샷).
- [ ] 화면에 보이는 모든 컨트롤이 동작 (비활성 "1.1 예정" 칩 0, 또는 명확한 사유 표기).
- [ ] entry-diff 가 비-git/커밋후 케이스에서 *조용히 미기록* 하지 않음 (기록하거나 사용자에게 사유 표시).
- [ ] 시각: ui_v2 잠금 invariant 전부 유지 (§2.1) + StartScreen/오버레이가 ui_v2 톤과 일관.
- [ ] 게이트: `pnpm typecheck` / `pnpm test` / `pnpm lint` / `cargo test` / `pnpm build` 전부 green.
- [ ] 2 일 dogfood 후 치명 회귀 0.

이 6 항목이 모두 ☑ 이면 **Lite-W6 PR12 (출시 번들링) 진입** + 1.0 태그.
