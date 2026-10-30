---
schema_version: 1
type: bug
slug: "terminal-file-ref-menu-back"
status: done
difficulty: medium
created_at: "2026-10-31T02:06:18+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/fileRefs.ts"
    op: create
  - path: "src/features/terminal/TermFileMenu.tsx"
    op: create
  - path: "src/features/terminal/fileLinks.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
related:
  - ref: "20261031/Bugs/0156_bug_update-waits-for-terminal-resumes-claude.md"
    kind: "followup"
tags:
  - "terminal"
  - "mcp-tool"
---
[x] 터미널: 파일 경로 ⌘클릭 메뉴를 되살렸다

## 발생 원인
사용자 제보: 「이미지 호버 미리보기와 경로 Finder 바로 열기가 사라졌다」.
- 이미지 미리보기는 4.2.0(PR #134)에서 다시 넣었다. 설치본이 아직 4.1.0 이라 보이지 않았다(`defaults read …/Info.plist CFBundleShortVersionString` → 4.1.0).
- 경로 메뉴는 3.x `TerminalFileMenu`(⌘클릭 → 빠른 미리보기 · Finder · 외부 편집기)였다. 10-28 에 터미널과 함께 걷혔고, 10-29 에 터미널을 다시 들일 때 들이지 않았다. 백엔드 명령(`reveal_in_file_manager` · `quick_look_file` · `open_in_editor`)은 남아 있었다.
- 4.2.0 의 OSC 8 처리기는 이미지가 아닌 `file://` 를 「아무 데도」 보냈다. 그래서 Claude Code 가 감싼 경로는 눌러도 아무 일이 없었다.

## 해결 방법
- `fileRefs.ts`: 3.x 의 `scanFileRefs`(상대경로 · `:줄`, 절대 · `..` · URL 제외)를 옮기고 `lineCells` 로 칸을 맞췄다. 여기에 `relativeToRoot`(루트 밖이면 null), `isRefClick`(⌘ / Ctrl), 메뉴 저장소, 링크 프로바이더를 더했다.
- `TermFileMenu.tsx`: 「이 파일로 할 일」. Finder(OS 별 이름) · 빠른 미리보기(macOS) · 외부 편집기(설정에 명령이 있을 때)를 띄운다. 바깥 클릭 · Esc 로 닫는다. 루트 밖 경로는 메뉴 없이 이유만 알린다.
- OSC 8 의 이미지가 아닌 `file://` 는 `onFile` 로 같은 메뉴를 연다(그냥 눌러도). 맨 글자 경로는 ⌘클릭으로 연다. 터미널 화면은 셸에서 프로젝트 루트를 받는다.

## 검증
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → exit 0, Tests 982 passed
- `terminal_file_menu.test.tsx` 5건(스캔 · 루트 상대화 · ⌘클릭만 · 메뉴 Finder/Esc · 루트 밖 거절)과 OSC 라우팅 테스트(파일 → 메뉴)