---
schema_version: 1
type: bug
slug: narrow-toolbar-cjk-wrap
status: done
difficulty: low
created_at: "2026-07-20T15:38:10+09:00"
session_id: "manual-20260720-153740"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/components/Toolbar.tsx
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/styles/screens.css
    op: update
related: []
tags: ["ui", "toolbar", "narrow-window", "cjk", "dogfooding-finding"]
---

[x] 좁은 창에서 툴바 CJK 라벨이 한 글자씩 세로로 꺾임

## 발생 원인

실기기 확인 중 사용자 보고 (스크린샷): 창 폭을 줄이면 작업 일지 툴바의 제목("작업
일지"→"업\n일\n지"), 부제, 필터 칩("리팩토링" 등)이 flex 압착으로 폭을 잃고 CJK 텍스트가
한 글자씩 세로로 줄바꿈됐다. `.toolbar-title`/`.toolbar-sub`/`.scope-chip` 에 nowrap 이
없고, 툴바 액션 묶음에 넘침 처리(스크롤/랩)가 전혀 없던 것.

## 해결 방법

3층 방어 (전 화면 공통 — 모든 화면이 같은 `<Toolbar>` 를 씀):

1. `.toolbar-title` — `white-space: nowrap; flex: none` (제목은 절대 안 꺾임).
2. `.toolbar-sub` — nowrap + 말줄임 + `min-width: 0` (넘치면 부제부터 양보).
3. Toolbar 가 children 을 `.toolbar-actions` 로 감쌈 — `overflow-x: auto`(스크롤바 숨김,
   트랙패드/휠) + 버튼 nowrap. 좁으면 액션 묶음이 압착 대신 가로 스크롤로 도망간다.
   `.scope-chip` 자체에도 nowrap/flex:none (툴바 밖 칩 행도 동일 보호).

호환성: 툴바 children 안에서 `flex: 1` 로 늘어나는 요소를 쓰는 화면이 없음을 grep 으로
확인 — 래퍼 도입으로 동작이 바뀌는 화면 없음.

## 검증

typecheck / vitest 143 (22파일) / lint / build 전부 exit 0. 시각 확인(창 폭 축소 시 제목
유지·칩 스크롤)은 사용자 실기기 몫.
