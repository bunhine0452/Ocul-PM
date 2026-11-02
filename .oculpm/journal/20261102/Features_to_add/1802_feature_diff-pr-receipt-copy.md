---
schema_version: 1
type: feature
slug: "diff-pr-receipt-copy"
status: done
difficulty: medium
created_at: "2026-11-02T18:02:11+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/receipt.rs"
    op: create
  - path: "src-tauri/src/git/receipt_tests.rs"
    op: create
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/race.rs"
    op: update
  - path: "src-tauri/src/commands/race.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/race.ts"
    op: update
  - path: "src/features/diff/receipt.ts"
    op: create
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/diff_receipt.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "변경"
  - "diff"
  - "git"
  - "mcp-tool"
---
[x] 변경: PR 영수증을 한 번에 복사한다

## 추가 기능
변경 화면 윗줄에 「영수증 복사」 버튼을 달았다. 누르면 이 가지가 기준 가지(origin/HEAD → origin/main → main → master)에서 갈라진 뒤의 일을 마크다운으로 클립보드에 넣는다. PR 설명에 붙이면 리뷰어가 Ocul 없이도 읽는다. 영수증에 들어가는 것:
- 가지 ← 기준 · 커밋 수 · 바뀐 파일 수
- 이 가지 일지가 걸린 계획의 마지막 확인 명령 결과(✓/✗ · 명령 · 끝 줄 · 시각, 통과 뒤 바뀐 파일 수)
- 일지마다 돌린 명령의 끝 줄
- 어느 일지에도 없는 변경(최대 20개)

## 동작 흐름
- `git/receipt.rs`
  - 기준은 merge-base 로 잡는다.
  - `diff --name-only -z <기준>`(커밋 + 커밋 전)과 `ls-files --others` 로 바뀐 파일을 모은다.
  - 그 가운데 `.oculpm/journal/*.md` 는 일지로 읽는다(제목 · 종류 · 증거 등급 · 검증 끝 줄). 나머지 파일은 일지들의 `files_touched` 와 대조한다.
  - `-z` 를 쓴 이유: quotepath 때문에 한글 파일명이 깨지지 않게.
  - git 은 읽기만 하고, 네트워크는 0 이다.
- `diff_receipt` 명령은 레인 명령 옆(`commands/race.rs`)에 두었다. git 실행은 `safe::cmd` 로만 하고, 테스트 픽스처는 `receipt_tests.rs` 에 두고 spawn 원장에 등록했다.
- `features/diff/receipt.ts` 의 `receiptMarkdown` 은 순수 함수라 같은 기록이면 같은 영수증이 나온다. 계획 집계를 못 읽어도 영수증은 서고, 계획 칸만 빠진다.
- 용어집을 따랐다: 「판정」 대신 「확인 명령」, 「기록 없는」 대신 「일지 없는」.

## 검증
- `cargo test --lib git::receipt`: 2 passed. 진짜 저장소에서 갈라진 커밋 · 커밋 전 변경 · 한글 새 파일 대조와, 기준 가지 위의 커밋 전 변경만 보는 경우를 확인했다.
- `pnpm test`: 995 passed. 세 번 연속 초록. 중간에 터미널 칸 크게 테스트가 한 번 빨개져 ref 로 고쳤다(별도 커밋). `today_v4` 「확인함」 테스트도 전체 실행에서 한 번 빨갰는데 단독으로는 초록이다. 기존 깜빡임으로 보인다.
- `cargo test --locked`: 1072 passed. `fmt` · `clippy -D warnings` · typecheck · lint · build 모두 0.