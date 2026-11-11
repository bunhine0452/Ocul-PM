---
schema_version: 1
type: bug
slug: "windows-terminal-resize-webgl"
status: done
difficulty: medium
created_at: "2026-11-11T21:40:00+09:00"
session_id: "manual-20261111-214000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/windows/CaptionButtons.tsx"
    op: update
  - path: "src/__tests__/terminal_resize_webgl.test.ts"
    op: create
  - path: "src/__tests__/terminal_status_refetch.test.tsx"
    op: create
  - path: "src/__tests__/caption_buttons.test.tsx"
    op: update
related:
  - ref: "20261111/Bugs/2130_bug_windows-terminal-output-flood.md"
    kind: "context"
tags:
  - "터미널"
  - "windows"
  - "성능"
---
[x] 터미널: 창 끌기 · 탭 전환의 헛일을 걷었다

## 발생 원인
- 창을 끄는 동안 ResizeObserver 가 프레임마다 `fit()` → `term_resize` 를 불러, 그때마다 ConPTY 가 화면을 다시 흘리고 셸 · claude 가 프롬프트를 다시 그렸다.
- 탭을 오갈 때마다 `WebglAddon` 을 새로 만들고 내려가면 버려, WebGL 문맥(ANGLE/D3D11)과 글리프 아틀라스를 매번 다시 지었다. 문맥을 한 번 잃으면 영영 DOM 렌더러였다.
- Windows 창 단추가 크기 변경 사건마다 `isMaximized()` IPC 를 불렀다. `TermSessionsChanged` 하나마다 창의 훅 둘이 목록을 다시 읽었다(백엔드는 읽을 때마다 도는 중을 잰다).

## 해결 방법
- `fit()` 은 한 프레임에 한 번(rAF), PTY 크기는 잠잠하던 칸의 첫 바꾸기만 곧장 · 이어지는 것은 80ms 잠잠한 뒤 마지막 것 하나. 붙자마자 맞추기 · IME 다리는 그대로.
- WebGL 은 내려가도 30초 쥐고 있다가 반납하고, 동시에 8개를 넘으면 내려간 세션 것부터 곧장 반납한다(약 16 상한). 문맥을 잃으면 한 번 다시 짓는다. 다시 붙을 때 한 번 `refresh`.
- 창 단추는 크기 변경 뒤 100ms 잠잠하면 한 번 묻는다. 목록 다시 읽기는 첫 사건 뒤 150ms 에 한 번(계속 와도 밀리지 않는다).

## 검증
- `vitest run` 새 테스트 — 30프레임 끌기: fit 90→30번 · PTY resize 30→2번, 창 단추 IPC 61→2번, 사건 20개 → 다시 읽기 1번
- 전체 `vitest run` → Tests 1094 passed (108 files) · `pnpm typecheck` exit 0 · `pnpm lint` exit 0
- 설치본(WebView2)에서 탭 전환 · 끌기 체감은 아직 눈으로 확인하지 않았다
