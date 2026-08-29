---
schema_version: 1
type: bug
slug: native-drag-hijacks-tab-drag
status: done
created_at: 2026-08-29T15:37:00+09:00
session_id: manual-20260829-153700
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/styles/tabs.css
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/features/terminal/TerminalRail.tsx
    op: update
related:
  - 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md
tags: [tabs, terminal, drag, webkit, macos]
---

[x] 탭 이름을 세손가락으로 끌면 탭이 아니라 **텍스트**가 끌렸다

## 발생 원인

사용자 보고(v2.23.1 설치본): "상단바에 프로젝트 창의 이름 쪽을 세손가락으로
드래그하면 크롬창처럼 이동해야 하는 걸 볼 수 있어야 하는데 진짜 텍스트
드래그처럼 이루어짐. (그런데 창 붙여넣기는 잘 됨)"

v2.23.1 에서 끌리는 탭이 `translateX` 로 커서를 따라오게 만들었는데도 증상이
남았다. 원인은 그 위층이다 — **네이티브 드래그가 먼저 열린다.**

`.tabstrip` 에는 `user-select: none` 이 있지만 그것은 **선택**만 막는다.
WebKit 은 선택과 별개로 요소·텍스트 드래그를 시작할 수 있고(`-webkit-user-drag`
기본값이 `auto`), 열리는 순간 OS 드래그 세션이 반투명한 텍스트 스냅샷을 커서에
매단다. 그 세션이 열리면 우리 포인터 드래그는 `pointercancel` 로 끊기거나
`pointermove` 가 더 오지 않아 탭이 손을 못 따라온다.

macOS 세손가락 드래그에서 특히 잘 드러난다 — OS 가 제스처를 합성해 내려보내는
경로라 웹뷰가 이것을 "드래그 시작" 으로 읽을 여지가 더 크다. "창 붙여넣기는 잘
된다" 는 것과도 앞뒤가 맞는다: 붙이기 판정은 `pointerup` 한 번이면 성립하지만,
따라오기는 `pointermove` 가 **끊기지 않아야** 성립한다.

두 드래그 면 어디에도 이 방어가 없었다 — 탭 스트립과 터미널 세션 레일 둘 다.

## 해결 방법

세 겹으로 막는다. 한 겹으로는 새는 경로가 남는다.

1. CSS `-webkit-user-drag: none` — `.tabstrip-tab`/`.term-sess` 와 **그 자식
   전부**. 자식까지 내리는 이유는 실제 드래그 소스가 이름 텍스트 노드라서다.
2. `draggable={false}` — 요소 드래그를 DOM 속성으로 끈다.
3. `onDragStart` 에서 `preventDefault()` — CSS 도 `draggable` 도 못 막는 경로가
   하나 남는다: **선택된 텍스트**에서 시작하는 드래그. 마지막 문을 여기서 닫는다.

## 검증

- `pnpm typecheck` · `pnpm test`(1428건) · `pnpm lint` · `pnpm build` · `cargo test`
  전부 exit 0.
- 세손가락 드래그는 헤드리스로 재현할 수 없다 — OS 제스처 합성이 필요하다.
  실기기 확인은 플래너 `#feel-manual-verify` 에 남겼다.

## 메모

`user-select: none` 만으로 네이티브 드래그가 막힌다고 믿은 것이 이 버그의
뿌리다. 두 속성은 서로 다른 것을 끈다 — 드래그 면을 새로 만들 때마다 세 겹을
같이 깔아야 한다.
