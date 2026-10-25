---
schema_version: 1
type: feature
slug: "editor-external-change-guard"
status: done
difficulty: medium
created_at: "2026-10-25T12:07:14+09:00"
session_id: "20261025-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2a1d0079-cc16-453f-acab-dc425538e24b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code/read_write.rs"
    op: update
  - path: "src-tauri/src/commands/code/tests.rs"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeStatusBar.tsx"
    op: update
  - path: "src/features/code/codePane/PaneBanners.tsx"
    op: update
  - path: "src/features/code/codePane/types.ts"
    op: update
  - path: "src/features/code/codePane/useDiffModes.ts"
    op: update
  - path: "src/features/code/codePane/useExternalChanges.ts"
    op: update
  - path: "src/features/code/codePane/useSaveFlow.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
related: []
tags:
  - "code-editor"
  - "orca-bench"
  - "mcp-tool"
---
[x] 코드 편집기 바깥 변경 — 바뀐 곳 비교 · 지워진 파일 다시 만들기 · 다시 불러옴 표시

## 추가 기능

사용자 요청 "코드 편집기가 Orca 처럼 탄탄했으면". Orca 편집기 폴더(6.4만 줄)의 저장·바깥 변경 갈래와 우리 편집기를 대조해 보니 핵심은 이미 있었다 — 저장 직전 `base_hash` 대조(`write_with_lock`), 충돌 띠(디스크 것 불러오기 / 덮어쓰기), 자기 저장 에코 무시(`file.hash === buf.baseHash`), 깨끗한 버퍼 조용히 최신화, 탭을 열 때마다 디스크 재확인. 빈 곳 셋을 메웠다.

- **바뀐 곳 비교**: 충돌 띠에서 고르기 전에 무엇이 다른지 본다. `DiffMode { kind: "disk" }` — 디스크 판을 원본으로 인라인 비교를 연다(HEAD·일지·판 비교와 같은 기계). 비교 중에 불러오기·덮어쓰기를 고르면 비교를 먼저 닫는다.
- **지워진 파일**: 열어 둔 사이 바깥에서 지워지면 예전엔 토스트 한 번이 전부였고, 저장하면 `Failed to read file before save` 오류만 났다(편집기에 남은 본문을 살릴 길이 없음). 이제 `write_with_lock` 이 NotFound 를 `GONE_HASH`("")의 충돌로 말하고, `code_write` 는 없는 파일을 부모 폴더 경유로 정규화한다(`resolve_save_target`). 띠는 「이 파일이 바깥에서 지워졌어요 · 다시 만들기」 — 고르면 `base_hash ""` 로 같은 자리에 쓴다. 부모 폴더가 루트 안에 있을 때만이고, 읽고 온 판이 있는 저장은 지워진 파일을 되살리지 않는다(조용한 생성 경로 없음).
- **다시 불러옴 표시**: 깨끗한 버퍼를 바깥 판으로 갈아 끼우면 상태바가 4초 동안 「바깥에서 바뀌어 다시 불러왔어요」.
- `useSaveFlow.save` 의 no-op 판정이 `!opts?.baseHash` 였다 — 다시 만들기의 base_hash 가 빈 문자열이라 거짓으로 읽혀 깨끗한 버퍼에서 저장이 안 나갔다. `=== undefined` 로.

## 동작 흐름

watcher `file_changed` → `useExternalChanges`: 읽기 실패 + 버퍼 있음 → `setConflict({diskHash: ""})` → `ConflictBanner(gone)`. 저장 → `code_write` → `Conflict{disk_hash:""}` → 같은 띠.

## 검증

- typecheck · lint · vitest 3,261 · build · cargo fmt/clippy · `cargo test commands::code` 46 통과, Rust 새 테스트 셋(지워진 파일 → 빈 해시 충돌·생성 안 함 / 빈 해시로만 다시 만들기 / 부모 경유 경로), 화면 테스트 둘(비교 띠 · 다시 만들기 흐름).
- CI 첫 판은 bindings 신선도에서 떨어졌다 — Rust 문서 주석이 bindings.ts 에 실리는데 필터한 `cargo test` 만 돌려 재생성을 빠뜨렸다. `export_bindings` 를 돌려 재커밋.