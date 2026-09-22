---
schema_version: 1
type: feature
slug: "confirm-dialog-redesign-enter"
status: done
difficulty: low
created_at: "2026-09-21T18:10:52+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "4e5f38ee-4ddc-4f78-87d2-6352a60d2d4f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/hooks/useConfirm.tsx"
    op: update
  - path: "src/components/ui/AppDialog.tsx"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/lib/closeIntent.ts"
    op: update
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-critical-css.mjs"
    op: update
  - path: "src/__tests__/confirm_dialog.test.tsx"
    op: create
related: []
tags:
  - "ui"
  - "modal"
  - "useConfirm"
  - "close-guard"
  - "a11y"
  - "mcp-tool"
---
[x] 확인 대화상자 리디자인 — 표식·목록·단색 위험 버튼, Enter 가 곧 답

## 추가 기능

사용자: "터미널·창을 닫을 때 뜨는 모달이 아마추어 같다. 그리고 뜬 뒤 Enter 를 치면 닫히게 해 달라."

원인 둘. ① `useConfirm` 은 제목 한 줄 + 맨글자 본문 + **테두리만 빨간** 확인 버튼이었고, 닫기 문지기는 "터미널에서 실행 중: claude, pnpm" 을 문장 속에 넣어 무엇이 죽는지 안 보였다. ② Enter 가 안 먹은 건 `useModalBehavior` 의 초기 포커스가 **첫 포커서블 = 취소 버튼**이라서다 — Enter 가 취소를 눌러 "아무 일도 안 일어난 것"처럼 보였다.

- `useConfirm` 리디자인: 왼쪽 표식(위험=삼각형/`--danger-soft`, 그 외=원/`--accent-soft`), 제목·본문, 새 `items` 옵션(실행 중 점 + 고정폭 이름 목록), 취소 ghost / 확인 **단색**(`.cf-confirm.danger` 는 `--danger`+`--on-danger`, 아니면 `.primary`), 버튼마다 `esc`·`↩` 키 힌트(`aria-hidden` — 접근 이름에 섞이면 기존 `getByRole("button", {name})` 테스트가 깨진다).
- Enter = 확인: `initialFocusRef` 를 확인 버튼에, 그리고 `AppDialog` 에 `onKeyDown` prop 을 열어 **패널 층**에서 Enter 를 받는다 (본문을 클릭하면 tabIndex=-1 인 패널로 포커스가 옮겨 가는데, 안쪽 래퍼의 리스너는 그 이벤트를 못 본다 — 첫 시도가 그렇게 실패했다). 버튼·입력 위의 Enter 는 그 요소 뜻대로 두므로 취소 위의 Enter 는 여전히 취소.
- `closeIntent.runningWorkItems(foreground, agents, t)`: 이름 넷까지 낱개, 그 이상은 "외 n개", 세션 수 한 줄. TabbedWindow(탭 닫기)·TerminalSurface(페인 ⌘W) 양쪽이 같은 목록을 쓴다. i18n `close.guard.more` · `close.guard.detailPane` 추가, `close.guard.terminals` 는 문장 → 라벨로.
- CSS 는 `.cf-*` 로 primitives.css(전역 청크)에 — `check-critical-css` REQUIRED 에 `.cf-body` 등록해 lazy 청크로 새는 회귀를 막는다.

## 동작 흐름

닫기 문지기가 실행 중 작업을 알림 → `confirm({title, message, items, danger})` → 확인 버튼 포커스 → Enter/클릭이면 `true`, Esc/취소/백드롭이면 `false`. 열일곱 곳의 삭제·초기화 확인이 같은 껍데기를 얻는다(호출부 무변경).

## 검증

- typecheck 0 · vitest 219 파일 2743 통과(신규 `confirm_dialog.test.tsx` 3건: 초기 포커스+패널 Enter 확인, 취소 위 Enter/Esc 취소, 목록 렌더) · `pnpm lint` 6 게이트 청정 · `pnpm build` + critical-css 14 선택자 확인.
- dist 실제 CSS 로 정적 미리보기(라이트·다크 · 위험/일반)를 Chrome 에서 육안 확인. 설치본 실기기 확인은 다음 실행 때.