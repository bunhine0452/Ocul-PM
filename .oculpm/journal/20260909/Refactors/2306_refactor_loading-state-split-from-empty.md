---
schema_version: 1
type: refactor
slug: "loading-state-split-from-empty"
status: done
difficulty: medium
created_at: "2026-09-09T23:06:14+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/LoadingState.tsx"
    op: create
  - path: "src/styles/empty.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/__tests__/firstrun_honesty.test.tsx"
    op: update
  - path: "src/features/settings/automation/AutomationHistory.tsx"
    op: update
  - path: "src/features/today/PlanUpdates.tsx"
    op: update
  - path: "src/features/today/DiscussionPending.tsx"
    op: update
  - path: "src/features/today/NextTasks.tsx"
    op: update
  - path: "src/features/today/WhatsNewCard.tsx"
    op: update
  - path: "src/features/chat/ConversationHistoryModal.tsx"
    op: update
  - path: "src/features/diff/BinaryFileView.tsx"
    op: update
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
related: []
tags:
  - "design"
  - "loading"
  - "a11y"
  - "component"
  - "gate"
  - "mcp-tool"
---
[x] 「기다리면 채워진다」와 「원래 비어 있다」가 픽셀 단위로 같았다

## 동기

`{#layout-loading-state}` 의 주장을 실측했다. 감사가 든 7곳(PlanUpdates·DiscussionPending·NextTasks·WhatsNewCard·ConversationHistoryModal·BinaryFileView·AutomationHistory)은 **맞았고**, `ContextEditor` 하나가 더 있어 **8곳**이었다. (첫 grep 이 7곳 중 셋을 놓쳤는데, 그 셋은 `common.loading` 이 아니라 `today.whatsNew.loading`·`chat.loading`·`diff.previewLoading` 이라는 자기 키를 쓴다 — 키로 세면 안 되고 컴포넌트로 세야 했다.)

문제는 "같은 컴포넌트를 쓴다" 가 아니라 **다섯 곳에서 두 분기가 같은 컴포넌트에 같은 props** 였다는 것이다:

```tsx
preview === "loading"  ? <EmptyState style={{ padding: 16 }}>{t("diff.previewLoading")}</EmptyState>
: preview === "error"  ? <EmptyState style={{ padding: 16 }}>{t("diff.previewUnavailable")}</EmptyState>
```

문자열만 다르고 화면은 픽셀 단위로 같다. 그런데 이 둘은 **정반대의 행동을 요구한다** — 하나는 기다려라, 하나는 무언가를 해라. 게다가 어느 쪽에도 `role` 이 없어 보조기술은 상태가 바뀐 것조차 듣지 못한다.

## 변경 요약

**`LoadingState` 는 `EmptyState` 를 대체하지 않고 그 치수를 물려받는다.** `.es .es--plain` 을 그대로 입고 `.ls` 가 행 배치(flex·gap)만 더한다. 여백을 새로 쓰지 않은 것이 요점이다 — 옮기는 동안 여덟 자리의 레이아웃이 흔들리지 않고, 갈리는 것은 **움직이는 도형 하나**뿐이다. 브랜드 스피너가 도니까 "기다리는 중" 이 설명 없이 읽힌다.

접근성은 둘. 컨테이너가 `role="status"` 를 지고(빈 상태에는 없다 — 상태 변화가 아니니까), 스피너는 `aria-hidden` 으로 감쌌다. `OculSpinner` 가 자기 `aria-label`("불러오는 중")을 갖고 있어서 감싸지 않으면 보조기술이 같은 말을 두 번 읽는다.

문안은 자리가 정한다 — 인자가 없으면 `common.loading`, 있으면 그것. 「미리보기를 불러오는 중」 같은 구체적 문안 셋은 **일부러 통일하지 않았다**. 감사의 지적은 화면이 같다는 것이지 문안이 갈린다는 것이 아니고, 구체적인 쪽이 더 나은 문안이다.

**게이트를 세웠다** — 규칙 16 `loading-as-empty`: `<EmptyState>{t("…loading")}</EmptyState>` 를 잡는다. 여덟 번 같은 실수가 났다면 열 번째도 난다. `src/__probe__/` 에 위반 샘플을 넣어 발화를 확인하고(exit 1, 정확한 줄·힌트 출력) 지운 뒤 clean(exit 0)을 다시 확인했다.

**게이트가 나를 한 번 잡았다.** 스피너를 `size={14}` 로 넣었는데 `icon-size` 규칙이 램프(11·13·15·18·22·30)에 14가 없다고 막았다. 13으로 내렸다 — 규칙이 아니었으면 램프 밖 한 단이 조용히 늘었을 자리다.

## 남은 것

「불러오는 중」의 나머지 어휘는 그대로다 — 임시 muted `div`/`p`/`span` 이 12곳(GraphInspector 3 · EntryDetailView 2 · CodePane · CodePreview · SearchScreenV2 · DataTab · CodeSettings · PlanItemRow · mobile/EntryDetail), `OculSpinner` 라벨 모드 4곳, `Skeleton`. 이번에 고친 것은 **로딩이 빈 상태와 구분되지 않던** 날카로운 결함이고, 세 어휘를 하나로 접는 것은 별개의 더 큰 단위다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9 = 기준선) · `pnpm test`(195파일 **2,554** — LoadingState 계약 3개 추가) · `pnpm build` 각각 exit 0 직접 확인. 계약 테스트는 셋을 문다: `.es--plain` 을 입는가(자리 불변), `role="status"` + 스피너 `aria-hidden`(빈 상태와 갈리는 지점), 문안 폴백. **실기기 육안 확인은 이 라운드의 다른 커밋들과 함께 남아 있다** — 여덟 자리에 없던 스피너가 생기는 시각 변화다.