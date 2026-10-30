---
schema_version: 1
type: feature
slug: "start-forget-trash-one-line"
status: done
difficulty: low
created_at: "2026-10-30T19:20:05+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src/api/projects.ts"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
  - path: "src/__tests__/start_window.test.tsx"
    op: update
related: []
tags:
  - "시작"
  - "trash"
  - "density"
  - "mcp-tool"
---
[x] 시작: 빼기에 기록 휴지통 선택, 한 줄 목록

## 추가 기능

사용자 요청(10-30): 「프로젝트 삭제 어떻게 해」에 대해 제안한 3번(기록까지 지우는 선택)을 넣는다. 함께 받은 요청은 「이렇게 화면에 빈 공간이 있는 부분을 찾고 줄여 줘」였고, 시작 창 스크린숏이 붙어 있었다.

- **빼기 확인의 체크 칸:** 「기록 폴더(.oculpm)도 휴지통으로」를 넣었다. 기본은 꺼짐(목록에서만 뺀다).
  - AGENTS.md 는 사용자가 쓴 규칙이 함께 있을 수 있어 고를 수 없게 늘 둔다(`projectsApi.forget(id, wipe)` → `delete_project(id, wipe, false)`).
- **백엔드:** `delete_project` 의 파일 지우기를 `remove_dir_all` 에서 OS 휴지통(`trash` crate)으로 바꿨다. 잘못 눌러도 되살릴 수 있다.
  - macOS 는 `NSFileManager` 방식으로 고정했다. crate 기본값인 Finder AppleScript 방식은 자동화 권한 창을 띄우고 `osascript` 를 실행한다(trash 5.2.9 소스 확인).
- **시작 창 줄:**
  - 이름과 경로를 한 줄(34px)에 둔다. 두 줄이던 때는 열한 줄이 창을 넘었다.
  - 줄 전체가 「열기」다. 따로 선 「열기」 단추는 줄마다 가운데를 비우고 있어서 걷었다.
  - 「일지 없는 파일」은 있을 때만 보인다. 전에는 줄마다 「0」이 서 있었다(예외만 보이기).
  - × 는 줄을 가리킬 때만 보인다. 카드는 내용만큼만 선다(창 높이까지 늘어 아래가 비었다).
- 쓰지 않게 된 사전 키 `start.open` 을 걷었다.

## 동작 흐름

1. × 를 누르면 확인 창이 뜬다. 문구는 「폴더와 기록 파일은 그대로 남아요…」이고, 체크 칸이 하나 있다.
2. 체크 없이 「목록에서 빼기」를 누르면 DB 행만 지운다.
3. 체크하고 누르면 `.oculpm` 을 휴지통으로 옮기고 「기록 폴더를 휴지통으로 옮겼어요」 토스트를 띄운다.

## 검증

- `start_window.test.tsx` → 7 passed. 빼기 기본은 `(3, false)`, 체크하면 `(3, true)`. 줄 전체 「열기」는 기존 접근명으로 찾는다.
- 하네스(실제 컴포넌트, 프로젝트 11개): 한 줄 목록과 카드 높이를 스크린숏으로 확인했다.
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 969 passed · `pnpm lint` 0 · `pnpm build` 0
  - `cargo fmt --check && clippy -D warnings && cargo test --locked --no-fail-fast` → rust passed 1165 failed 0
- 실제 휴지통 이동은 설치본에서 확인할 몫이다(테스트는 휴지통을 건드리지 않는다).