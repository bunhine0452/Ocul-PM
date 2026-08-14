---
schema_version: 1
type: bug
slug: "composer-knob-popovers-clipped-by-scroll"
status: done
difficulty: low
created_at: "2026-08-15T05:04:50+09:00"
session_id: "mcp-20260815-050450"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/agent.css"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "css"
  - "regression"
  - "mcp-tool"
---
[x] 하단바 노브를 눌러도 아무것도 안 뜨던 것 — 좁은 폭 방어가 자기 팝오버를 잘랐다

## 같은 함정을 하루에 두 번

컴포저 하단바의 노브(권한 모드·모델·Effort·더보기)를 눌러도 아무 것도 안 떴다. 상태는 멀쩡히 바뀌고 있었고, 팝오버가 **잘려서** 안 보인 것이다.

원인은 내가 어제 넣은 좁은 폭 방어다. 하단바가 터지는 것을 막으려고 가운데 노브 묶음에 `overflow-x: auto` 를 걸었는데, `overflow-x` 가 `auto` 면 `overflow-y` 도 `visible` 로 남지 못한다(명세상 `auto` 로 계산된다). 위로 펼치는 팝오버가 그 상자에 통째로 잘렸다.

**툴바에서 사용량 카드가 안 뜨던 것과 정확히 같은 함정**이다. 그때는 포털로 빠져나갔다. 여기서는 그럴 필요가 없다 — 스크롤 대신 **줄바꿈**으로 좁은 폭을 받으면 된다. 두 줄이 되더라도 눌리는 버튼이 낫다.

교훈 한 줄: **팝오버를 품은 상자에 overflow 를 걸지 말 것.** 걸어야 한다면 팝오버를 포털로 빼야 한다.

## 검증

typecheck 0 · 프런트 817 · lint 0 · build 0.

**미확인**: 줄바꿈이 실제로 어느 폭에서 일어나는지, 그리고 두 줄이 됐을 때 컴포저 높이가 튀지 않는지는 창을 좁혀 봐야 안다.