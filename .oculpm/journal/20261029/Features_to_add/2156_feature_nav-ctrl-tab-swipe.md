---
schema_version: 1
type: feature
slug: "nav-ctrl-tab-swipe"
status: done
difficulty: low
created_at: "2026-10-29T21:56:54+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/hooks/useNavGestures.ts"
    op: create
  - path: "src/__tests__/nav_gestures.test.ts"
    op: create
  - path: "src/windows/ProjectWindow.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "nav"
  - "ocul-next"
  - "mcp-tool"
---
[x] ⌃Tab 으로 화면 순환, 트랙패드 두 손가락 쓸기로 뒤/앞

## 추가 기능

사용자 요청(10-29) 「상단에서 이동하기 불편한데」에 대한 첫 손이다. 윗줄까지 가지 않고 화면을 오간다.

- **⌃Tab / ⌃⇧Tab** — 다섯 화면(오늘 → 일지 → 계획 → 변경 → 터미널)을 차례로 돈다. 설정 화면에서는 첫 화면 · 끝 화면으로 간다. 4.0 에서 탭과 함께 걷었던 키라 지금 비어 있었다. 캡처 단계에서 받으므로 터미널(xterm)이 Tab 을 먼저 먹지 않는다. 모달이 열려 있으면 손대지 않는다.
- **트랙패드 두 손가락 가로 쓸기** — `useNavHistory` 의 뒤로/앞으로(⌘[ / ⌘])와 같다. 손가락을 오른쪽으로 쓸면 뒤로다. 판정은 순수 클래스 `SwipeTracker` 가 한다.
  - 가로 이동을 모아 140px 에서 한 번 넘긴다.
  - 사건 사이가 180ms 넘게 벌어지면 새 몸짓으로 센다.
  - 넘긴 뒤에는 관성 바퀴가 그칠 때까지 잠근다(한 번 쓸어 두 화면 넘김 방지).
  - 넘기지 않는 경우: 세로 굴림, 핀치(⌃ + 바퀴), 가로로 굴릴 수 있는 칸(긴 diff 줄) 안, 터미널 위.
- 단축키 표(⌘/)에 ⌃Tab 줄을 넣고, 「화면 뒤로 / 앞으로」 줄에 두 손가락 쓸기를 적었다.

## 남은 것

- 쓸기의 방향과 문턱(140px)은 실제 트랙패드로 봐야 한다(ocul-next #eyes-installed). macOS 「자연스러운 스크롤」을 끈 사람에게는 방향이 거꾸로일 수 있다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 72개 · 테스트 894개 통과, lint · build exit 0. `nav_gestures.test.ts` 4개는 순환 순서, ⌘Tab · 모달 무시, 쓸기 한 번 · 관성 잠금, 세로 · 핀치 · 가로 칸 · 띄엄띄엄을 본다.