---
schema_version: 1
type: bug
slug: "uiv2view-route-safety"
status: done
difficulty: medium
created_at: "2026-09-06T12:45:24+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/contexts/uiV2View.ts"
    op: create
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/__tests__/uiv2view_route_safety.test.ts"
    op: create
  - path: "scripts/check-no-localstorage.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "v3-surface"
  - "shell"
  - "routing"
  - "migration"
  - "mcp-tool"
---
[x] 저장된 화면 이름이 검증을 지난다 — 라우터가 빈 본문으로 끝나지 않게

기둥 2(`v3-surface`)의 Phase 0 — **화면 id 를 하나라도 없애기 전에** 세워야 하는 안전망. 이어지는 IA 재편이 사이드바 행을 17→15 로 줄이므로, 그 전에 저장된 값이 사라진 화면을 가리킬 때 어떻게 되는지를 먼저 막았다.

## 발생 원인

`uiV2View` 는 프로젝트마다 `localStorage` 에 영속되는데 **읽을 때 검증이 하나도 없었다**. `ShellV2` 라우터는 긴 ternary 사슬이고 마지막 갈래가 `: null` 이라, `view` 가 어떤 갈래에도 안 맞으면 툴바도 콘텐츠도 없는 **빈 본문**이 남는다. 사이드바는 살아 있으니 앱이 죽은 것처럼 보이지도 않고, 그냥 아무것도 없다.

허용 목록은 있었다 — 그런데 `ShellV2.KNOWN_VIEWS` 에 **손으로 적은 두 번째 사본**이었고 트레이 딥링크·URL 에만 걸려 있었다. 타입(`UiV2View` 유니온)과 런타임 목록이 따로 있으니 갈라질 자리가 구조적으로 열려 있었고, 정작 가장 흔한 입력 경로인 "저장된 값"은 아무 문도 지나지 않았다.

## 해결 방법

목록을 **하나로** 만들고 그 하나가 세 입구를 전부 지키게 했다.

- `src/contexts/uiV2View.ts` 를 새로 떼어 `UI_V2_VIEWS` 배열을 정본으로 두고 타입을 **배열에서 파생**(`(typeof UI_V2_VIEWS)[number]`)시켰다. 손으로 쓴 유니온이 사라졌으니 목록과 타입이 어긋날 수 없다. 컨텍스트가 그대로 재수출해 소비처의 import 경로는 그대로다.
- `migrateUiV2View(raw)` 를 `migrateActiveView` 옆에 두고 `loadFromStorage` 에서 부른다 — 딥링크에만 서 있던 허용 목록이 이제 **영속값에도** 선다.
- `ShellV2.KNOWN_VIEWS` 는 그 배열을 가리키는 별칭이 됐다.
- 라우터의 마지막 `: null` 을 Today 로 바꿨다. 런타임 `setUiV2View` 는 마이그레이션 문을 지나지 않으므로 이중 방어가 필요하다. Today 갈래를 사슬 위에서 아래로 **옮긴** 것이라 코드가 두 벌이 되지 않는다.

파일을 떼어 낸 것은 크기 래칫 때문이기도 하다 — `WorkspaceContext.tsx` 가 1,241줄 상한에 붙어 있어서 24줄만 늘어도 게이트가 붉어졌다. 결과적으로 1,222줄로 내려갔다.

게이트 두 개에 예외를 추가했다: 새 테스트가 검사 대상인 `localStorage` 레코드를 직접 심어야 해서 `check-no-localstorage.mjs` 허용목록에, 테스트 이름이 한국어라 `check-no-hardcoded-korean.mjs` 의 `TESTS` 집합에 넣었다.

## 검증

`pnpm typecheck` · `pnpm test`(178파일 2,326건) · `pnpm lint`(6게이트, eslint 경고 61 = 래칫 그대로) 전부 exit 0. 새 테스트 5건이 ① 현재 화면 이름은 통과 ② 없어진 이름·타입이 어긋난 값은 today 로 ③ 저장된 레코드를 실제로 심고 `WorkspaceProvider` 를 마운트해 today 로 열리는지 를 못 박는다.