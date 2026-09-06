---
schema_version: 1
type: refactor
slug: "empty-state-one-component"
status: done
difficulty: medium
created_at: "2026-09-06T13:04:22+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/EmptyState.tsx"
    op: create
  - path: "src/styles/empty.css"
    op: create
  - path: "src/styles/index.css"
    op: update
related: []
tags:
  - "v3-surface"
  - "ui"
  - "empty-state"
  - "design-system"
  - "mcp-tool"
---
[x] 빈 상태를 하나로 — 두 밀도, 일러스트 없음

기둥 2(`v3-surface`)의 `{#empty-state-component}`.

## 동기

빈 상태를 그리는 방법이 세 갈래로 갈려 있었다 — `.empty-hint` 가 52곳, 화면 전용 리치 컴포넌트가 3벌(docs·code·graph), 전용 클래스가 8종. 같은 뜻을 세 문법으로 적고 있었고, 첫날 안 사는 화면 12개를 손보려면 먼저 문법이 하나여야 했다(`{#first-day-screens}` 가 이 위에 선다).

## 변경 요약

`src/components/EmptyState.tsx` 하나로 모았다. **두 밀도**를 갖는다 — `plain`(한 줄짜리 힌트)과 `rich`(아이콘 + 제목 + 설명 + 행동). **일러스트는 넣지 않았다**: 이 앱은 밀도 도구이고, 빈 화면에 그림을 채우는 것은 "여기 아무것도 없다"를 감추는 쪽이다.

스타일은 새 `src/styles/empty.css` 에 두고 `index.css` 에 import 한 줄만 더했다. `tokens.css`·`screens.css` 는 같은 라운드의 방언 수렴 레인이 통째로 손보는 중이라 같은 파일을 두 방향에서 고치지 않기 위해서다.

`.empty-hint` 호출부 40여 곳과 리치 3벌을 흡수했다.

## 안 옮긴 것 — 의도적으로

`today/WhatsNewCard.tsx:90,94` · `today/CoreModelSeededCard.tsx:34` · `JournalScreenV2.tsx:537` 은 `.empty-hint` 를 **빈 상태가 아니라 흐린 글씨 스타일**로 쓴다. EmptyState 로 옮기면 60px 패딩이 붙어 레이아웃이 깨진다 — 클래스 이름이 같다고 같은 뜻이 아니다.

`chat/` · `sessions/` · `settings/` 의 호출부는 병렬 레인이 동시에 고치고 있어 건너뛰었다(`ConversationHistoryModal.tsx:112,114` · `automation/AutomationHistory.tsx:56,57` · `automation/AutomationTab.tsx:225,287`). 그래서 `primitives.css` 의 `.empty-hint` 규칙도 아직 지우지 못한다. 죽은 CSS 도 남았다 — `docs.css` 의 `.docs-empty*` · `code.css` 의 `.code-empty-*` · `screens.css` 의 `.search-noindex*`.

`PlannerScreenV2.tsx`(1,149줄)와 `DiffScreenV2.tsx`(799/800줄)는 **파일 크기 래칫 때문에** 새 빈 상태 JSX 를 압축된 형태로 넣어야 했다 — 가독성이 나쁘다. 진짜 해법은 두 파일 분할이고, 래칫이 그 부채를 정확히 가리키고 있다.

## 검증

`pnpm typecheck` · `pnpm test`(179파일 2,328건) · `pnpm lint`(eslint 61/61, 증가 0) · `pnpm build` 전부 exit 0. 새 테스트가 두 밀도를 문다.

육안 확인이 남는다: 코드 화면 빈 패널(바깥 래퍼는 유지하고 안쪽만 EmptyState 로 바꿨다 — `flex:1` 중앙 정렬이 그대로인지) · 코드 맵 빈 캔버스(Tailwind 유틸 → 공용 클래스 전환).