---
schema_version: 1
type: bug
slug: "entry-detail-wrap-no-scroll"
status: done
difficulty: low
created_at: "2026-09-13T01:16:08+09:00"
session_id: "20260913-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "d836ae84-44c9-4a22-9d80-9fa0eb4eb5fd"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/entry.css"
    op: update
related: []
tags:
  - "journal"
  - "css"
  - "layout"
  - "entry-detail"
  - "mcp-tool"
---
[x] 일지 열람 화면이 스크롤되지 않고 접힌 아래가 잘리던 버그 수정

## 발생 원인

2026-09-11 「읽는 칸」 리디자인(0e45612)에서 `.entry-detail` 에 `flex-wrap: wrap` 을 두었다 — 컨테이너는 자기 컨테이너 쿼리로 자기 방향을 못 바꾸므로, 좁은 칸에서 자식 둘을 두 줄로 감기게 하려는 장치였다. 그런데 **감기는 flex 컨테이너의 줄 높이는 컨테이너가 아니라 가장 큰 자식의 내용 높이**로 정해진다(spec §9.4 — 단일 줄·정해진 높이일 때만 컨테이너 높이를 쓴다). 높이를 안 준 `.entry-read` 는 본문 길이만큼 자라 `overflow-y: auto` 가 발동할 여지가 없었고, 시트 `.content { overflow: hidden }` 이 접힌 아래를 통째로 잘랐다. 본문이 짧은 일지에서는 `align-content: stretch` 가 줄을 칸 높이까지 늘려 정상처럼 보여 리디자인 때 잡히지 않았다.

Chrome headless 최소 재현: 300px 칸에서 wrap 컨테이너의 읽는 칸 `clientHeight=2816 scrollable=false`, nowrap 이면 `300 / true`.

## 해결 방법

`.entry-read` 와 `.entry-detail-main` 에 `height: 100%` 를 명시. 감기는 줄 안에서도 자식의 가설 높이가 컨테이너 100% 로 잡혀 줄이 칸에 묶이고, 안에서 스크롤한다. 좁은 칸(`@container entry (max-width: 720px)`)은 이미 `height: 50%` 를 주고 있었으므로 같은 원리로 그대로 동작한다. 재현 페이지에 같은 수정을 적용해 `300 / true` 확인.

## 검증

- Chrome headless 재현 페이지: 수정 전 `h=2816 scrollable=false` → 수정 후 `h=300 scrollable=true`.
- `pnpm lint` exit 0 (design 게이트 포함), `pnpm vitest run -t "entry|journal"` 22 passed.
- 설치본(3.0.0) 육안 확인은 다음 릴리스 뒤.