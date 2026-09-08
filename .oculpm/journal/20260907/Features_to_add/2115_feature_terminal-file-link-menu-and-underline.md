---
schema_version: 1
type: feature
slug: "terminal-file-link-menu-and-underline"
status: done
difficulty: medium
created_at: "2026-09-07T21:15:37+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "be6b2d24-2999-4514-afd5-87b9ae2f34fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/fileLinks.ts"
    op: update
  - path: "src/features/terminal/fileRefLinks.ts"
    op: create
  - path: "src/features/terminal/linkUnderline.ts"
    op: create
  - path: "src/features/terminal/TerminalFileMenu.tsx"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/api/fileOpen.ts"
    op: create
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/file_links.test.ts"
    op: update
  - path: "src/__tests__/terminal_file_menu.test.tsx"
    op: create
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "terminal"
  - "xterm"
  - "links"
  - "i18n-width"
  - "webgl"
  - "mcp-tool"
---
[x] 터미널 파일 링크 — 열 방법을 고르게 하고, 한글 줄에서 밑줄이 제자리에 그려진다

터미널(ocul-pm 안에서 Claude Code 를 돌리는 그 면)에서 에이전트가 뱉은 파일 경로를 ⌘클릭할 때 하던 일이 하나뿐이었고, 마우스를 올려도 밑줄이 안 그려졌다. 둘 다 이번에 고쳤다.

## 추가 기능

⌘클릭이 곧장 외부 편집기를 띄우는 대신 **선택 팝오버**를 연다 (`TerminalFileMenu.tsx`). 네 갈래다:

- **ocul-pm 편집기에서 열기** — 앱을 안 떠나고 코드 화면에서 읽는다.
- **빠른 미리보기** — macOS Quick Look. 열지 않고 내용만 훑는다.
- **Finder 에서 보기** — 파일이 선택된 채로 탐색기가 뜬다.
- **외부 편집기에서 열기** — 종전 동작. 실제로 고치러 갈 때.

경로를 뱉는 순간 사람이 하고 싶은 일이 하나가 아니라는 게 이유다. 팝오버 뼈대·CSS 는 명령 블록 메뉴(`TerminalBlockMenu`)의 것을 그대로 쓴다 — 터미널 안에서 뜨는 메뉴가 두 종류로 보일 이유가 없다.

## 동작 흐름

`fileRefLinks.ts` 의 프로바이더가 ⌘클릭을 `FileRefHit {path, line, rect}` 로 올리고, `TerminalSurface` 가 그 자리에 팝오버를 띄운다. 여는 일은 항목마다 다르다:

- 앱 안 편집기 → 코드 화면의 기존 점프 이벤트(`NAV_BUS.openEntity`, `kind: "code"`). 줄은 LSP 규약대로 0-based 로 실어 보낸다.
- 나머지 셋 → 새 래퍼 `src/api/fileOpen.ts` (`call` 을 지나므로 거절 사유가 `ApiError` 한 모양으로 온다).

백엔드 커맨드 둘을 새로 만들었다 — `reveal_in_file_manager`(macOS `open -R`, 리눅스는 부모 폴더, 윈도우는 `explorer /select,`)와 `quick_look_file`(`qlmanage -p`, 다른 OS 에서는 사유와 함께 거절). 둘 다 `open_in_editor` 와 같은 경로 가드(`secure_join`)를 지나고, **존재 확인**을 한 번 더 한다 — 없는 파일을 넘기면 Finder 가 아무 말 없이 아무 일도 안 해서 왜 안 되는지 알 수 없다. 셸을 안 거치므로 인용이 깨질 자리도 없다.

떼어낸 터미널 창에는 코드 화면이 없어 그 이벤트를 들을 사람이 없다 — 그 창에서는 첫 항목 자체를 감춘다 (아무 일도 안 일어나는 버튼을 보여 주느니).

## 버그 — 마우스를 올려도 밑줄이 안 그려지던 것

원인이 둘이었고 둘 다 고쳤다.

**① 링크 범위가 한글 줄에서 왼쪽으로 밀려 있었다.** 스캐너의 인덱스는 **문자 수**인데 xterm 의 링크 범위는 **셀 수**다. 한글은 한 문자가 두 셀이라 둘이 같지 않은데, 예전 코드는 `translateToString(true)` 의 문자 인덱스를 그대로 열로 썼다. `"만들었습니다 docs/a.md:3"` 같은 줄에서 진짜 경로는 열 13 부터인데 링크 상자는 열 7 에 그려졌다 — 경로 위에 마우스를 올려도 아무 일이 없고, 엉뚱한 왼쪽에서 손 모양 커서가 떴다. Claude Code 처럼 한국어로 말하면서 경로를 뱉는 도구에서는 사실상 모든 줄이 그랬다. `readLineColumns` 가 줄을 셀 단위로 직접 읽어 문자 하나가 어느 열에서 시작해 어느 열에서 끝나는지 대응표를 만든다 (`translateToString` 은 공개 타입에 out 파라미터가 없어 이 대응을 안 준다).

**② 밑줄을 그리는 렌더러가 없었다.** xterm 코어는 호버할 때 `onShowLinkUnderline` 을 쏘는데, 그 이벤트를 듣는 렌더러는 `DomRenderer` 하나뿐이다 — `@xterm/addon-webgl` 에는 구독하는 자리가 아예 없다. 2026-07-30 에 렌더러를 WebGL 로 올린 뒤로 링크 밑줄은 한 번도 안 그려지고 있었다. `linkUnderline.ts` 가 장식(`registerDecoration`)으로 직접 긋는다 — 렌더러와 무관한 DOM 오버레이라 WebGL 에서도 살고, 마커에 매달리므로 스크롤은 xterm 이 알아서 따라간다. GPU 렌더러일 때만 긋는다 (DOM 으로 되돌아가면 저쪽이 자기 밑줄을 그려 두 줄이 된다). 오버레이에 `pointer-events: none` 이 **필수**다 — 마우스를 먹으면 xterm 이 "링크에서 벗어났다"로 읽고 지웠다가 다시 그리기를 반복해 깜빡임이 멈추지 않는다. URL(WebLinks 애드온)도 같은 오버레이를 쓴다.

## 곁들여

`TerminalInstanceImpl.tsx` 안에 인라인이던 링크 프로바이더를 `fileRefLinks.ts` 로 뺐다 (1012 → 1001줄). 화면 쪽 `onOpenFileRef(path, line)` 는 `onFileRef(hit)` 로 바뀌었다 — 무엇을 어디서 눌렀는지만 넘기고, 여는 방법은 화면이 고른다. 이제 안 쓰는 `term.openEditorFailed` 사전 키는 뺐다.

## 검증

`pnpm typecheck` · `pnpm test`(190파일 2463개) · `pnpm lint`(6게이트) · `pnpm build` 전부 exit 0. `cargo test` 30스위트 전부 통과, `cargo clippy --all-targets` 경고 0, 새 코드는 `cargo fmt --check` 깨끗(남은 fmt 차이 2건은 병렬 세션의 파일). eslint 경고는 50 → 49 로 하나 줄었다.

새 테스트 14개: `readLineColumns` 의 폭 대응(한글 줄에서 열이 문자 인덱스보다 큰가·넓은 문자가 두 열인가), 프로바이더가 내는 범위가 실제 셀 위에 놓이는가, 메뉴 네 항목이 각자 자기 커맨드를 부르는가, 앱 안 편집기가 0-based 줄을 싣는가, 분리 창에서 그 항목이 사라지는가, 거절 사유를 삼키지 않는가.

**아직 눈으로 확인 못 했다** — 설치본이 돌고 있어 dev 빌드를 띄우지 않았다. 실기기에서 볼 것: 한글 줄의 경로 위에 밑줄이 정확히 얹히는가, 팝오버가 클릭 지점 옆에 뜨는가, Quick Look 창이 앱 앞으로 오는가.

커밋하지 않았다 — 이 워킹트리를 병렬 세션이 함께 쓰고 있고 `lib.rs`·`i18n/*.ts`·`screens.css`·`bindings.ts` 에 양쪽 변경이 섞여 있다.