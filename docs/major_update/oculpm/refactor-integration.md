# `docs/refactor/W6` (Greenfield Wizard / StartScreen / Polish) 와의 통합 노트

> 참조: [`../refactor/W6/01-greenfield-wizard.md`](../../refactor/W6/01-greenfield-wizard.md)
> 작성일: 2026-05-22 · 본 노트는 **그 리팩토링이 main 에 머지된 시점 이후** oculpm 페이즈가 어디를 조정해야 하는지의 SSOT.

---

## 0. 결론 한 줄

해당 리팩토링은 **oculpm 의 핵심 데이터 모델/디렉토리 스펙에 영향을 주지 않는다**. 단, **사이드바 라벨/디자인 토큰/마이그레이션 번호/일부 컴포넌트 재사용** 의 4개 지점에서 oculpm 페이즈 가이드를 미세 조정해야 한다.

---

## 1. 영향점 매트릭스

| # | 영역 | 리팩토링이 만든 변화 | oculpm 가 받는 영향 | 대응 |
|---|---|---|---|---|
| **I-1** | SQLite 마이그레이션 번호 | `migrations/011_project_blueprints.sql` 추가 (이제 011 까지 사용 중) | 우리는 다음 마이그레이션부터 **012** 이상으로 가야 함 | `W1-foundation.md` 에 명시 |
| **I-2** | 사이드바 (`PRIMARY_NAV`) | 5 항목 한국어로 통일: 개요 → 오늘 → 계획 → 변경 기록 → 코드 (`⌘1`~`⌘5`) | 우리 W3-PR4 의 "Today 를 첫 번째로 swap" 이 5 항목 기준으로 다시 명세 필요 + 한국어 라벨 정착 | `02-frontend.md §4` + `W3-journal-today-ui.md W3-PR4` |
| **I-3** | 디자인 토큰 | `--radius-card: 16px`, `--radius-button: 8px`, `--radius-chip: 999px`, `--motion-fast: 150ms`, `--motion-normal: 200ms` | 우리 SessionCard/JournalEntryCard/ProjectMetaHeader/필터 chip 들이 이 토큰을 써야 일관됨 | `02-frontend.md §13`, `W3-journal-today-ui.md §3.4` |
| **I-4** | `Markdown.tsx` 의 `CodeBlockWrapper` | 코드블록 hover 시 우상단 📋 복사 버튼 추가됨 | 우리 `JournalEntryDetail` 의 마크다운 렌더는 **이 컴포넌트를 그대로 재사용** 해야 (별도 구현 X) | `W3-journal-today-ui.md W3-PR7` |
| **I-5** | A11y 패턴 | `role="navigation"`, `aria-label`, `aria-current` 등이 사이드바/StartScreen 에 정착 | 우리 `CategoryFilterBar`, `SessionCard`, 모달들이 같은 패턴을 따라야 일관됨 | `02-frontend.md §13`, `W6-stabilize-dogfood.md W6-PR8` |
| **I-6** | 새 아이콘 7종 | `ArrowRight`, `ArrowLeft`, `AlertTriangle`, `Rocket`, `Clock`, `MessageCircle`, `ClipboardCheck` | 우리 UI 에서 `AlertTriangle` (mismatch), `Clock` (session duration), `ClipboardCheck` (verified) 를 재사용 | `W3-journal-today-ui.md §3.4`, `W4-agents-dual-layer.md` |
| **I-7** | StartScreen + GreenfieldWizard 흐름 | 신규 프로젝트 = 위저드 → `create_greenfield_project` → 자동으로 새 프로젝트 select 됨 (`App.tsx:276`) | 신규 프로젝트가 select 되면 우리 `OculpmManager::on_project_opened` 가 자동 발화 → `.oculpm/` 초기화 + `OculpmOnboardingModal` 등장. **충돌 없음**, 그러나 사용자에게 "위저드 직후 한 번 더 모달" 이 보이는 경험. | `03-rollout.md` 의 리스크 R-13 추가, 결정 필요 (§3.1) |
| **I-8** | `blueprint_id` 자동 정리 | `create_greenfield_project` 완료 후 blueprint 삭제 | `.oculpm/` 와 무관 | KEEP, 변경 없음 |
| **I-9** | 한국어 카피 통일 | `locales/ko.json` 준비, `useTranslation()` 미도입 | 우리 UI 의 사용자 노출 문구는 처음부터 한국어로 작성 중이라 충돌 없음. 다만 i18n key 추가 시점에 같이 변환 가능. | KEEP, 1.0 이후 i18n 통합 시 고려 |
| **I-10** | `docs/refactor/W{1-6}/` 폴더 존재 | UI 리팩토링의 W1-W6 라는 별도 페이즈 시스템이 이미 있음 | 우리 oculpm 페이즈 (`oculpm/phases/W1-W6-*.md`) 와 **이름 충돌은 없으나** 독자가 헷갈릴 수 있음 | `phases/README.md` 에 disambiguation 추가 |

**중요한 비-영향**: 우리 `00-spec.md` (`.oculpm/` 디렉토리 구조, frontmatter, sessions, ndjson, lock, config.toml) 는 손댈 게 없다. 데이터 스펙은 안전.

---

## 2. 사이드바 라벨 — 최종 확정

리팩토링 직후 현재 (main):

| 순서 | 한국어 | ID | shortcut |
|---|---|---|---|
| 1 | 개요 | `overview` | ⌘1 |
| 2 | 오늘 | `today` | ⌘2 |
| 3 | 계획 | `plan` | ⌘3 |
| 4 | 변경 기록 | `changelog` | ⌘4 |
| 5 | 코드 | `code` | ⌘5 |

oculpm 전환 후 (W3-PR4 변경):

| 순서 | 한국어 | ID | shortcut | 비고 |
|---|---|---|---|---|
| 1 | **오늘** | `today` | **⌘1** | 새 디폴트 탭. 가장 자주 보는 곳. |
| 2 | **개요** | `overview` | **⌘2** | W5-PR5 에서 집계 뷰로 재포지셔닝. |
| 3 | 계획 | `plan` | ⌘3 | 변동 없음. |
| 4 | 변경 기록 | `changelog` | ⌘4 | W5-PR8 부터 read-only 배너. **1.1 에서 nav 에서도 제거.** |
| 5 | 코드 | `code` | ⌘5 | 변동 없음. |

**변경량**: PRIMARY_NAV 배열의 1번과 2번 entry 순서만 swap. shortcut 값도 같이 swap.

---

## 3. 결정 — Greenfield 신규 프로젝트 의 oculpm 초기화

### 3.1 흐름 (확정 — 옵션 A)

**확정안**: Greenfield 위저드 마지막 step ("초기 목표 확인") 에 **"ocul-pm 으로 이 프로젝트 추적" 체크박스 1개** 추가 (디폴트 **ON**). 위저드가 그 값을 `create_greenfield_project` 의 새 인자로 전달 → 백엔드가 `create_project` 직후 `OculpmManager::init_project` 를 자동 호출. 후속 `on_project_opened` 는 `.oculpm/` 이 이미 존재함을 보고 onboarding 모달을 띄우지 않음.

**최종 흐름**:
1. StartScreen → "✨ 새 프로젝트 시작하기" → GreenfieldWizard 열림.
2. 위저드 5 step 완주 (Step 4 의 새 체크박스 디폴트 ON 으로) → `create_greenfield_project(..., init_oculpm: true)` 호출.
3. 백엔드: 폴더 생성 + CLI 스캐폴드 실행 + `create_project` (DB 등록) + **`OculpmManager::init_project`** + **`agents::sync_active`** (활성 어댑터 sync).
4. 위저드 닫힘 + `handleSelectProject(created)`.
5. `Workspace` 진입 → `on_project_opened` 가 `.oculpm/` 이미 존재함을 감지 → **onboarding 모달 skip**, 정상 Today 화면.

**구현 위치**: 새 PR **W3-PR10 — Greenfield 위저드 oculpm 통합** (자세한 명세는 [`phases/W3-journal-today-ui.md`](./phases/W3-journal-today-ui.md) 의 W3-PR10).

### 3.2 사용자 거부 경로

- 위저드의 체크박스를 OFF 로 하고 만든 프로젝트:
  - `.oculpm/` 안 생김.
  - `Workspace` 진입 시 EmptyToday V1 (`.oculpm/` 미존재) UI 가 떠서 "ocul-pm 으로 추적할까요?" 카드.
  - 사용자가 그때라도 활성화하면 일반 onboarding 흐름.
  - 영구 거부 (dismiss) 도 가능. `localStorage[oculpm_dismissed_${projectId}]`.

### 3.3 결정 이력

| 항목 | 결정 | 일자 |
|---|---|---|
| §3.1 Greenfield→oculpm 통합 흐름 | **A** — 위저드 Step 4 체크박스 + 백엔드 자동 init. W3-PR10 에 반영. | 2026-05-22 |

---

## 4. 적용된 변경 (이 노트와 함께 머지될 다른 문서들)

다음 파일에 surgical edit:

- [x] `phases/README.md` — disambiguation block 추가
- [x] `phases/W1-foundation.md` — W1-PR1 에 마이그레이션 번호 노트
- [x] `phases/W3-journal-today-ui.md` — W3-PR4 의 PRIMARY_NAV 명세 정밀화 + W3-PR7 의 Markdown.tsx 재사용 명시
- [x] `02-frontend.md` — §4 사이드바 표를 5 항목 + 한국어로, §13 디자인 토큰 참조
- [x] `deprecations.md` — KEEP 표에 Greenfield/StartScreen/project_blueprints 추가
- [x] §3.1 의 옵션 A 확정 → `phases/W3-journal-today-ui.md` 에 **W3-PR10** 추가
- [x] `03-rollout.md` — R-13 추가 (Greenfield→oculpm 통합 리스크)

---

## 5. 회귀 방지 — W1 시작 전 한 번 확인

W1-PR1 머지 직전에 이 노트의 영향점 10개 (§1) 를 다시 한 번 훑어, 그 사이에 main 이 또 바뀐 게 없는지 확인. 변경이 있으면 본 노트를 갱신하고 영향받은 페이즈 가이드를 재조정.
