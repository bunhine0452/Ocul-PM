---
schema_version: 1
type: feature
slug: "pause-animations-when-inactive"
status: done
difficulty: low
created_at: "2026-10-08T19:06:36+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/idleMotion.ts"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/__tests__/idle_motion.test.ts"
    op: create
related: []
tags:
  - "performance"
  - "ui"
  - "mcp-tool"
---
[x] 창을 보고 있지 않으면 무한 반복 애니메이션을 멈춘다

## 추가 기능
`lib/idleMotion.ts` 는 포커스가 없거나 가려지면 `<html data-app-inactive>` 를 단다. blur 는 다음 틱에 판정해, 창 안 iframe 으로 간 포커스를 비활성으로 오인하지 않는다. `main.tsx` 갈림길 위에서 걸어 세 갈래 창 모두에 적용된다. `primitives.css`(App.css 를 통해 전역)가 그 아래의 `animation-play-state` 를 paused 로 바꾼다. 컴포넌트의 `animation` 단축 속성이 재생 상태를 되돌리므로 `!important` 다.

## 동작 흐름
측정 근거: 입력 없는 설치본이 CPU 를 웹뷰 8.5% · UI 3.7% · GPU 3.2% 썼고, UI 프로세스의 CVDisplayLink 가 상시 돌았다. 무한 애니메이션은 29곳이고, 터미널 running/waiting 숨쉬기는 claude 가 떠 있는 내내 돈다. 색 · 모양은 남고 움직임만 선다. 터미널 WebGL rAF 는 출력이 있을 때만 돌아서 건드리지 않았다.

## 검증
vitest `idle_motion.test.ts` 3건(속성 토글 · hidden 판정 · 전역 CSS 규칙). **효과는 아직 재지 못했다** — 설치본이 도는 동안 dev 빌드를 띄울 수 없다. 다음 설치본에서 top 으로 전후를 잰다.