---
schema_version: 1
type: feature
slug: "narrow-window-480"
status: done
difficulty: medium
created_at: "2026-10-30T22:59:25+09:00"
session_id: "20261030-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/src/commands/window/mod.rs"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
related: []
tags:
  - "창"
  - "responsive"
  - "layout"
  - "mcp-tool"
---
[x] 창: 맥북 프로 14 의 3분의 1 까지 줄인다

## 추가 기능

사용자 요청(10-30): 「현재 화면이 일정 크기 이상 안 작아져. 맥북 프로 14 기준으로 3분의 1 화면까지 줄일 수 있으면 좋겠어」(계획 `narrow-window-20261030`). 맥북 프로 14 의 기본 해상도 폭은 1512pt 이고, 그 3분의 1 은 약 504pt 다.

- **최소 창:** 960×640 → 480×520(`tauri.conf.json` · `WINDOW_MIN_W/H`).
- **504 폭 하네스에서 찾은 문제(고치기 전):**
  - 윗줄: 프로젝트 이름이 사라지고, 찾기 · 설정이 창 밖으로 나갔다.
  - 일지 · 계획 · 변경: 목록 옆 본문이 290px 이었다.
  - 변경: 「일지 없는 변경」 띠의 글이 한 글자씩 세로로 꺾였다.
- **고친 것**(접힘 선 640):
  - **윗줄:** 탭은 아이콘이다. 이름은 화면에서만 감춰(clip) 접근명과 E2E 의 탭 찾기(`.topnav-label` textContent)가 그대로 읽는다. 찾기는 돋보기만, 단축키 표시는 감춘다. 프로젝트 이름은 줄지 않게 했다(화면 동작이 밀어내 「a.」 로 꺾였다).
  - **일지 · 계획 · 변경:** 목록이 위(36~42%), 본문이 아래다.
  - **변경:** 띠와 파일 머리줄이 줄을 바꾼다.
- **디자인 규칙 18(창 폭 @media 금지):** 근거가 사이드바 · 도크였는데 4.0 에서 둘 다 걷혔다. 윗줄 · 일지 · 계획 · 변경 CSS 를 허용 목록에 넣었다. 도크 같은 것이 돌아오면 목록을 걷고 `@container` 로 돌아가라고 주석에 적었다.
- **E2E:** 좁은 폭 순회를 960 → 504 로 바꿨다. 화면마다 `scrollWidth - clientWidth > 1` 이면 실패한다. 세 OS CI 가 이 약속을 지킨다.

함정 둘:
- media 블록을 기본 규칙보다 **앞에** 두면, 같은 특이성의 뒤 규칙(`flex` 단축 속성 등)이 이긴다. 레일이 260 에 남았고 이름이 다시 사라졌다. 파일 끝으로 옮겼다.
- 계획 CSS 를 옮기다 닫는 괄호가 남아 깨진 적이 있다(바로 고침).

## 검증

- 하네스 504 폭:
  - 오늘 · 일지 · 계획 · 변경 · 터미널 모두 `scrollWidth` 504(넘침 0), 윗줄 밖으로 나간 요소 0.
  - 계획 레일 폭 504, 터미널의 프로젝트 이름 37px. 시작 창은 480 에서 480.
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 972 passed · `pnpm lint` 0(디자인 규칙 포함) · `pnpm build` 0
  - `cargo fmt --check && clippy -D warnings && cargo test --locked --no-fail-fast` → rust passed 1166 failed 0
- 실제 창을 480 까지 끌어 보는 확인은 다음 설치본에서 한다. E2E 504 순회가 세 OS 에서 먼저 본다.