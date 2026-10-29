---
schema_version: 1
type: refactor
slug: "screens-terminal-tabs-diff-rows"
status: done
difficulty: medium
created_at: "2026-10-29T23:11:24+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/UnrecordedBanner.tsx"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
related: []
tags:
  - "terminal"
  - "diff"
  - "ui-audit"
  - "mcp-tool"
---
[x] 터미널은 하나면 칸 없이 · 둘 이상이면 탭 줄, 변경 파일 행 한 줄 · 기록 요청은 터미널로

## 동기

화면 검사(ui-audit-20261029) 「나머지 화면」의 #term-col · #diff-rows 다. 왼쪽 목록 칸이 일지 · 계획의 목록 칸과 두 겹이었고, 변경 파일 행은 두 줄에 같은 말(시각 · 「수정함」)을 반복했다.

## 변경 요약

- **터미널 (#term-col)**
  - 세션이 하나면 목록 칸 없이 터미널만 보인다. 그 세션이 내 손을 기다리거나 끝났을 때만 위에 한 줄이 선다(까닭, 또는 「끝남 · 코드 N」과 닫기).
  - 둘 이상이면 위 탭 줄이 선다.
    - 탭마다 점(실행 · 기다림 · 끝남), 이름, 상태 말, 일지 수가 있다.
    - 닫기는 가리킬 때만 보인다.
    - 기다리는 세션을 보고 있으면 그 까닭 한 줄이 탭 아래에 선다.
- **변경 (#diff-rows)**
  - 파일 행을 한 줄로 바꿨다. 바뀐 종류 한 글자(M · A · D, A 는 초록 · D 는 빨강), 경로(디렉터리부터 줄어듦), 오른쪽 끝 시각 순이다.
  - 「기록 요청 복사」를 「Claude 에게 맡기기」로 바꿨다. 쉬는 claude 세션이 있으면 거기에 넣고, 없으면 그 글로 새 세션을 연다(`sendOrRun`). 클립보드 경로는 걷었다.
  - 일지 없는 파일을 고를 때마다 서던 긴 설명문을 걷었다. 제목이 「… · 파일 N개」로 범위를 말한다.

## 검증

- `terminal_screen.test.tsx` 를 탭 줄에 맞췄다.
  - 하나면 탭 줄도 예외 줄도 없다.
  - 끝난 하나뿐인 세션은 그 줄과 닫기를 보인다.
  - 둘이면 탭마다 상태 말이 있고, 기다리는 탭을 고르면 까닭이 선다.
- `diff_v2.test.tsx` 를 바꿨다.
  - 「Claude 에게 맡기기」는 기록 없음 묶음의 파일만 실은 글을 보낸다.
  - 행은 `.chg-op` 「M」 한 줄이고 `.chg-meta` 가 없다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 79개 · 테스트 938개 통과, lint · build exit 0.