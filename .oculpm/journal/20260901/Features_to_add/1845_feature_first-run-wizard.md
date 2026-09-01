---
schema_version: 1
type: feature
slug: first-run-wizard
status: done
difficulty: medium
created_at: 2026-09-01T18:45:00+09:00
session_id: manual-20260901-184500
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/onboarding/WelcomeWizard.tsx
    op: create
  - path: src/features/onboarding/welcome.css
    op: create
  - path: src/features/onboarding/welcomeGate.ts
    op: create
  - path: src/features/theme/accents.ts
    op: create
  - path: src/features/settings/tabs/AppearanceTab.tsx
    op: update
  - path: src/windows/StartTab.tsx
    op: update
  - path: src/lib/settings.ts
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/welcome_wizard.test.tsx
    op: create
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related: []
tags: [onboarding, i18n, theme, first-run]
---

[x] 첫 실행 마법사 — 처음 켠 사람에게 언어·모양·첫 프로젝트를 한 번 묻는다

## 추가 기능

설치하고 처음 켠 사람이 보던 것은 프로젝트가 0개인 시작 탭이었다. Cursor·Antigravity 가 첫 실행에 언어와 테마를 묻고 폴더 하나를 열게 하는 자리가 이 앱에는 비어 있었고, "무엇을 눌러야 시작인지" 는 카드 하나(＋ 추가)에만 있었다.

세 판을 묻는 창을 넣었다 — **언어 · 모양 · 첫 프로젝트**. 셋으로 끊은 기준은 "되돌릴 수 없거나(언어·기록), 안 물으면 앱을 못 쓰는 것(프로젝트)" 이다. 모델·API 키·자동화는 필요한 자리에서 묻는 편이 낫다 (첫 실행에 다 물으면 아직 무엇인지 모르는 것에 답하게 된다).

- **언어** — 시스템/한국어/English. 여기서는 **AI 작성 언어(`contentLanguage`)도 함께** 맞춘다. 설정 화면은 일부러 따라가지 않고 토스트로 묻는 축이지만(디스크에 남는 문서라 되돌리기 어렵다), 첫 실행에는 아직 일지가 한 건도 없어 섞일 이력 자체가 없다.
- **모양** — 밝게/어둡게/시스템 + 강조색 6. 미리보기 상자를 두지 않는다 — 누르면 이 창을 포함한 앱 전체가 그 색이 되는 것이 곧 미리보기다(테마 편집기와 같은 관용구).
- **첫 프로젝트** — 「폴더 열기」(기존 저장소 추적) · 「새로 시작」(그린필드 마법사로 인계) · 건너뛰기. 폴더를 들여오면 마무리 판이 서서 방금 만든 것(`.oculpm/` · `AGENTS.md`)을 말하고 「프로젝트 열기」로 그 탭을 승격시킨다.

## 동작 흐름

1. `StartTab` 이 설정과 프로젝트 목록을 둘 다 읽은 뒤 `shouldOpenWelcome()` 로 판정한다 — **`onboarded=false` 이고 등록된 프로젝트가 0개** 일 때만 켠다. 두 번째 조건이 없으면 `onboarded` 키가 없던 **기존 설치본 전부**가 업데이트 직후 안내를 다시 받는다. 목록 조회가 실패했을 때는 판정하지 않는다(빈 목록을 "0개" 로 읽으면 같은 오발이 난다).
2. 켠 뒤에는 조건이 깨져도(마법사 안에서 프로젝트를 들여오면 목록이 1개가 된다) 닫지 않는다 — 닫는 것은 마법사 몫이다.
3. **어느 출구로 나가도 `onboarded` 를 적는다** — 끝내기·건너뛰기·Esc. 한 번 본 창이 다시 뜨면 그건 버그로 읽힌다.
4. 마법사는 `React.lazy` 청크다 (그린필드 마법사와 같은 이유 — 평생 한 번 쓰는 화면이 매 실행의 진입 청크에 실릴 이유가 없다). 빌드에서 `WelcomeWizard-*.js` + `WelcomeWizard-*.css` 로 갈라지는 것을 확인했다.

곁가지: 강조색 6종 표(`ACCENTS`)가 설정 탭 안에 있어 마법사가 같은 표를 두 벌 갖게 될 뻔했다 — `features/theme/accents.ts` 로 빼서 양쪽이 한 벌을 본다. 새 설정 키는 `onboarded`(boolean, 기본 false) 하나뿐이다.

## 검증

- `pnpm vitest run src/__tests__/welcome_wizard.test.tsx` — 13 통과. 게이트 5(기존 사용자 보호·재현 금지·읽기 전 판정 금지·배경 탭)와 흐름 8(언어 2키 동시 기록·테마/강조 즉시 적용·폴더→마무리→열기·취소는 제자리·건너뛰기/Esc 가 `onboarded` 기록·그린필드 인계·이미 끝낸 설정은 다시 안 씀).
- `pnpm typecheck` · `pnpm test`(137 파일 1678건) · `pnpm build` 전부 exit 0. `pnpm lint:storage` · `lint:i18n` 통과.
- `lint:bindings` 는 이 세션 밖에서 생긴 미추적 파일(`src/api/declarativeConfig.ts`) 때문에 붉다 — 이 작업과 무관하다.

## 메모

실기기 확인은 아직이다(설치본이 도는 중에 dev 빌드를 띄우지 않는다는 규율). 사용자가 앱을 껐을 때 `onboarded` 를 지우고 한 번 눈으로 볼 필요가 있다.
