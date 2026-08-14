---
schema_version: 1
type: feature
slug: "terminal-font-size-px-input"
status: done
difficulty: low
created_at: "2026-08-14T19:37:39+09:00"
session_id: "mcp-20260814-193739"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "terminal"
  - "ui"
  - "i18n"
  - "mcp-tool"
---
[x] 터미널 글자 크기를 px 로 직접 입력

## 추가 기능

터미널 하단 상태바의 글자 크기 표시(`13px`)가 읽기 전용 텍스트라 크기를 바꾸려면 `A−`/`A+` 를 1px 씩 여러 번 눌러야 했다. 표시를 숫자 입력 필드로 바꿔 원하는 px 값을 바로 타이핑할 수 있게 했다. 기존 `A−`/`A+` 버튼과 ⌘+/⌘-/⇧⌘0 단축키는 그대로 병행 동작한다.

## 동작 흐름

- 입력 중 값은 로컬 초안(`fontDraft`)에 담고, **범위(9~22px) 안에 들어온 값만 즉시 반영**한다. `18` 을 치는 도중의 `1` 이 클램프되어 9 로 튀는 걸 막기 위해 클램프 없이 통과 여부만 판정한다.
- blur / Enter 에서 커밋 — 범위 밖이면 `clampFont` 로 잘라 반영, 빈 값이면 현재 값으로 되돌린다. Escape 는 편집만 종료한다.
- `fontDelta`(⌘+/⌘-)도 새 `clampFont` 헬퍼를 쓰도록 정리해 클램프 로직을 한 곳으로 모았다.
- 값은 기존대로 `WorkspaceContext.terminalFontSize` 에 영속되고, `TerminalInstanceImpl` 의 fontSize 이펙트가 refit + PTY resize 까지 이어간다 (경로 변경 없음).
- 상태바 폭을 지키려고 number 입력의 스피너를 숨기고(`appearance: textfield` + `::-webkit-*-spin-button`), hover/focus 에만 테두리를 준다.
- 신규 i18n 키 `term.fontSizeInput` / `term.fontSizeHint` 를 ko·en 양쪽에 추가.

터미널 화면-로컬 단축키 리스너는 전부 meta/ctrl 게이트라 숫자 타이핑과 충돌하지 않고, 포커스를 되찾는 이펙트는 `[visible, sessionId]` 의존이라 입력 중 포커스를 뺏기지 않는다.

## 검증

`pnpm typecheck` · `pnpm test`(59 파일 738 테스트) · `pnpm lint`(storage + i18n) · `pnpm build` 모두 exit 0.