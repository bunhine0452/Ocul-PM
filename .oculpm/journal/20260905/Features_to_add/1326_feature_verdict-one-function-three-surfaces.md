---
schema_version: 1
type: feature
slug: "verdict-one-function-three-surfaces"
status: done
difficulty: superhigh
created_at: "2026-09-05T13:26:37+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/verdict/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/collect.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/cli.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/ledger.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "plugin/oculpm/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm/hooks/session-marker.sh"
    op: update
  - path: "src-tauri/tests/delivery_gate.rs"
    op: update
  - path: "src-tauri/tests/session_verdict.rs"
    op: create
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
related: []
tags:
  - "기록무결성"
  - "배달게이트"
  - "v3"
  - "mcp-tool"
---
[x] 세션 귀속 판정을 순수 함수 하나로 — 세 표면이 같은 것을 부른다

## 추가 기능

배달 게이트·세션종료 신호·Today 카드 세 표면이 전부 **프로젝트 전역 journal mtime** 한 근사에 얹혀 있었다. 근사가 하나라 병렬 세션에서 셋이 동시에, 전부 같은 방향으로 무너졌다.

`oculpm/verdict/` 를 신설했다. `judge(&VerdictInput) -> Verdict` 는 파일시스템을 읽지 않고(순수), 수집은 `collect()` 가 따로 한다 — 폐기됐던 `mcp-lifecycle-hooks` 의 `stop_verdict` 가 옳게 설계해 놓고 "판정이 셸에 있어 하네스가 없다"는 이유로 죽은 것을 되살린 것이다. 이번엔 판정을 셸에서 꺼내 오면서 하네스 문제가 같이 풀렸다.

```rust
pub enum Verdict { Clear(Clear), Undecided(Undecided), Objection(Objection) }
pub enum RecordBasis { AgentSession, AgentSessions, SessionsJson, MarkerMtime } // 1→4순위
```

## 동작 흐름

**기록 확인은 4단 사다리.** `agent.session` → `agent_sessions` → `sessions.json` 시간창 → 마커 mtime. `recorded_basis()` 가 내려가며 첫 성공에서 멈추고, 전부 실패하면 `None` 을 돌려준다. **그 `None` 은 "미기록"이 아니라 "다음 물음으로"** 라는 뜻이다 — Phase 0 이 잰 오탐 8건(그중 하나는 `journal_write` 를 55회 부르고도 신호 11회를 냈다)이 정확히 이 구분의 부재에서 나왔다.

**설계의 핵심은 비대칭이다.** 기록 확인은 관대해도 안전하다(틀리면 침묵한다). 그러나 변경 귀속은 관대하면 엉뚱한 대화를 붙잡는다. 그래서 4순위 전역 mtime 은 **살아 있는 옆 대화가 있으면 아예 쓰지 않는다** — 옆 대화의 일지로 우리가 "기록했다"가 되면 원장이 거짓을 남기므로, 그때는 정직하게 `undecided` 로 적는다.

**살아 있음의 판정**은 마커 존재로 셀 수 없다. 실측상 잔여 마커 14개 중 13개가 SessionEnd 를 못 받았다(kill/crash) — 그걸 근거로 삼으면 사고 한 번에 게이트가 영구 침묵한다. 그래서 훅이 매 턴 다시 찍는 `.session-live-<대화>` 를 마커와 함께 본다. 창은 6시간(짧으면 오탐, 길면 미탐이라 비대칭대로 넉넉한 쪽).

**세 표면의 진입점.** 셸 훅은 `oculpm-mcp verdict --root <dir> --conversation <id> [--ledger]` 를 부른다 — 기존 셔틀을 재사용해 새 바이너리를 만들지 않았다. 판정은 **종료 코드**로 전달한다(0 이의없음 / 10 이의 / 11 판정불가 / 2 사용법): `sh` 의 JSON 파싱 자체가 결함 원천이다.

**바이너리를 못 찾으면 침묵한다.** 옛 셸 판정으로 폴백하지 않는 이유 둘 — ① 폴백은 방금 걷어낸 오탐을 그대로 되살린다. ② 바이너리가 없으면 MCP 서버도 없어 게이트가 지시하는 `journal_write` 자체가 존재하지 않는다. 실행할 수 없는 지시로 턴을 막는 것은 도구가 아니라 방해다.

신호 원장의 읽기·쓰기를 `verdict/ledger.rs` 한 자리로 모으고 회전을 `file_guard::FileGuard` 로 보호했다. 셸의 `tail -n 100 > tmp && mv` 경합과 `cat >>` 개행 누락(깨진 줄 5건 실재)이 함께 걷혔다.

## 검증

**고치기 전에 실패하는지 먼저 확인했다.** `a_live_peers_edits_do_not_accuse_a_read_only_session` 이 옛 코드에서 `left: Some(2), right: Some(0)` 으로 떨어졌다 — 골든 케이스는 이 라운드에서 실제로 겪은 것이다(저장소에 한 글자도 안 쓴 읽기 전용 조사 세션이 옆 에이전트의 편집으로 게이트에 걸렸다).

고친 뒤 `delivery_gate` 9 passed, `session_verdict` 4 passed, `cargo test` 전 스위트 통과. 실기기 스모크: 마커 없음 → rc 11, 백데이트한 마커 → rc 10 + 더티 37개 정확히 나열, **43ms**(일지 548건 트리) — 매 턴 도는 자리로 충분하다.

`plugin_manifest` 의 단언을 판정 로직에서 진입점 계약으로 옮겼다. 판정이 셸에 없어졌으니 셸 문자열을 무는 단언은 아무것도 지키지 못한다 — 행위는 `tests/delivery_gate.rs` 가 훅을 실제로 실행해 잰다.

## 메모

**대가가 있다: 병렬 세션에서는 게이트가 아예 발화하지 않는다.** 살아 있는 옆 대화가 하나라도 있으면 전부 `undecided` 다. 오탐보다 미탐을 고른 결과이고 이 저장소의 주 사용 방식(병렬 세션)에서는 게이트가 사실상 꺼진 셈이다. 넘어설 길은 이미 보인다 — Stop 페이로드의 `transcript_path` 에 그 대화 자신의 Edit/Write 도구 호출이 들어 있어 **대화별 양성 귀속**이 가능하다. 이월 1순위.

레거시 원장 164행은 `verdict` 필드가 없어 전부 제외된다(실측 대조상 진짜 미기록 2건). Today 카드는 새 줄이 쌓일 때까지 0을 보이는데, 같은 라운드에서 넣은 0건 한계 문구가 정확히 그 상황을 설명한다.

삭제만 한 대화는 여전히 빠져나간다 — 삭제된 파일은 mtime 을 물을 자리가 없다(셸 판정의 한계를 그대로 물려받았다).