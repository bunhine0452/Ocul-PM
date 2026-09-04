<!-- schema_version: 1 -->
# 1.0 배포-실용성 리팩토링 라운드 — 문서 인덱스

> **아카이브** — 역사적 기록. 현재 코드의 SSOT 가 아니다.
>
> 아래 "시각 SSOT (불변)" 은 **불변이 아니었다** — 그 문서가 기술하는 8화면
> ui_v2 는 지금 16화면이고, 토큰·프리셋 테마·de-AI 규율이 그 위에 얹혔다.

> 상태: **초안 (1차)** · 작성일 2026-06-06 · 작성자 Claude (Opus 4.8)
> 선행 라운드: [`../Lite-update/Fianl_UI_update_before1.0/`](../Lite-update/Fianl_UI_update_before1.0/) (Final UI Update — 시각/IA 라운드, PR-UI 0~8 ✅ 완료)
> 작업 디렉토리: `docs/20260606_refactor/`
> 시각 SSOT (불변): [`../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/`](../Lite-update/Fianl_UI_update_before1.0/Ocul-PM1.0/)

---

## 0. 이 폴더의 위상

직전 라운드(Final UI Update, PR-UI 0~8)는 **외관과 IA** 를 1.0 목업으로 통일했다. ui_v2 8 화면 셸은 token-pure 하고, `dark:` / `classList.toggle("dark")` / lucide 직접 import / localStorage 직접 접근은 모두 0 으로 정리됐다.

본 폴더는 그 다음 단계 — **"외관이 끝난 앱을, 실제 유저가 설치했을 때 *작동하고 이해되는* 제품으로 마감하는 라운드"** 다.

직전 라운드와의 *결정적 차이*:

| | Final UI Update (직전) | 본 라운드 (배포-실용성) |
|---|---|---|
| 다루는 것 | 시각 / IA / 토큰 / 다크모드 | **첫 실행 / 핵심 루프 견고성 / 죽은 UI 정리 / 배포 위생** |
| 백엔드 | *건드리지 않음* | **필요 시 신규 command·migration 허용** (실용성 fix 가 백엔드를 건드릴 수 있음) |
| 성공 기준 | "목업과 시각적으로 동일" | **"새 유저가 설치 → 가치 이해 → 첫 일지까지 도달"** |
| 위험 | 시각 결정이 후속 spec 을 흔듦 | **시각 회귀** (ui_v2 잠금을 깨면 안 됨) + **데이터 루프 회귀** |

핵심 질문 한 줄: **"이 앱을 처음 받은 사람이, 아무 설명 없이, 5 분 안에 '아 이게 내 코딩 에이전트의 작업을 기록해주는 거구나'를 이해하고 첫 일지를 보는가?"**

---

## 1. 문서 구성

| 파일 | 역할 | 우선 독자 |
|---|---|---|
| [`00-refactor-master-plan.md`](./00-refactor-master-plan.md) | **마스터 플랜 (SSOT)**. 정체성 재확인, 이 라운드의 명령, 스코프 경계, 위험 전제, 핵심 결정. | 전원 |
| [`01-problems-inventory.md`](./01-problems-inventory.md) | **현재 문제점 카탈로그**. 코드 직접 검증으로 발견한 미작동/미완성/마찰 지점을 심각도(P0~P2)·근거(`file:line`)와 함께 정리. | 전원 |
| [`02-fix-checklist.md`](./02-fix-checklist.md) | **수정사항 기록부**. PR-R 시리즈의 DoD·진행 상태표·변경 기록(changelog). 각 fix 머지 시 본 문서를 갱신. | 전원 |
| [`REFACTOR-MASTER-PROMPT.md`](./REFACTOR-MASTER-PROMPT.md) | **작업 전용 마스터 프롬프트**. 외부 LLM 에이전트(Claude Code / Cursor / Gemini CLI)가 본 라운드 PR 을 작업할 때 함께 읽는 규약. | LLM 에이전트 |

읽는 순서: `README` → `00` → `01` → 작업 시작 시 `REFACTOR-MASTER-PROMPT` + `02`.

또한 *참고만* (본 라운드에서 수정 금지):
- [`../Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md`](../Lite-update/Fianl_UI_update_before1.0/UI-MASTER-PROMPT.md) — 시각 잠금 규약. **여전히 활성** (시각 회귀 방지).
- [`../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md`](../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md) — 직전 라운드 진행표 + Decision A~J.

---

## 2. 빠른 요약 — 한 화면

**무엇을 고치나** (자세히는 [`01-problems-inventory.md`](./01-problems-inventory.md)):

1. **죽은/미완성 UI 표면** — Today "다음 할 일" 영구 빈 칸, 코드 검색 심볼/정확 칩 비활성, AI "대화 기록" 비활성, 작업 일지 ⌘N(수동 일지) 미연결. → 사용자가 "버그"로 인식하는 표면을 *연결하거나 정직하게 제거*.
2. **첫 실행 / 온보딩** — StartScreen 에 핵심 가치 루프(*AGENTS.md → 외부 에이전트 → 일지*) 안내가 없음. 새 유저가 빈 Today 만 보고 이탈할 위험. → 온보딩 + 빈 상태 가이드.
3. **핵심 데이터 루프 견고성** — entry-diff 한계(비-git·커밋 후 빈 patch 미기록, 백필 불가), opener scope 재발 패턴, session 종료 탐지. → 머지 + 한계 보강.
4. **시각 일관성 마감** — StartScreen/전역 오버레이의 shadcn 잔재(직전 라운드 PR-UI 8 이월분).
5. **배포 위생** — 8.4MB 폰트·500kB+ 청크 번들, ESLint 부재.

**무엇을 안 바꾸나**:
- ui_v2 8 화면 셸의 *시각 시스템* (토큰·다크모드·아이콘 단일출구) — 직전 라운드 잠금 유지. 회귀 금지.
- `.oculpm/agents/_template.md` 의 *일지 작성 규칙 본문* — 단, 온보딩 카피/AGENTS.md 배포 안내는 다룰 수 있음(경계는 §00 §3).
- Planner DB 스키마 핵심 / LLM provider 추상화.

**가장 위험한 가정**:
- *"새 유저가 외부 에이전트 연동 모델을 직관적으로 이해한다"* — dogfooding 기록상 사용자조차 "AGENTS.md 재동기화"의 의미를 오인했다([2차 발견 3](../Lite-update/Fianl_UI_update_before1.0/)). 처음 받는 사람은 더 모른다. → 본 라운드 최우선이 **온보딩**인 이유.

---

## 3. 진행 상태 (2026-06-06)

- [x] 직전 라운드(PR-UI 0~8) ✅ 완료 + 코드 게이트 green 검증 (typecheck/test 89pass/lint/build)
- [x] 본 폴더 문서 1차 작성 (README + master-plan + problems-inventory + fix-checklist + master-prompt)
- [ ] **PR-R0** (회귀 보호망 확인 + 베이스라인 태그) ← 다음 액션
- [ ] PR-R1 (죽은/미완성 UI 표면 정리)
- [ ] PR-R2 (첫 실행 / 온보딩)
- [ ] PR-R3 (핵심 데이터 루프 견고성 + entry-diff 머지)
- [ ] PR-R4 (시각 일관성 마감 — PR-UI 8 이월분)
- [ ] PR-R5 (배포 위생 + 최종 dogfood + 1.0 태그)

> 본 문서들은 *살아있는 문서* — PR-R 진행 중 발견되는 새 결정은 [`02-fix-checklist.md`](./02-fix-checklist.md) §0 에 추가 + 본 §3 에 반영.

---

## 4. 브랜치 / 머지 메모

- 작성 시점 브랜치: **main** (사용자 요청으로 `feat/entry-diff-history` → main 복귀).
- `feat/entry-diff-history` 의 entry-diff 기능 커밋(`5d6cd90`)은 **아직 main 미머지** — 브랜치에 보존됨. 본 라운드 **PR-R3** 에서 한계 보강과 함께 머지 검토 ([`01-problems-inventory.md`](./01-problems-inventory.md) §B1).
