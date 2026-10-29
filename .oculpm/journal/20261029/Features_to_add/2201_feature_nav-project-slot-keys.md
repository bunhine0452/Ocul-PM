---
schema_version: 1
type: feature
slug: "nav-project-slot-keys"
status: done
difficulty: low
created_at: "2026-10-29T22:01:45+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/projectKeys.ts"
    op: create
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/project_keys.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20261029/Features_to_add/2156_feature_nav-ctrl-tab-swipe.md"
    kind: "followup"
tags:
  - "nav"
  - "ocul-next"
  - "mcp-tool"
---
[x] ⌥⌘1~9 로 목록을 열지 않고 프로젝트 창 바꾸기

## 추가 기능

- **macOS ⌥⌘1~9 · Windows·Linux Alt+1~9** — ⌘O 목록을 열지 않고 그 번호의 프로젝트 창으로 간다. 이미 다른 창에 열려 있으면 그 창이 앞으로 온다. 지금 창의 번호면 아무 일도 없다.
  - 번호는 ⌘O 목록에 보이는 순서(최근 순, `orderRecent`)다. 목록 줄마다 그 키를 옅게 적어서 외우지 않아도 된다.
  - 캡처 단계에서 받는다. 그래서 ⌘숫자(화면 전환) 처리기와 터미널보다 먼저다. ⌥ 가 글자를 바꾸므로 `e.code`(Digit1~9)로 읽는다.
- 단축키 표(⌘/)에 「프로젝트 창으로」 한 줄을 넣었다(Windows·Linux 는 `Alt+1~9` 로 따로 적음).

## 계획과 다르게 한 것

계획에는 ⌃1~9 라고 적었는데, 써 보니 세 군데서 겹쳐 키를 바꿨다.
- macOS 의 `readChord` 는 ⌃ 를 ⌘ 처럼 읽어서 ⌃숫자가 이미 화면 전환(⌘1~5)이다.
- Windows·Linux 에서는 Ctrl+숫자가 곧 화면 전환이다.
- ⇧⌘3~5 는 macOS 스크린샷 키이고, Ctrl+Alt 는 유럽 자판의 AltGr(Alt+숫자로 { [ 를 친다)다.

Windows·Linux 의 터미널 위 Alt+숫자는 셸(readline)의 몫이라 거기서는 받지 않는다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 75개 · 테스트 907개 통과, lint · build exit 0. `project_keys.test.tsx` 3개는 맥 · 윈도 키 판정, 터미널 위 제외, 목록 없이 셋째 프로젝트 열기 · 지금 창 무시를 본다.