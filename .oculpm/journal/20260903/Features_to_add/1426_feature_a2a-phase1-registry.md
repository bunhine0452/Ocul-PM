---
schema_version: 1
type: feature
slug: "a2a-phase1-registry"
status: done
difficulty: medium
created_at: "2026-09-03T14:26:26+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/registry.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: ".gitignore"
    op: update
related:
  - ref: "20260903/Bugs/1408_bug_codex-acp-review-fixes.md"
    kind: "followup"
tags:
  - "a2a"
  - "acp"
  - "mcp-tool"
---
[x] A2A Phase 1 — 같은 프로젝트에 누가 붙어 있는지 알게 된다

## 추가 기능

에이전트 간 통신(`docs/a2a/00-master-plan.md`)의 첫 Phase — **참여자 레지스트리**.
각 에이전트가 A2A Agent Card 한 장을 `.oculpm/agents/live/<id>.json` 에 둔다.

- `oculpm::a2a::registry` — 카드 스키마(A2A 표준 필드 + project_root·session_id·
  provider·pid·surface 확장), 등록·하트비트·해제·목록·수거.
- 앱 안 ACP 어댑터는 **앱이 대신 등록한다** — 핸드셰이크가 끝나 레지스트리에
  넣는 자리에서 `publish_card`, 연결이 끝나면 `withdraw_card`.
- `.oculpm/agents/live/` 를 gitignore 관리 블록에 넣는다 (이 저장소 자신의
  `.gitignore` 도 같은 줄로 맞춘다).

## 동작 흐름

카드가 파일인 이유는 앱과 앱 밖 CLI 세션이 서로 다른 프로세스라 공유 메모리가
없고, 데몬을 새로 띄우지 않고 둘 다 볼 수 있는 것이 디스크뿐이기 때문이다.
`.oculpm/hooks/` 와 같은 규약 — gitignore 되지만 워처는 본다.

**살아 있음 판정에 TTL 을 쓰지 않는다.** TTL 하나로는 양쪽으로 틀린다: 짧으면
사람이 붙어 있는 CLI 세션이 조용하다는 이유로 죽은 것이 되어 위임이 허공으로
가고, 길면 죽은 세션이 목록에 남는다. 그래서 **pid 를 먼저 본다** —
유닉스는 `kill(pid, 0)`. 프로세스가 없으면 하트비트가 아무리 새것이어도 죽은
것이다. pid 가 살아 있으면 하트비트는 참고값이고, pid 재사용을 감안해 12시간
넘게 조용한 것만 죽은 것으로 본다. 윈도우는 값싼 대응물이 없어 "모른다 = 살아
있다"로 두고 하트비트에 맡긴다 — 산 것을 죽었다고 지우는 쪽이 더 나쁘다.

앱 안 카드의 pid 로 **앱의 것**을 적는다. 어댑터는 우리 자식이라 앱이 죽으면 함께
죽고, 그러면 종료 처리가 못 돌더라도 pid 판정이 그 카드를 저절로 죽은 것으로
만든다 (유령 참여자에게 작업을 넘기는 사고가 구조적으로 막힌다).

## 걸린 함정

워처가 `.oculpm/agents/**` 를 보면 **모든 어댑터의 AGENTS.md 재동기화**를 캐스케이드
한다. 카드가 그 아래 살기 때문에, 한 장 쓸 때마다 그 캐스케이드가 돌 뻔했다 —
Phase 2 에서 하트비트가 얹히면 그대로 증폭 루프다. `.oculpm/agents/live/` 를
캐스케이드 분기보다 **먼저** 걸러 끊었다.

## 검증

`cargo fmt --check` · `cargo clippy --all-targets -D warnings` clean ·
`cargo test --lib` 1170 passed / 0 failed (신설 8: id 경로탈출 방어, 등록 왕복,
재등록 멱등, 죽은 pid 우선, pid 재사용, 원격 TTL, 하트비트가 부활시키지 않음,
깨진 카드 내성) · `pnpm typecheck` 0 · `pnpm test` 159 files / 2073 passed.
앱 밖 CLI 세션의 자진 등록(`agent_register` MCP 도구)은 다음 항목이다.