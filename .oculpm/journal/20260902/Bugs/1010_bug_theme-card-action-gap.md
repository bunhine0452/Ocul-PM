---
schema_version: 1
type: bug
slug: theme-card-action-gap
status: done
difficulty: low
created_at: 2026-09-02T10:10:00+09:00
session_id: manual-20260902-095001
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: landing/page.css
    op: update
related: []
tags: [landing, themes, css, layout]
---

[x] 테마 카드의 「앱에서 가져오기 · .json 내려받기」가 색 견본에 붙어 버리던 문제

## 발생 원인

`.th-card > .pg-actions, .th-card > .th-note { margin-top: auto; }` — 카드 안에서
액션 줄을 바닥에 붙이려고 넣은 규칙이다. 그런데 이 `margin-top: auto` 가 바로 위의
`.th-card .pg-actions { margin: 15px 17px 17px }` 가 주던 **위쪽 15px 을 덮어쓴다**
(선택자 특이도가 같아 뒤에 온 쪽이 이긴다).

flex column 에서 `margin-top: auto` 는 "남는 높이를 전부 이 여백에 몰아준다"는 뜻이라,
남는 높이가 있을 때만 간격이 생긴다. 그리드 행의 카드들은 서로 높이가 같게 늘어나고
14장 모두 구조가 동일해서 **남는 높이가 언제나 0** — 결국 모든 카드에서 위 여백이
0 이 되어 버튼이 색 견본 줄에 그대로 달라붙었다. 카드가 서로 다른 높이였다면 우연히
간격이 생겨 안 보였을 버그다.

`82d6609`(테마 갤러리 14종 확장 · 카드를 앱 축소판으로)에서 들어왔다.

## 해결 방법

바닥 정렬을 여백이 아니라 **남는 높이를 흡수할 대상**으로 옮겼다 — `.th-meta` 에
`flex: 1 1 auto` 를 주고, `margin-top: auto` 규칙 한 줄을 지웠다. 메타가 늘어나면서
액션 줄은 자연히 바닥에 남고, `.pg-actions`(15/17/17)와 `.th-note`(14/17/17)는 각자
정의한 여백을 그대로 되찾는다.

## 검증

로컬 서버로 `/themes.html` 을 띄우고 크롬에서 확인 — 색 견본과 버튼 사이 15px 이
돌아왔고, 「앱 내장」 5종의 `.th-note` 카드도 점선 구분선 위 여백을 되찾았다.
행 안에서 카드 바닥 정렬은 그대로다. `landing_themes` · `landing_pages` 51개 통과.
