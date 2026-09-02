---
schema_version: 1
type: feature
slug: "goto-symbol-and-line-in-file"
status: done
difficulty: medium
created_at: "2026-09-02T17:22:15+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/gotoModel.ts"
    op: create
  - path: "src/features/code/CodeGoto.tsx"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_goto_model.test.ts"
    op: create
  - path: "src/__tests__/code_goto.test.tsx"
    op: create
related: []
tags:
  - "code"
  - "lsp"
  - "keyboard"
  - "vscode-borrows"
  - "mcp-tool"
---
[x] 코드 화면 파일 안 이동 — ⇧⌘O 심볼 · ⌃G 줄 (vscode-borrows Phase 3)

## 추가 기능

코드 화면 안에서만 사는 가벼운 quick-pick 하나. 두 모드가 한 입력창을 나눠 쓴다.

| 키 | 모드 | 입력 |
|---|---|---|
| ⇧⌘O | 심볼 | 빈 문자열로 시작 · `@foo` 도 심볼 |
| ⌃G | 줄 | `:` 를 채워 연다 · `:123` · `:123:8` |

설계 SSOT 는 `docs/20260902_vscode-borrows/03-goto.md`.

## 동작 흐름

1. **`gotoModel.ts` (순수)** — `parseGoto` 가 입력 한 줄을 `empty | symbol | line`
   으로 가른다. `rankSymbols` 는 `homeMatch.scoreName` 을 그대로 재사용하고(DRY —
   매칭 알고리즘을 또 쓰지 않는다) 심볼 이름에만 있는 규칙 하나를 얹는다:
   카멜/구분자 **약어**(`hM` → `handleMutate`, `pgq` → `parse_goto_query`) 90점.
   퍼지만으로는 약어가 부분수열(`andle`)보다 낮게 나오는데, 식별자를 찾을 때
   사람이 실제로 치는 것은 약어 쪽이다. 상위 사슬은 `depth` 로 유추한다.
2. **`CodeGoto.tsx`** — `useModalBehavior` 를 그대로 쓰는 얇은 오버레이
   (`AppDialog` 아님 · 팔레트와 같은 자리). 선택이 바뀔 때마다 **미리 점프**하고
   **Esc 면 열 때의 줄로 되돌린다**. 이 되돌리기가 이 위젯 값어치의 절반이다 —
   없으면 목록을 보여 준 대가로 사용자의 자리를 뺏는다.
3. **배선** — `CodeScreenV2` 의 기존 keydown(가시성 앵커 `isVisible()`)에 두 조합
   추가. 점프는 `openPath` 가 아니라 `jumpInFocusedPane` 으로 간다 — 같은 파일인데
   `openFile` 을 부르면 화살표마다 새 탭 상태가 만들어져 워크스페이스에 저장된다.

## 구현 중 뒤집은 결정 3

- **`GotoQuery.line` 을 `number | null` 로** 넓혔다 (설계는 `number`). `:` 만 친
  상태 = "줄 모드인데 아직 숫자가 없다" 를 표현할 자리가 없으면, ⌃G 로 연 창이
  심볼 목록을 보여 주며 방금 누른 키를 부정하게 된다.
- **점프에 `focus` 플래그를 뚫었다** (`CodeScreenV2` → `CodePane` → `CodeEditor`).
  `CodeEditor` 의 점프 effect 가 무조건 `view.focus()` 를 부르고 있어서, 미리
  점프 한 번이면 포커스가 에디터로 넘어가고 다음 화살표가 파일 안으로 들어간다.
  훑기는 `focus:false`, 확정(⏎·클릭)은 `true`.
- **심볼 조회 게이트를 `outlineOpen` → `symbolsWanted`** 로. 새 커맨드도 새 상태도
  없이 아웃라인과 같은 목록을 쓰되, 아웃라인이 접혀 있으면 위젯이 열릴 때 한 번
  묻는다. 심볼이 도착했는데 비어 있으면(css·md) 입력창이 `:` 로 넘어간다.

키맵 충돌은 확인했다 — CM6 에 `Ctrl-g` 바인딩은 없고(`Mod-g`=⌘G 검색, `Ctrl-o`=
splitLine 은 다른 조합), 치트시트 `CODE` 그룹에 2줄을 넣어 `polish_phase2` 의
중복 검사에 걸리게 했다.

## 검증

- 테스트 44건 신규: 순수 26건(`code_goto_model`) + 위젯·배선 18건(`code_goto`,
  a11y `vitest-axe` 포함 — 미리 점프·Esc 되돌리기·⏎ 확정·줄 모드 전환·1-based
  열 → 0-based `ch` 변환까지 단언).
- 4게이트 전부 exit 0 — `pnpm typecheck` · `pnpm test` (154 파일 1970건) ·
  `pnpm lint` · `pnpm build`.
- 육안 확인은 라운드 마감(#eyes)에서 한 번에 한다 (설치본 도는 중 dev 빌드 금지).