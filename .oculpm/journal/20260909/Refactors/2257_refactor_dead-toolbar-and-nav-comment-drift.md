---
schema_version: 1
type: refactor
slug: "dead-toolbar-and-nav-comment-drift"
status: done
difficulty: low
created_at: "2026-09-09T22:57:30+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/SkillShopTab.tsx"
    op: update
  - path: "src/features/skills/PluginDocsTab.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/__tests__/skill_shop.test.tsx"
    op: update
  - path: "src/__tests__/i18n_english_render.test.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
related: []
tags:
  - "design"
  - "dead-code"
  - "a11y"
  - "i18n"
  - "navigation"
  - "mcp-tool"
---
[x] 테스트가 죽은 코드를 붙들고 있어서 그 분기가 살아남았다

## 동기

`{#layout-misc}` 의 남은 둘 — 죽은 `<Toolbar>` 2곳과 `navRegistry.ts` 주석 드리프트. 셋 중 「사이드바 첫 그룹 라벨」은 `488b6fc` 가 이미 해소했다.

## 변경 요약

**1. 죽은 `<Toolbar>` — 왜 죽은 채로 살아남았는지가 본론이다.**

`SkillShopTab` 과 `PluginDocsTab` 은 AD-3(5탭→3존) 재편으로 화면에서 **모달 안 표면**으로 내려왔다. 프로덕션 마운트는 `SkillsScreenV2` 의 `AppDialog` 두 곳뿐이고 둘 다 `embedded` 를 넘긴다. 두 파일의 자기 주석은 이미 그 사실을 알고 있었다 — "화면이 아니므로 자기 Toolbar 를 그리지 않는다 (탭이 사라진 뒤의 유일한 용법)". 주석이 죽었다고 적어 둔 분기를 코드가 계속 들고 있었던 셈이다.

**살아남은 이유는 테스트였다.** `i18n_english_render.test.tsx` 가 `<PluginDocsTab tabs={null} />` 로 **비-embedded** 경로를 렌더하고 `findByText("Skills & rules")` 를 단언하고 있었는데, 그 문자열(`plugin.toolbarTitle`)은 죽은 `<Toolbar>` 안에서만 나온다. 프로덕션 사용자는 이 표면에서 그 제목을 **본 적이 없다** — 모달 제목은 호출부가 `.sk-modal-head` 로 직접 그린다. `skill_shop.test.tsx` 도 5곳에서 `tabs={null}` 로 같은 경로를 밟고 있었다. 테스트가 죽은 코드에 커버리지를 씌워 주면 그 코드는 삭제 후보로 보이지 않는다.

그래서 분기와 함께 이음매를 통째로 걷었다 — `embedded`·`tabs` prop, `Toolbar`·`ReactNode` import, 호출부 두 곳의 `embedded`. 래퍼 클래스도 `embedded ? "sk-shop-embed" : "scroll"` 에서 `sk-shop-embed` 로 접혔다. 영어 렌더 테스트의 단언은 **실제로 렌더되는** chrome 으로 옮겼다(`Suggested flow`·`Slash commands`) — 검사의 목적(chrome 이 영어인가)은 그대로 두고 대상만 살아 있는 것으로 바꿨다.

**일부러 남긴 것**: `plugin.toolbarTitle`·`plugin.toolbarSub`·`shop.toolbarSub` 세 키는 이름에 「toolbar」가 남았지만 **값은 호출부가 여전히 쓴다**(모달 label 과 머리). 고아 키가 아니라 이름만 낡은 것이라, 사전 두 벌을 건드리는 개명은 이 항목의 범위 밖으로 뒀다.

**2. 주석 드리프트 — 틀린 쪽이 어느 쪽인지 적었다.**

`navRegistry.ts:117` 이 「에이전트」를 "⌘0 을 갖는 열 번째 칸" 이라 했는데, 배열에서 index 8 이라 실제는 아홉 번째 칸의 ⌘9 다(⌘0 은 「AI 패널」). 실측하다 보니 `nav_registry.test.ts:77` 이 이미 `navShortcutLabel("claudecode") === "⌘9"` 를 못박고 있었다 — **동작은 테스트가 지키고 있고 주석만 어긋나 있었다.** 그래서 숫자만 고치지 않고, 주석과 테스트가 갈리면 틀린 쪽은 주석이라는 문장을 함께 남겼다. 새 테스트는 더하지 않았다 — 이미 있다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9 = 기준선) · `pnpm test`(195파일 2,551) · `pnpm build` 각각 exit 0 직접 확인. 테스트 수가 그대로라는 게 요점이다 — 죽은 경로를 밟던 단언 6개를 살아 있는 표면으로 옮겼고 커버리지를 잃지 않았다.