---
schema_version: 1
type: chore
slug: "phase0-measure-session-attribution"
status: done
difficulty: high
created_at: "2026-09-05T13:24:31+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "측정"
  - "기록무결성"
  - "v3"
  - "mcp-tool"
---
[x] 추정 둘을 측정으로 죽였다 — agent.session 은 채워지고, 42%는 단위가 섞여 있었다

플랜 `v3-record-integrity` 의 Phase 0. 다음 Phase 를 막고 있던 사실 확인이라 코드는 한 줄도 고치지 않았다.

## 무엇을 쟀나

**가설 1 — `AgentRef.session` 이 안 채워지는 건 낡은 설치 바이너리 탓이다 → 기각.**
캐시된 플러그인 2.39.1 과 저장소 `plugin/` 을 `diff -rq` 하니 `plugin.json` 의 버전 문자열 1줄 빼고 전 파일 바이트 동일했다. 게다가 플러그인은 러스트를 담지 않는다 — `bin/oculpm-mcp` 는 `.app` 안 실바이너리로 exec 하는 셔틀이고 그 바이너리는 이미 2.42.0 이다. 버전 라벨이 세 단계 뒤처져도 동작은 최신이었다.

**가설 2 — 세션 토큰이 없어서다 → 기각.**
env 매트릭스 4회 실측. `OCULPM_SESSION_TOKEN`·`OCULPM_NONCE`·`OCULPM_SHIM_DIR`·`OCULPM_TERM` 을 전부 unset 해도 채워진다. 결정자는 `CLAUDE_CODE_SESSION_ID` 하나다.

**진짜 이유 — 필드가 하루밖에 안 됐다.**
`AgentRef.session` 은 2026-09-04 08:10 커밋 `e777f76` 에서 생겼다. 일지 548건 중 5건에 있고 그 5건 전부 어제 오후다. 논의 문서의 「537건 중 0건」은 **그 시점엔 정확했다.**

**미기록 비율 — 「164건 중 42%」는 단위가 섞여 있었다.**
164는 세션이 아니라 **세션 세그먼트** 수다(마커가 resume 마다 재생성돼 한 대화가 최대 11회 신호를 낸다). 고유 대화는 117. 세션별 git 변경과 대조한 결과:

| 분류 (모수 117) | 대화 | 비율 |
|---|---|---|
| 코드 변경 O · 일지 0회 = 진짜 미기록 | 2 | 2% |
| 코드 변경 O · 일지 씀 = 신호 오탐 | 8 | 7% |
| 코드 변경 흔적 없음 = 소음 | 43 | 37% |
| 트랜스크립트 소실 = 판정 불가 | 64 | 55% |

오탐 중 하나는 `journal_write` 를 **55회** 부르고도 신호 11회를 냈다. 42%는 117/280 = 41.8%, 즉 *고유 세션 비율*이었고 분자(행)와 섞여 쓰였다.

## 왜 55%가 영구 판정 불가인가

신호 행에 증거가 `{ts, session_id, kind}` 뿐이고, 대조 재료인 트랜스크립트는 GC 된다. 부수적으로 `claude-events.jsonl` 에는 타임스탬프 필드가 아예 없어 원장만으로 세션 창을 재구성할 수 없고, 잔여 마커 14개 중 13개는 SessionEnd 를 못 받아(kill/crash) 무판정으로 사라진 뒤 7일 스윕이 증거까지 지운다. 원장은 구조적 과소집계다.

## 다음 Phase 에 준 설계 입력

판정 입력 우선순위를 `agent.session` → `agent_sessions` → `sessions.json` → 마커 mtime 으로 하되, **`Option` 을 「없음 = 미기록」이 아니라 「없음 = 다음 입력으로」로 다룰 것.** 채우는 자리가 `mcp/tools/mod.rs` 하나뿐이고 SQLite 캐시엔 `agent_session` 컬럼이 아예 없어 캐시 경유 판정은 영원히 `None` 이라는 것도 함께 넘겼다.

## 검증

`diff -rq` 로 플러그인 캐시↔저장소 대조, `probe.sh` 로 라이브 MCP 호출 후 frontmatter 확인(`session: "6a994a30-…"` 기록됨), `journal-missing.jsonl` 164행을 세션별로 git 이력과 수동 대조. 저장소에는 아무것도 쓰지 않았다(보고서는 스크래치패드).

## 메모

측정 중에 골든 케이스가 공짜로 나왔다 — **저장소에 한 글자도 안 쓴 이 읽기 전용 세션에 배달 게이트 플래그가 생겼다.** 같은 워킹트리의 다른 에이전트 편집이 이 세션의 마커보다 새로웠다는 것이 유일한 근거였다. 병렬 세션 오탐이 측정 도중 그대로 재현된 셈이라, `{#gate-parallel-test}` 가 물어야 할 케이스를 실물로 얻었다.