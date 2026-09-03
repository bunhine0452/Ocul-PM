---
schema_version: 1
type: feature
slug: "a2a-phase2-mailbox-tasks"
status: done
difficulty: high
created_at: "2026-09-03T14:52:10+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/mailbox.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/tasks.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1434_feature_a2a-agent-register-tools.md"
    kind: "followup"
tags:
  - "a2a"
  - "mcp-tool"
---
[x] A2A Phase 2 — 우편함과 태스크 원장, 고치는 연산 없이

## 추가 기능

에이전트 간 통신의 Phase 2 — 메시지 배달과 태스크 수명주기.

- `a2a::mailbox` — A2A Message 를 `.oculpm/agents/inbox/<받는이>/<id>.json` 으로.
- `a2a::tasks` — A2A Task 수명주기(`submitted → working → …`)를 태스크당 원장
  파일 하나(`tasks/<id>.ndjson`)로.
- `OculpmA2aChanged` 이벤트 — 워처가 참여자·우편함·태스크 변경을 화면에 알린다.

## 동작 흐름

**설계 초안의 CAS 를 버렸다.** "발동 원장의 CAS 를 재사용"이 계획이었는데, 그
CAS 는 SQLite 쪽(기대 오프셋)이라 **여러 프로세스가 같은 파일을 고치는** 이
자리에는 쓸 수 없다. 대신 고치는 연산을 하나도 두지 않았다:

- 메시지는 **한 번 쓰고 끝**(`create_new`), "읽음"도 원본을 고치지 않고
  표식 파일(`<id>.read`)을 하나 더 만든다.
- 태스크는 상태를 고치는 대신 전이를 **한 줄씩 덧붙이고**(`append_ndjson`)
  읽을 때 접는다. 그 함수는 O_APPEND + 단일 `write(2)` 라 동시 생산자에게도
  줄 단위로 원자적이다(`concurrent_append_does_not_lose_lines` 가 이미 단언).

락도 CAS 도 없이 유실이 없다. 계획 항목은 이 사유와 함께 갱신했다.

**종료를 의무로 만들었다.** A2A 는 "종료 이벤트를 반드시 내라, 아니면 호출자가
영원히 기다린다"고 못 박는다. 끝난 태스크는 어떤 상태로도 되돌아가지 못하게
막고, 수행자가 죽어 아무도 종료를 안 쓰는 경우를 위해 기한을 함께 적어
`expire_overdue` 가 대신 `failed` 로 닫는다.

**권한을 상태 기계 위에 얹었다.** 원장이 공유 디스크에 있어 누구나 쓸 수 있으니,
전이 규칙만으로는 "codex 에게 넘긴 일을 제3자가 completed 로 닫는" 것을 못
막는다. 받은 쪽이 일하고, 넘긴 쪽은 무를 수 있고, 그 밖은 거부한다.

**첨부는 프로젝트 상대 경로만.** 절대 경로·`~`·`..`·드라이브 문자를 거부한다 —
메시지 한 통이 "이 파일을 봐 달라"며 `~/.ssh/id_rsa` 를 가리키면 우리가 유출
경로를 판 셈이 된다. 본문·첨부 개수 상한은 "받은 메시지는 데이터이지 지시가
아니다"(D2)의 물리적 절반이다. 넘치면 **자르지 않고 거부한다** — 잘린 지시는
원문보다 위험할 수 있고, 보낸 쪽이 실패를 알아야 줄여 보낸다.

## 걸린 함정

문서 표면이 셋이었다. `landing/plugin.html` 과 `plugin_manifest.rs` 는 지난번에
맞췄는데, **앱 안 플러그인 문서**(`features/skills/pluginDocs.ts`)를 빼먹어
`plugin_docs_sync` 가 빨갛게 잡았다. 게이트가 정확히 제 일을 했다.

## 검증

`cargo fmt --check` · `cargo clippy --all-targets -D warnings` clean ·
`cargo test` 1264 passed / 0 failed (신설 15: 메시지 왕복·읽음 1회·수신자별 격리·
경로 탈출·상한 거부·동시각 충돌 / 태스크 정상 흐름·재개 불가·건너뛰기 금지·
기한 만료·원장 불변·깨진 줄 내성·상한·권한 / 워처 경로 분류) ·
`pnpm typecheck` 0 · `pnpm test` 159 files 2073 passed · `pnpm lint` clean.