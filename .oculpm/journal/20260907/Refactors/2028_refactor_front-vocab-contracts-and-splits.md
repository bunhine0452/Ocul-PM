---
schema_version: 1
type: refactor
slug: "front-vocab-contracts-and-splits"
status: done
difficulty: medium
created_at: "2026-09-07T20:28:47+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context) · Sonnet 5"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: create
  - path: "src/features/planner/PlanBody.tsx"
    op: create
  - path: "src/features/planner/PhaseCard.tsx"
    op: create
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/useDiffChanges.ts"
    op: create
  - path: "src/features/diff/changeList.ts"
    op: create
  - path: "src/features/today/HonestyAudit.tsx"
    op: update
  - path: "src/features/settings/tabs/AppearanceTab.tsx"
    op: update
  - path: "src/features/onboarding/WelcomeWizard.tsx"
    op: update
  - path: "src/features/theme/ThemeGallery.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
related: []
tags:
  - "ui"
  - "tokens"
  - "refactor"
  - "v3-release"
  - "mcp-tool"
---
[x] 화면이 한 어휘로 말하고, 두 큰 화면이 갈라진다

## 동기

v3-release 「기둥 2 이월」 중 어휘·계약이 갈려 있던 자리들과, 래칫이 정확히 가리키고 있던
파일 크기 부채.

## 변경 요약

**어휘** — 화면별 CSS 의 글자 크기 리터럴 **40곳**을 램프 토큰(`--fs-0`~`--fs-12`)으로 치환
(`bootsplash.css` 는 테마 CSS 이전 첫 페인트라 의도적 예외로 남겼다). 임의 z 값 5곳을
`z-popover`/`z-modal`/`z-top` 어휘로 옮겼다 — 쌍별 쌓임 순서가 전부 보존되는지 확인했고,
`AppDialog`(95)·`CommandPalette`(100)가 같은 층으로 합쳐진 자리만 DOM 순서가 타이를
가른다(팔레트가 `ShellV2` 뒤에 마운트되므로 결과는 종전과 같다). `.empty-hint` 호출부 5곳을
`EmptyState` 로 옮기고 죽은 CSS(`.docs-empty*`·`.code-empty-*`·`.search-noindex*`·`.pm-empty*`)를
지웠다. `primitives.css` 의 `.empty-hint` 자체는 **남겼다** — branch·today(2)·diff·journal 에
실사용 4화면이 아직 있다.

**계약** — 소유 밖 `void set(...)` 8자리를 `useSaveSetting` 으로 이행했다. `WelcomeWizard.seal()`
이 `await set(...)` 을 쓰고 있어 동기 함수로 바꾸고 호출 체인도 정리했다 —
`SettingsContext.set` 이 내부에서 실패를 잡아 토스트하고 절대 reject 하지 않음을 코드로
확인한 뒤라 동작 변경이 아니라 계약 통일이다. `MenubarSection` 이 마운트 시 `settingsGetAll`
실패를 조용히 삼켜 트레이 토글이 이유 없이 비활성으로 남던 것을, 같은 컴포넌트의 `toggle()`
이 이미 쓰는 표면(`reportRejection` + 토스트)으로 통일했다.

**`{#honesty-audit-unhide}`** — 0건이면 카드째 사라지던 것을 고쳤다. 이 카드는 "누락 없음"을
**주장한다** — 주장하는 카드가 숨으면 "안 봤다"와 "봤는데 깨끗하다"가 화면에서 구별되지
않는다. `JournalMissingCard` 의 `{#card-unhide}` 와 같은 선으로, 0건일 때 경고색 없이 0과
**판정의 한계**를 함께 적는다.

**분할** — `PlannerScreenV2` 1,149→**376**줄(`usePlanDocument.ts` 546 · `PlanBody.tsx` 236 ·
`PhaseCard.tsx` 166), `DiffScreenV2` 799→**335**줄(`useDiffChanges` 255 · `useDiffFile` 180 ·
`useDiffSearch` 98 · `DiffBody` 116 · 순수 `changeList.ts` 55). 분할 축은 이 저장소가 이미 쓰는
결(`features/sessions`·`features/today`)을 따랐고, 래칫 때문에 **압축된 한 줄로 욱여넣었던**
빈 상태 JSX 를 읽히는 형태로 되폈다. `DiffScreenV2` 에 박혀 있던 순수 계산 셋(목록 병합
우선순위 · git 행→모델 변환 2곳 중복 · 기준선 자동 선택)을 `changeList.ts` 로 빼고 테스트
7케이스를 붙였다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(186파일 / 2,426건) · `pnpm build`
전부 exit 0. eslint 경고는 착수 전과 같은 **정확히 50**(래칫 상한, 신규 0). 분할은 순수 추출로
렌더 결과·props 계약·훅 순서·effect 의존성을 그대로 옮겼다. 파일 크기 기준선은
`check-file-sizes.mjs` 가 merge-base 에서 매번 읽으므로 커밋과 함께 자동으로 내려간다.

**육안 미확인** — 이번 변경은 *보이는 것*을 바꿨는데 앱을 띄우지 않았다. v3-release 의
`{#eyes-tw-scale}`·`{#eyes-modal-scrim}` 과 같은 성격이라 육안 대장에 남는다.