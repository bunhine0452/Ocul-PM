---
schema_version: 1
type: refactor
slug: "page-enter-rule-was-already-there"
status: done
difficulty: low
created_at: "2026-09-09T23:23:29+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
  - path: "src/features/skills/PluginDocsTab.tsx"
    op: update
related: []
tags:
  - "design"
  - "motion"
  - "page-enter"
  - "mcp-tool"
---
[x] 규칙은 이미 있었고 한 자리에만 적혀 있었다 — 화면 진입 애니메이션

## 동기

`{#layout-page-enter}` 는 "`.page fade-in` 8곳 vs 맨 `.page` 8곳" 이라고만 적혀 있었다. 실측하니 **19곳**이고 8 : 11 이었다 — 숫자부터 틀렸지만, 더 중요한 건 그 11곳이 뒤죽박죽이 아니었다는 점이다.

`DiffScreenV2.tsx:197` 이 규칙을 이미 알고 있었다:

```tsx
<div className={"page" + (list.listLoading ? "" : " fade-in")}>
```

**로딩 중에는 진입 애니메이션을 걸지 않는다.** 자리끼가 떠오른 뒤 진짜 내용이 또 떠오르면 한 번의 도착이 두 번 움직이고, 스켈레톤은 이미 자기 맥동을 갖는다. 이 규칙이 한 자리의 삼항 연산자 안에만 적혀 있었다.

## 실측 — 19곳을 셋으로 가르면

| 갈래 | 규칙 | 맞음 | 어긋남 |
|---|---|---|---|
| 화면 루트 · 내용 확정 | 붙인다 | 8 | **4** |
| 로딩(Skeleton · Spinner · LoadingState) | 안 붙인다 | 5 | 0 |
| 모달 본문(AppDialog 가 자기 등장을 가짐) | 안 붙인다 | 1 | **1** |

로딩 다섯은 **전부** 맞게 안 붙어 있었다. 규칙이 없어서 흩어진 게 아니라, 규칙이 있고 적히지 않아서 다섯 자리가 어긋난 것이다.

어긋난 다섯 중 가장 말이 되는 증거는 마지막 한 줄이다 — `PluginDocsTab`(붙음)과 `SkillShopTab`(안 붙음)은 **같은 종류의 모달 본문**인데 정반대다. 둘 다 AD-3 에서 화면에서 모달로 내려온 형제이고, 바로 앞 커밋에서 둘의 죽은 `<Toolbar>` 를 같이 걷어낸 자리다. 같은 표면이 두 손을 거쳤다는 게 그대로 남아 있었다.

## 변경 요약

확정 상태인데 빠진 넷에 붙였다 — 코드 화면 오류(`CodeScreenV2`), 스킬 목록 오류와 스킬 본문(`SkillsScreenV2` ×2), 규칙 편집기 오류(`ContextEditor`). 모달 본문인데 붙어 있던 하나(`PluginDocsTab`)를 뗐다.

그리고 **규칙을 정의 자리에 옮겨 적었다** — `primitives.css` 의 `.fade-in` 바로 위. 붙일지 말지 고민할 사람은 삼항 연산자가 아니라 정의를 보러 온다.

**게이트는 일부러 안 걸었다.** 이 규칙의 위반 다수가 "클래스가 **빠진** 것" 인데, 빠진 것을 잡으려면 그 `.page` 가 로딩인지 확정인지를 정적으로 알아야 하고 그건 JSX 분기를 읽는 일이다. 이 라운드가 세운 게이트 23개는 전부 "쓰면 안 되는 것을 썼다" 를 잡는 것들이고, "써야 할 것을 안 썼다" 는 다른 종류의 문제다 — 못 잡을 게이트를 세우면 다음 사람이 게이트를 믿는다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9 = 기준선) · `pnpm test` · `pnpm build` 각각 exit 0 직접 확인. 변경 후 재분류: fade-in 11 + 조건부 1 / 안 붙임 7(로딩 5 + 모달 본문 2) = 19. 사용자가 이 라운드의 누적 시각 변화를 실기기에서 확인해 이상 없음을 확인했고, 이번 다섯 자리는 그 이후의 변화라 다음 확인 대상이다.