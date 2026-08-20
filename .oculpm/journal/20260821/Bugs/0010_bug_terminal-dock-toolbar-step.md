---
schema_version: 1
type: bug
slug: "terminal-dock-toolbar-step"
status: done
difficulty: verylow
created_at: "2026-08-21T00:10:00+09:00"
session_id: "manual-20260821-001000"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
related: []
tags: ["ui", "terminal", "dock", "layout", "claude-code"]
---

[x] 터미널을 왼쪽·오른쪽에 붙이면 시트 상단이 계단처럼 어긋나던 것

## 발생 원인

세로 도크(왼쪽·오른쪽)는 화면과 **어깨를 나란히** 선다 — 시트 맨 위에서 왼쪽은 화면 툴바, 오른쪽은 터미널 탭 줄이 같은 높이에서 시작한다. 그런데 두 헤더의 키가 달랐다.

- `.toolbar` 는 `height: 52px`.
- `.term-tabs` 는 탭(패딩 7/8 + 닫기 버튼 16px = 31px) + `.term-dock` 의 `padding-top: 5px` + 아랫선 1px = **38px**.

도크를 아래에 붙일 때는 둘이 나란히 서지 않아 드러나지 않았고, 좌·우에서만 아랫선 두 개가 13.6px 어긋나 계단이 됐다. 도크 자체가 2026-08-15 에 들어온 신참이라, 그때 세운 "탭 줄은 compact 로 한 단계 낮춘다"는 규칙이 세로 자리에서는 정반대로 작용한 셈이다.

## 해결 방법

- **`--toolbar-h: 52px` 토큰 신설** (tokens.css). 값이 두 곳에서 각자 살면 한쪽만 고쳐 다시 어긋난다 — 상단 줄의 키를 한 곳에 둔다.
- `.toolbar` 가 그 토큰을 쓰도록 교체 (동작 변화 없음, 값은 그대로 52px).
- `.term-dock.pos-left / .pos-right` 의 `.term-tabs` 에 `min-height: var(--toolbar-h)`. `align-items: flex-end` 라 늘어난 만큼 탭 **위쪽**에 크롬이 생기고, 활성 탭은 여전히 본체에 붙어 있다 (탭이 아래에 매달린 브라우저 탭바 모양).
- 아래 도크(`pos-bottom`)와 분리 창·터미널 화면은 툴바와 나란히 서지 않으므로 손대지 않았다.

## 검증

- 실제 스타일시트(tokens + index → base/shell/primitives/screens/agent)를 그대로 물린 정적 페이지에 `dock-right` 구조를 세우고 두 헤더의 `getBoundingClientRect().bottom` 을 쟀다: 탭 줄 **38.4px(−13.6px 어긋남) → 52px(0px)**. 스크린샷의 그 계단이 재현됐고, 바뀐 규칙에서 사라진다.
- typecheck / lint / test(94파일 1080개) 각각 exit 0.

## 메모

jsdom 은 CSS 를 적용하지 않아 "단차가 사라졌다"를 vitest 로 단언할 수 없다 (같은 한계를 08-20 Today 빈 배경 건에서도 만났다). 대신 값을 토큰 하나로 묶어, 다음에 툴바 높이를 만지는 사람이 도크를 몰라도 자동으로 따라오게 했다.
