---
schema_version: 1
type: feature
slug: "planner-redesign-sheet"
status: done
difficulty: high
created_at: "2026-09-10T23:24:54+09:00"
session_id: "20260910-006"
agent:
  id: "claude-code"
  session: "ce6e3504-bf40-48a3-95c2-7760471489a8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/StatusMark.tsx"
    op: create
  - path: "src/features/planner/PlanBody.tsx"
    op: update
  - path: "src/features/planner/PhaseCard.tsx"
    op: update
  - path: "src/features/planner/PlanItemRow.tsx"
    op: update
  - path: "src/features/planner/NextUp.tsx"
    op: update
  - path: "src/features/planner/PlanBoard.tsx"
    op: update
  - path: "src/features/planner/StatusMenu.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/planMeta.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/plan_body_upgrade.test.tsx"
    op: update
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
  - path: ".oculpm/planner/v3-release.md"
    op: update
related:
  - ref: "20260910/Features_to_add/2125_feature_planner-cockpit-upgrade.md"
    kind: "followup"
  - ref: "20260910/Features_to_add/2159_feature_planner-kanban-board.md"
    kind: "followup"
tags:
  - "planner"
  - "ui"
  - "design"
  - "redesign"
  - "a11y"
  - "mcp-tool"
---
[x] 플래너 리디자인 — 카드 무더기를 한 장의 시트로, 글리프를 마크로

## 추가 기능

사용자 판정: 「플래너 UI 가 너무 아마추어 같다 — 완전히 새롭게」. 설치본이 도는 중이라 dev 빌드를 못 띄우므로, **하네스**를 만들어 진단부터 했다 — vitest 로 `PlanBody`+`PlanRail`+`Toolbar` 의 DOM 을 덤프하고 실제 `tokens/primitives/base/shell/screens.css` 와 Pretendard 를 입혀 로컬 http 로 Chrome 에서 찍었다 (라이트/다크 · 문서/보드/남은것만 · 폭 780/600).

진단 — 아마추어로 읽힌 이유 넷:
1. **카드 안의 카드** — 머리글·다음 할 일·단계마다 같은 곡률·같은 그림자의 카드. SaaS 카드 키트의 전형.
2. **유니코드 글리프**(☐ ▣ ☑ ⚠︎ → ✗) — OS 서체가 그려 굵기·기준선이 제각각, ⚠ 는 이모지 폰트로 샜다.
3. **취소선 벽** — 완료 32개가 코드 칩째 취소선. 
4. **행마다 되풀이되는 메타** — 「일지 · Claude Code · 4시간 전 🕐」 이 15줄.

설계 — 계획은 디스크의 마크다운 한 장이니 화면도 **한 장의 시트**로:
- **머리글(masthead)**: 20px 제목 · 한 줄 상태 문장(칩 제거) · **단계 스트립** — 조각 하나가 단계 하나, 폭은 항목 수, 색은 완료/진행/막힘. 누르면 그 단계 머리로 뛴다. 「어느 단계가 막혔나」 를 스크롤 없이 본다. 스트립 규칙은 `planMeta.phaseStrip()` (순수) · 범례는 `StatusMark` 로.
- **`StatusMark.tsx`** — 여섯 상태를 CSS 원 한 벌로 (빈 링 / 반 찬 링 / 찬 원+체크 / 빨간 원+! / 점선 링+화살 / 흐린 링+×). 행·다음 할 일·보드 열 머리·상태 메뉴·범례가 전부 이것 하나. `aria-hidden`, 이름은 호출부 title/aria.
- **단계 = 절**: 카드 대신 `<section>` + 위에 붙는(sticky) 머리. 이름 · 에이전트 · 막힘 배지 · done/total.
- **행 = 세 열 격자** `[마크 | 제목 | 메타]`: 메타는 오른쪽 한 열에 22px 로 정렬 — 일지 아이콘(+건수) · 에이전트 점+시각(이름은 툴팁) · hover 에만 드러나는 실행/▾/✎/🗑. 완료 행은 취소선이 아니라 흐려진다. 컨테이너 720 이하면 메타가 제목 아래로.
- **다음 할 일**: 그림자 카드 → 들어간 면(`--bg-inset`) 한 칸.
- **보드**: 열의 면을 지우고 상태색 위 선 하나로, 카드는 그림자 없는 hairline.
- 작성기(새 계획/새 항목)·경고·결정도 같은 어휘(들어간 면·hairline)로.

## 동작 흐름
데이터·핸들러는 무변경 — `usePlanDocument` → `PlanBody` → `PhaseCard` → `PlanItemRow` 의 props 계약 그대로. 바뀐 건 마크업·CSS·마크 컴포넌트뿐. 스트립 조각 클릭 → `[data-phase]` 로 scrollIntoView. 상태 토글은 이제 글자가 아니라 `.pmark.is-<status>` 클래스가 말한다 (tools_v2 U9 테스트를 그렇게 고침).

## 검증
- `pnpm typecheck` · `pnpm test` 203 파일 2619 통과 (plan_body_upgrade 는 스트립 조각 aria-label 로 단언을 옮김) · `pnpm lint` 6 게이트 초록 (design discipline clean — 곡률·무게·전이·높이 전부 램프) · `pnpm build` 성공.
- 하네스 스크린샷으로 라이트/다크 · 문서/보드/남은것만 · 폭 780/600 · 행 hover · 스티키 머리 확인.
- **WKWebView 실기기는 미확인** — v3-release `{#eyes-planner-redesign}` 로 이월. 미커밋 (오늘 앞 두 라운드와 함께 워킹트리에 있음).