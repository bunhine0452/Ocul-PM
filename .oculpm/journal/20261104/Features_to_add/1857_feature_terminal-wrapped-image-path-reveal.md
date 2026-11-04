---
schema_version: 1
type: feature
slug: "terminal-wrapped-image-path-reveal"
status: done
difficulty: medium
created_at: "2026-11-04T18:57:28+09:00"
session_id: "20261104-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2d22bf7f-6405-4d02-807b-8e7aa8da8901"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/fileLinks.ts"
    op: update
  - path: "src/features/terminal/imagePeek.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/TermImagePeek.tsx"
    op: update
  - path: "src-tauri/src/commands/term_image.rs"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/__tests__/terminal_wrapped_image_path.test.tsx"
    op: create
related: []
tags:
  - "터미널"
  - "terminal"
  - "ui"
  - "mcp-tool"
---
[x] 터미널: 줄 넘긴 이미지 경로도 미리본다

## 추가 기능

사용자 요청(11-04, 스크린숏 첨부): 「이런 화면에서 이미지 경로 호버 시 이미지 보이게 해줘. 그리고 클릭 시 경로로 이동」.

### 원인
Claude Code 의 답에 찍힌 `/private/tmp/claude-501/…/40d26567-…-b8d4-` ⏎ `  f327615ba652/scratchpad/before-home.png` 같은 경로가 문제였다. Claude Code 는 긴 경로를 제 폭에서 끊고 다음 줄을 들여 쓴다. 맨 글자 이미지 경로 프로바이더(`fileLinks.ts`)는 한 줄씩만 봤다. 그래서 두 조각 모두 「절대경로 + 이미지 확장자」 가 아니었고, 호버해도 아무 일이 없었다.

### 동작 흐름
- **잇기:** `wrappedChain(getLine, y, cols)` 가 묻는 줄을 품은 이어진 줄 묶음(최대 6줄씩 앞뒤)을 만든다. 이어지는 줄은 셋이다:
  - 앞 줄이 폭 가까이(마지막 칸 ≥ cols − 20)에서 경로 조각으로 끝나면, 다음 줄을 앞 공백을 건너뛰어 붙인다. TUI 가 직접 끊은 줄이고, 낱말 줄바꿈은 일찍 끊으므로 여유가 20칸이다.
  - xterm 소프트 줄바꿈 줄(`isWrapped`)은 그대로 붙인다.
  - 앞 줄 끝 조각이 이미 이미지 확장자로 끝나면 잇지 않는다.
- **링크:** 붙인 글자에서 `findImagePaths` 를 돌리고, 글자 위치를 (줄, 칸)으로 되짚어 두 줄에 걸친 링크 범위를 낸다. 어느 줄을 물어도 같은 링크다.
- **누르기:** 그냥 누르면 새 명령 `terminal_image_reveal` 로 그 파일을 Finder 에서 선택된 채로 연다. ⌘(Ctrl)를 누른 채면 전처럼 크게 본다. OSC 8 이미지 링크도 같다. 카드 안내는 「누르면 Finder 에서 · ⌘ 누르면 크게」 다.
- **백엔드:** 미리보기와 같은 문(`image_file`: 절대경로 · 심링크 푼 실제 파일 · 이미지 확장자 · 정규 파일)을 지난 것만 넘긴다. `reveal_in_file_manager` 의 기동부를 `reveal_path` 로 떼어 둘이 함께 쓰고, 기동 원장(`egress_spawn_ledger/sites.rs`)의 func 를 고쳤다.

## 검증
- `pnpm typecheck` · `pnpm lint` · `pnpm build`: 0. `pnpm test`: 1067 passed. 새 `terminal_wrapped_image_path.test.tsx` 는 스크린숏 모양의 두 줄 경로 · 짧은 줄 비잇기 · 소프트 줄바꿈 · 클릭 / ⌘클릭을 본다.
- `cargo test --locked`: 34 묶음 ok(기동 원장 포함). clippy clean.
- 설치본에서 실제 Claude Code 출력으로 눈 확인이 남았다.