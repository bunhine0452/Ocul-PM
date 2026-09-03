---
schema_version: 1
type: chore
slug: "buzz-borrows-discussion-and-plans"
status: done
difficulty: medium
created_at: "2026-09-03T16:44:16+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/discussion/buzz-borrows/discussion.md"
    op: create
  - path: ".oculpm/planner/untrusted-text-framing.md"
    op: create
  - path: ".oculpm/planner/ledger-and-liveness-honesty.md"
    op: create
  - path: ".oculpm/planner/evidence-based-rules.md"
    op: create
  - path: ".oculpm/planner/session-shim-cli.md"
    op: create
  - path: ".oculpm/planner/mcp-lifecycle-hooks.md"
    op: create
related: []
tags:
  - "research"
  - "discussion"
  - "planning"
  - "buzz"
  - "mcp-tool"
---
[x] block/buzz 정독 — 논의 문서 1개와 플랜 5개로 갈랐다

## 무엇을 했나

`block/buzz`(Block 의 Nostr 기반 사람+에이전트 워크스페이스)를 clone 해서 **에이전트 표면·규율·클라이언트 층만** 정독하고, ocul-pm 이 가져올 것 13건을 판정해 논의 문서로 남긴 뒤 실행 플랜 5개로 갈랐다. 서버(릴레이 85K줄·DB 50K줄·모바일·git 호스팅·멀티테넌시)는 우리가 가져올 수 없어 의도적으로 건너뛰었고, 그 한계를 문서에 적었다.

판정: **채택 7 · 보류 2 · 기각 4.** 기각은 전부 "좋지만 지금 아님"이라 다시 열 조건을 함께 적었다.

## 왜 5개로 갈랐나

위험의 **종류**가 서로 다르기 때문이다. F1(MCP `_Stop` 훅)은 외부 하네스가 그 규약을 부르는지에 걸려 있어 실측 전엔 범위가 안 정해지고, F2(프레이밍)는 순수 함수라 반나절이며, F3(해시 체인)은 디스크 포맷이라 **시점**이 비용을 정하고, F4(심 CLI)는 플랫폼별 함정이 있고, F7(규칙 채굴)은 휴리스틱이라 오탐 규율이 필요하다. 한 라운드로 묶으면 가장 불확실한 것이 나머지 넷을 인질로 잡는다.

## 진행 순서와 근거

1. `untrusted-text-framing` — 열려 있는 `a2a-agent-mesh {#threat-model}` 를 닫아 그 플랜의 릴리스를 푼다. 지금 그 항목의 방어는 도구 설명문 한 줄(`tools.rs:261`)과 응답 JSON 의 `note` 한 줄(`tools.rs:501`) — 우리가 안티패턴이라 부른 것으로 안티패턴을 막고 있다.
2. `ledger-and-liveness-honesty` — a2a 릴리스 **전에** 해야 마이그레이션이 아니다. NDJSON 포맷이 사용자 디스크에 퍼진 뒤 `prev` 를 넣으면 값이 몇 배가 된다.
3. `evidence-based-rules` — 래칫은 몇 줄이라 즉시. 규칙 채굴은 컨텍스트 예산 화면의 빈 절반(값어치)을 채운다.
4. `session-shim-cli` — 신원이 잡혀야 5번의 판정이 정확해진다.
5. `mcp-lifecycle-hooks` — 실측 의존이 제일 크다. Phase A 에 "부르는 하네스가 하나도 없으면 이 플랜을 접는다"를 명시했다.

## 조사에서 나온 우리 쪽 사실 (플랜의 근거)

- `a2a/tasks.rs` 의 append-only NDJSON 은 줄 유실은 막지만 삭제·수정은 검출 못 한다 — 해시 관련 코드 0건. `blake3` 는 이미 의존성에 있다.
- `registry.rs:183 is_live -> bool` 은 판정 불가를 표현할 자리가 없고, `#[cfg(not(unix))] pid_alive -> true` 는 Windows 에서 모름을 살아있음으로 단정한다. 소비자인 `leases::sweep` 이 그 판정으로 임대를 걷는다.
- 쓰기 경로는 이미 단단하다 — `redact_text` · `MAX_TEXT_CHARS 4000` · `MAX_ARTIFACTS 20` · `is_safe_artifact`. 비어 있는 것은 **읽기 경로**뿐이다.
- CLAUDE.md 의 "800줄 한계"는 강제되지 않는다. lint 는 이미 4종이 돌고 있어 다섯 번째 비용은 거의 0.
- `main.rs` 의 same-exe 멀티콜(`--pty-host`·`config`)이 이미 있어 심 CLI 의 기반은 깔려 있다.

## 검증

`.oculpm/discussion/buzz-borrows/discussion.md` 477줄 생성 — frontmatter·`## 문제 정의` 선두·`### 방안 {#opt-id}`·managed 토의 로그·`## 결론`·`- [ ] … {#next-id}` 를 discussion-spec v7 대로 확인했다. 플랜 5개는 `plan_create` 로 생성돼 항목 115개(22+26+22+22+23)가 전부 `{#id}` 를 줄 끝에 갖고 있음을 파일에서 확인했다. 코드 변경이 없어 게이트는 돌리지 않았다.

## 메모

기각한 F11(12 렌더 클래스 활동 피드)·F12(페르소나 팩)·F13(워크플로 YAML)은 근거와 파일 경로를 논의 문서에 남겼다 — AI 패널을 다음에 손댈 때, 스킬을 내보낼 포맷을 정할 때, 자동화 요구가 실제로 생길 때 다시 연다.