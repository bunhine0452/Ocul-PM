---
schema_version: 1
type: bug
slug: "code-gutter-transparent-on-hscroll"
status: done
difficulty: verylow
created_at: "2026-08-28T16:27:00+09:00"
session_id: "manual-20260828-162700"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodeEditor.tsx"
    op: update
related: [".oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md"]
tags: ["code-editor", "codemirror", "gutter", "css", "claude-code"]
---

[x] 코드 화면 가로 스크롤 시 코드가 줄번호를 뚫고 지나가던 버그

## 발생 원인

`CodeEditor.tsx` 의 `editorChrome` 테마가 `.cm-gutters` 배경을 `transparent` 로
덮어쓰고 있었다.

CM6 은 거터를 `position: sticky` 로 붙여 둔다(`fixed` 기본값 — 뷰가
`this.dom.style.position = "sticky"` 를 직접 넣는다). 가로 스크롤에서 콘텐츠는
왼쪽으로 흐르지만 거터는 제자리에 남는 구조라, **거터에 불투명 바탕이 없으면 흘러
지나가는 긴 줄이 줄번호 밑으로 그대로 비친다.** CM6 기본 테마는 이 목적으로
`&light .cm-gutters { backgroundColor: "#f5f5f5" }` 를 깔아 두는데, 우리 테마가
그걸 투명으로 무효화하면서 방어막이 사라졌다.

짧은 줄만 있는 파일에서는 스크롤이 안 생겨 드러나지 않고, 긴 줄을 가진 파일을
가로로 밀 때만 나타나서 여태 안 보였다.

## 해결 방법

`.cm-gutters` 의 배경을 편집면과 같은 `var(--bg-content)` 로 되돌렸다 —
`.code-pane` 이 이미 쓰는 값이라 테마/프리셋 전환에도 색이 어긋나지 않고,
`data-theme`/`data-preset` 이 바뀌면 var() 가 즉시 따라간다(리마운트 불필요).

투명이 아니어야 할 뿐 특정 색이 필요한 건 아니므로 하드코딩 대신 기존 토큰을
그대로 참조했다. 위에 얹히는 `.cm-activeLineGutter`(반투명 `--code-active-line`)
는 이제 불투명 바탕 위에 합성되므로 활성 줄 강조도 의도대로 보인다.

## 검증

`pnpm typecheck` · `pnpm lint`(storage + i18n) exit 0. `CodeEditor` 는
`CodePane.tsx:1025` 한 곳에서만 쓰이고 그 조상이 `.code-pane`(배경
`--bg-content`)이라 색이 어긋날 다른 마운트 지점은 없음을 grep 으로 확인했다.

`pnpm test` 는 **이 변경과 무관하게** 로컬에서 통째로 빨간 상태다 — 아래 메모.

## 메모

로컬 vitest 가 19파일/201건 실패 중인데 원인은 이 작업과 무관한 **Node 버전**이다.
Node 26 이 실험적 `globalThis.localStorage` 를 자체적으로 들고 있고
(`--localstorage-file` 없으면 `undefined`), 이게 jsdom 이 넣어 주는
`localStorage` 를 가려서 `beforeEach` 의 `localStorage.clear()` 가 전부
`TypeError: Cannot read properties of undefined` 로 죽는다. 스태시한 클린 트리
(HEAD 5aab5e3)에서도 동일하게 실패해 선재 결함임을 확인했다. CI 는
`node-version: 22` 라 초록이므로 CI 에서는 안 보인다. 로컬 게이트를 되살리려면
Node 22 로 내리거나 setup.ts 에서 jsdom 의 `window.localStorage` 를 globalThis 에
다시 심는 처리가 필요 — 별도 작업으로 남긴다.
