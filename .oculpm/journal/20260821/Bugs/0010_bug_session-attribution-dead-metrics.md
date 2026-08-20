---
schema_version: 1
type: bug
slug: session-attribution-dead-metrics
status: done
difficulty: high
created_at: "2026-08-21T00:10:14+09:00"
session_id: "manual-20260821-001014"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/session.rs"
    op: update
  - path: "src-tauri/src/oculpm/index.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ".oculpm/journal/20260820/Bugs/2355_bug_honesty-audit-false-positives.md"
tags: [session-attribution, compare-layers, mcp, dogfooding]
---

[x] 세션↔일지 연결이 끊겨 matched·jaccard 는 0, linked_journal_entries 는 영원히 빈 배열

## 발생 원인

앞선 일지([2355](../../20260820/Bugs/2355_bug_honesty-audit-false-positives.md))에서 정직성
판정만 워크데이 커버리지로 우회해 급한 오탐을 껐고, 세션↔일지 연결 자체는 끊어진 채로 뒀다.
그 결과 세 가지가 죽어 있었다.

**1. `matched` / `jaccard_index` / `only_in_journal` 이 항상 0.** `compare_layers` 의 조인이
`j.session_id = ?2` 완전 일치뿐이라, 에이전트가 파일을 직접 쓰며 찍는
`manual-20260820-205400` 이나 MCP 도구가 찍는 `mcp-20260820-205400` 은 watcher 의
`20260820-002` 와 영원히 안 겹쳤다. 오늘 일지 13개 전부 `manual-` 방언이었으니 세 지표가
전부 죽은 숫자였다.

**2. MCP `journal_write` 가 합성 ID 를 찍고 있었다.** 도구가 `mcp-{workday}-{HHMMSS}` 를
만들어 넣으니, MCP 를 쓰는 에이전트도 똑같이 연결이 끊겼다. 도구 서버가 별도 프로세스라
`SessionActor` 를 못 물어보는 게 이유였는데 — `sessions.json` 은 디스크에 그냥 있었다.

**3. `linked_journal_entries` 는 쓰는 곳이 6군데인데 전부 `Vec::new()`,
읽는 곳은 0군데.** 문서화된 on-disk 형식의 필드가 영구히 빈 배열이었다.

## 해결 방법

**타임스탬프 귀속 (`session.rs`).** `resolve_session_for_timestamp` 는 `ts` 를 포함하는
`[started_at, ended_at]` 구간이 아니라 **`ts` 이전에 시작한 마지막 세션**을 고른다. 일지는
설명하는 작업보다 *나중에* 쓰이므로 세션 종료를 예사로 넘어간다 — 실제로 8/20 세션 `-002`
는 20:53:50 에 비활동 타임아웃으로 닫혔는데 그 세션의 일지 3개는 20:54·20:55·20:56 에
쓰였다. 구간 포함 검사였다면 셋 다 놓친다. 문자열 비교가 아니라 인스턴트로 비교하므로
오프셋이 섞여도(`13:54+00:00` = `22:54+09:00`) 안 틀린다.

**두 갈래 덧셈 (`compare_layers`).** 기존 `files_for_session`(완전 일치, **의도적으로
워크데이 무관** — 원래 주석이 "프론트매터 workday 와 id 접두사가 어긋날 때의 드리프트를
피하려고" 라고 못 박아 뒀다)은 그대로 두고, 합성 ID 만 `created_at` 으로 귀속시켜 **더한다**.
교체가 아니라 덧셈이라 기존 계약이 안 깨지고, 진짜 세션을 명시한 일지를 합성 ID 가 뺏어갈
수도 없다. `is_watcher_session_id` 로 두 방언을 구분한다.

**MCP 는 디스크에서 라이브 세션을 읽는다 (`tools.rs`).** `index::read_sessions_sync` 를
추가해(동기 — 도구 함수가 async 가 아니고 tokio 런타임도 없다) `sessions.json` 을 읽고
귀속시킨다. 우선순위는 명시 인자 → 디스크의 라이브 세션 → 합성 폴백. 앱이 안 떠 있으면
세션이 없으니 예전처럼 합성 ID 로 떨어진다.

**`linked_journal_entries` 는 읽을 때 파생한다 (`attach_journal_links`), 저장하지 않는다.**
`sessions.json` 은 SessionActor 가 read-modify-write 하는데(`upsert_session` /
`finalize_session` / `unfinalize_session`, 전부 프로젝트당 단일 액터 태스크), watcher 의 일지
경로에서 두 번째 writer 가 끼어들면 lost update 로 세션 상태가 조용히 날아간다. 읽을 때
계산하면 경합이 없고 항상 최신이며 감사와 드리프트할 수가 없다 — 코드에 "디스크 쓰기로
'최적화'하지 말 것" 을 근거와 함께 남겼다.

## 검증

`cargo test` 628개(+11) 통과 — 신규: `session.rs` 6개(세션 종료 뒤 쓰인 일지 귀속·작업한
세션으로 귀속·첫 세션 이전이면 주인 없음·오프셋 교차 비교·비정렬 입력·방언 구분),
`manager.rs` 3개(타임스탬프 귀속으로 지표 부활·명시 ID 는 재귀속 안 됨·링크 파생),
`mcp/tools.rs` 2개(라이브 세션 채택·명시 인자 우선). `pnpm test` 1080개 통과.
typecheck / lint / build 전부 exit 0. `bindings.ts` 는 `cargo test` 가 재생성.

실데이터 대조 — 8/20 ndjson + 일지 14개에 전체 파이프라인을 적용:

| 세션 | 변경 | linked | matched (전→후) | jaccard (전→후) | 미기록 |
|---|---|---|---|---|---|
| -002 | 11 | 5개 | 0 → **11** | 0.00 → **0.73** | 0 |
| -004 | 14 | 1개 | 0 → **14** | 0.00 → **0.93** | 0 |
| -005 | 44 | 8개 | 0 → **40** | 0.00 → **0.91** | 4 |

귀속이 실제로 맞다: `-004` 는 21:45~22:03 세션이고 링크된 일지 1개가 22:02 의
`today-line-churn-always-zero` — 그 세션이 만진 파일이 정확히 Today 링/라인 카운트다.

## 메모

`-002` 의 jaccard 가 0.73 으로 셋 중 낮은 건 오탐이 아니라 신호다. 21:24·21:25 에 쓰인 일지
2개가 세션이 하나도 안 열려 있던 공백 구간의 작업을 담고 있어서, 직전 세션인 `-002` 로
귀속되며 그 세션이 안 건드린 파일들을 `only_in_journal` 로 만든다. watcher 가 세션을 안 연
동안의 변경은 ndjson 에 없으니 원리적으로 맞출 수 없다 — 남은 천장.

AGENTS.md 는 안 고쳤다. 에이전트가 watcher 의 세션 번호를 알 방법이 없는 게 근본 제약이라
서버 쪽에서 푸는 게 맞고, 규칙 템플릿을 건드리면 `rule_canary` 게이트까지 흔든다.
