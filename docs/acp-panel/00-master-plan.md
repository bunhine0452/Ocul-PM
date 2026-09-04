# 00. ACP 에이전트 패널 — 마스터 플랜 (SSOT)

> 본 문서의 위상: `docs/acp-panel/` 의 모든 후속 문서가 참조하는 **단일 출처**.
> 작성일 2026-08-14. attribution: claude-code (Opus 5).
> 형식 선례: [`../claude-integration/00-master-plan.md`](../claude-integration/00-master-plan.md).
> 선행 결정: 같은 목표를 이루는 3가지 경로(A: IDE 락파일 WS-MCP / B: ACP / C: Agent SDK 직접) 중 **B 채택** — §1.

---

## 0. Executive Summary

ocul-pm 의 AI 패널은 지금 "우리 LLM 프로바이더에 붙은 채팅"이다. 파일을 고치지 못하고, 도구를 쓰지 못하고, 결과를 승인시킬 수도 없다. 실제 코딩은 전부 터미널 안 CLI 에서 일어나고 우리는 그 흔적(훅·파일와처·일지)만 줍는다.

이 라운드의 명령: **AI 패널을 ACP 클라이언트로 만들어 Claude Code 를 앱 안에서 에이전트로 구동한다.** 그러면 턴·툴콜·권한·플랜·토큰비용이 전부 **일급 이벤트**로 들어온다 — 자기신고 frontmatter 나 파일와처 휴리스틱이 아니라.

**2026-08-14 스파이크 결과: 인증 설정 0으로 첫 시도에 붙었고, 한 턴이 스트리밍으로 돌아왔다** (§2). 남은 최대 미검증 리스크는 프로토콜이 아니라 **Rust 크레이트와 tauri tokio 런타임의 공존**(§6 R1) — 그래서 PR-ACP0 이 그것만 검증한다.

---

## 1. 왜 B(ACP)인가 {#why-acp}

| | A. IDE 락파일 + WS-MCP | **B. ACP** | C. Agent SDK 직접 |
|---|---|---|---|
| 규격 | 비공식(리버스 엔지니어링) | **공개 문서 규격** | 공식 SDK |
| UI | CLI TUI 그대로 | **네이티브 패널** | 네이티브 패널 |
| 전제 | 에디터 버퍼·LSP 존재 | 없음 | 없음 |
| 멀티 에이전트 | Claude 전용 | **Gemini CLI 등 동일 프로토콜** | Claude 전용 |
| 런타임 | 없음 | Node(어댑터) | Node/Python |

A 가 노출하는 도구의 절반(`getCurrentSelection`·`getOpenEditors`·`getDiagnostics`)은 **코드 에디터가 있다는 전제**인데 ocul-pm 엔 에디터도 LSP 도 없다. C 는 [claude-integration 마스터플랜](../claude-integration/00-master-plan.md) 이 이미 사이드카 비용을 이유로 비목표로 기각했다.

B 의 결정타는 **프로토콜 중립성**이다. "여러 에이전트의 작업을 기록한다"는 ocul-pm 의 포지셔닝과 ACP 의 설계 의도가 정확히 겹친다 — 어댑터를 갈아끼우면 패널이 그대로 멀티 에이전트가 된다.

---

## 2. 실측 팩트 시트 (2026-08-14) {#facts}

**전부 이 날짜에 로컬에서 직접 확인한 값이다.** 재현 스크립트: [`spike/acp_spike.py`](spike/acp_spike.py).

| 항목 | 실측값 | 캐비앳 |
|---|---|---|
| **어댑터** | `@agentclientprotocol/claude-agent-acp` **0.67.0** (2026-08-14 배포) | 2주에 6회 배포 — 0.x 고속 이동. **버전 고정 필수** |
| ~~구 어댑터~~ | `@zed-industries/claude-code-acp` 0.16.2 (2026-03-26) | **옛 이름 — 쓰지 말 것.** `@agentclientprotocol` org 로 이관됨 |
| **Rust SDK** | crate `agent-client-protocol` **2.0.0** (2026-07-23) | `AcpAgent` 가 서브프로세스 spawn + 트랜스포트 역할까지 겸함 |
| TS SDK | `@agentclientprotocol/sdk` 1.3.0 | 우리는 안 씀 (Rust 클라이언트) |
| **전송** | JSON-RPC 2.0, **개행 구분 stdio** | 프레이밍 헤더 없음 |
| **버전 축 3개** | 와이어 `protocolVersion: 1` / 스펙 "ACP 1.2" / 크레이트 2.0.0 | 혼동 주의 — 서로 다른 축이다 |
| **인증** | `authMethods: []` — **인증 절차 없음** | 어댑터가 `pathToClaudeCodeExecutable`(로컬 `claude` 바이너리)를 구동 → **기존 구독 로그인 재사용**. API 키 불필요 |
| 엔진 | 어댑터 → `@anthropic-ai/claude-agent-sdk` 0.3.232 | VS Code 확장이 쓰는 SDK 와 **동일 버전** |
| **세션 모드** | `auto` · `default`(Manual) · `acceptEdits` · `plan` · `dontAsk` · `bypassPermissions` | `session/new` 응답의 `modes` |
| **configOptions** | `mode`·`model` select — 실제 모델 목록 동봉 | 모델 셀렉터를 우리가 만들 필요 없음, 그대로 렌더 |
| **관측된 `session/update`** | `available_commands_update` · `agent_message_chunk` · `usage_update` | 규격상 `tool_call`·`tool_call_update`·`plan`·`agent_thought_chunk` 등 더 있음 — 산술 프롬프트라 안 나온 것 |
| **`usage_update`** | `{used, size, cost:{amount,currency}, _meta._claude/rateLimit}` | **토큰·USD 비용·레이트리밋이 공짜로 들어온다** → 계획 항목 `#cost-telemetry`(B5) 가 여기에 흡수됨 |
| 프롬프트 응답 | `{stopReason:"end_turn", usage:{input/output/cached...}}` | 턴 경계가 결정론적 |
| 부가 능력 | `loadSession: true`, session `fork/resume/list/delete`, goal 확장, **중첩 서브에이전트 트랜스크립트** | 서브에이전트는 `clientCapabilities._meta["subagent-transcript"]=true` 옵인 |

관측 원본 (한 턴):

```
[UPD] agent_message_chunk: {"content":{"type":"text","text":"4"},"messageId":"msg_011Ce2…"}
[UPD] usage_update: {"used":52243,"size":1000000,"cost":{"amount":0.522465,"currency":"USD"}}
[RES] id=3 {"stopReason":"end_turn","usage":{"inputTokens":2,"outputTokens":3,…}}
```

---

## 3. 목표 / 비목표

**목표**

1. AI 패널에서 Claude Code 를 구동한다 — 턴 스트리밍, 툴콜 카드, **권한 승인**, 플랜, 편집 리뷰.
2. 세션 메타(턴 경계·툴콜·토큰·비용)를 **결정론적으로** 확보해 일지·플래너·회고에 먹인다. 자기신고 frontmatter 의존을 이 경로에서 제거한다.
3. 어댑터 교체만으로 다른 ACP 에이전트를 붙일 수 있는 구조로 짓는다.

**비목표 (이번 라운드)**

- **터미널 대체 아님.** 터미널 화면과 훅 브리지는 그대로 — ACP 패널은 병렬 경로다.
- ACP **에이전트** 구현 (우리는 클라이언트만).
- `fs/*`·`terminal/*` 클라이언트 능력 광고 (§4 D5).
- Windows (앱이 현재 macOS 전용 배포 — 계획 항목 `#hooks-xplat` 와 동승).
- 동시 다중 세션 (v1 은 프로젝트당 1 세션).

  > **뒤집힘 (v2.14.0)** — 한 프로젝트에서 대화 여러 개를 나란히 굴린다. A 가
  > 답하는 중에 새 대화를 열어 바로 말을 걸 수 있고, 이벤트 싱크와 권한 요청이
  > **(프로젝트, 대화)** 단위로 갈라져 한 대화를 취소해도 옆 대화의 승인 카드가
  > 함께 닫히지 않는다 (`acp/process.rs` 의 `AcpState.sinks` / `PendingPermission`).
  > 프로젝트당 하나로 남은 것은 **세션이 아니라 어댑터 프로세스**다 (D3).

---

## 4. 아키텍처 결정 (D1~D6)

### D1 — ACP 클라이언트는 **Rust 백엔드**에 둔다 {#d1-rust-client}

프론트가 직접 프로세스를 잡지 않는다. 근거: ① 프로세스 수명·취소·재연결은 이미 Rust 소유(PtyState 선례), ② `bindings.ts` 커맨드 규약(CLAUDE.md), ③ 앱 종료 시 graceful shutdown 에 자연히 얹힌다. 프론트는 `Channel<AcpEvent>` 만 구독 — [`llm.rs`](../../src-tauri/src/commands/llm.rs) 의 `chat_stream` 이 이미 쓰는 패턴 그대로다.

```
src-tauri/src/acp/
  mod.rs       — AcpState (프로젝트별 세션 레지스트리)
  process.rs   — 어댑터 수명(spawn/health/재시작), Node 조달
  session.rs   — initialize→session/new→prompt 흐름, 취소
  events.rs    — session/update → AcpEvent (specta 타입)
  permission.rs— request_permission 대기/응답 라우팅
commands/acp.rs — acp_start / acp_prompt(Channel) / acp_cancel
                  / acp_set_mode / acp_permission_respond / acp_stop
```

### D2 — Node 조달: 로그인 셸 PATH 탐색 + 버전 고정 설치 {#d2-node}

패키징된 `.app` 은 Finder 실행 시 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라 fnm/nvm/homebrew 의 `node` 가 **안 보인다**. fastembed 캐시 절대경로 사고와 같은 계열의 함정이다.

- v1: **로그인 셸(`$SHELL -lic`)로 PATH 를 얻어** `node` 를 해석 — 실패 시 "Node 18+ 를 찾을 수 없습니다" 진단 카드(설정 → 에이전트).
- 어댑터는 `npx` 매 실행 금지(네트워크·지연). **앱 데이터 디렉터리에 버전 고정으로 1회 설치**하고 그 경로를 직접 실행. 업데이트는 명시적 액션.
- 근거: 어댑터가 어차피 로컬 `claude` 바이너리를 요구한다 → **Claude Code 가 깔린 머신엔 Node 가 사실상 있다.** 번들 Node(~50MB) 나 SEA 단일 바이너리화는 v2 로 미룬다(§7).

### D3 — 세션 = 프로젝트당 1개, ACP `sessionId` 를 ocul-pm 세션에 매핑 {#d3-session}

`loadSession: true` 가 지원되므로 앱 재시작 후 재개가 가능하다. 다만 **ocul-pm `session_id` 는 첫 8자가 workday 숫자여야 한다**(IndexWriter 제약) — ACP 의 UUID 를 그대로 쓸 수 없다. 기존 `<workday>-mNN` 규칙에 맞춰 별도 id 를 만들고 ACP UUID 는 사이드 필드로 보관한다.

### D4 — 권한 요청 UI = 인라인 카드, 기본 모드 `default`(Manual) {#d4-permission}

모달이 아니라 대화 흐름에 꽂히는 카드 — [`aiActions.tsx`](../../src/features/chat/aiActions.tsx) 의 `ActionProposalCard` 선례를 따른다. `bypassPermissions` 는 노출하되 명시적 경고를 붙인다. 응답 없이 턴이 끝나면 `cancelled` 로 폴백.

### D5 — `fs/*`·`terminal/*` 클라이언트 능력은 **광고하지 않는다** {#d5-no-fs}

우리는 에디터가 아니라 열린 버퍼가 없다 — `fs/read_text_file` 를 광고하면 에이전트가 "저장 안 된 내용"을 물어보는데 우리는 디스크 내용밖에 못 준다. 광고하지 않으면 에이전트가 자체 파일 도구를 쓴다(정상 경로). 터미널도 동일 — 우리 PTY 와 이중화될 뿐이다.

### D6 — 기록 결합: `usage_update` 흡수, 일지 트리거는 턴 경계 {#d6-journal}

- `usage_update` 의 토큰·USD·레이트리밋을 그대로 저장 → 계획 항목 `#cost-telemetry`(B5) 가 **훅 계측 없이** 충족된다.
- 일지 초안 트리거는 `stopReason` 이 실린 턴 종료. **훅 브리지와 이중 기록 주의** — 훅은 터미널 CLI 세션, ACP 는 패널 세션이다. `agent_id` 를 분리한다: `claude-code` vs `claude-code:acp`.
- 중첩 서브에이전트 트랜스크립트(옵인)는 "서브에이전트가 뭘 했는지"를 일지에 남길 수 있는 유일한 경로 — v2 후보.

---

## 5. PR 분해

| PR | 내용 | 완료 기준 |
|---|---|---|
| **ACP0** | **런타임 공존 스파이크** — Rust 에서 `AcpAgent` 로 handshake 1회 | tauri tokio 런타임 안에서 `initialize` 응답 수신. `async-process`/`async-io` 리액터가 tokio 와 공존함을 증명 (§6 R1) |
| **ACP1** | 프로세스 수명 + Node 조달 + 진단 UI | 앱 시작/프로젝트 전환에 어댑터 spawn·종료. Node 없음이 친절한 진단으로 표면화. 패키징 `.app` 에서 동작 |
| **ACP2** | 세션 + 텍스트 스트리밍 | 패널에서 프롬프트 → `agent_message_chunk` 라이브 렌더 → `stopReason`. 취소 동작 |
| **ACP3** | 툴콜 · 권한 카드 | `tool_call`/`tool_call_update` 카드, 승인/거절이 실제로 에이전트를 진행/중단시킴 |
| **ACP4** | 모드·모델 셀렉터 + 플랜 + usage/cost | `configOptions` 를 그대로 렌더. 플랜 카드. 토큰·비용 배지 |
| **ACP5** | 일지·플래너 결합 (D6) | 턴 종료 → 일지 초안, `agent_id` 분리, 비용 텔레메트리 적재 |

ACP0 은 **하루 안에 끝나거나 설계를 뒤집는다** — 먼저 돌린다.

---

## 6. 리스크

| | 리스크 | 대응 |
|---|---|---|
| **R1** | 크레이트가 `async-process`/`async-io`(smol 계열) 기반 — tauri 의 tokio 멀티스레드 런타임과 공존 미검증. **가장 큰 미검증 항목** | PR-ACP0 이 이것만 본다. 실패 시 폴백: 어댑터를 직접 spawn 하고 JSON-RPC 를 손으로 처리(프로토콜은 개행 구분 JSON — 자체 구현 난이도 낮음) |
| **R2** | 어댑터 0.x, 2주에 6회 배포 | 버전 고정 + 방어적 파싱(모르는 `sessionUpdate` 는 무시하고 로깅) + 업데이트는 명시적 액션 |
| **R3** | Node 부재/PATH 미해결 (D2) | 진단 UI 를 1급으로. v2 에서 SEA 번들 |
| **R4** | 구독 레이트리밋 — 스파이크에서 `utilization: 0.8`, `allowed_warning` 실측 | `_meta._claude/rateLimit` 를 UI 에 표면화. 패널이 조용히 죽지 않게 |
| **R5** | 훅 브리지와 이중 기록 | D6 의 `agent_id` 분리 + 일지 중복 감지 |

---

## 7. 백로그 (이번 라운드 밖)

- Node SEA/bun compile 로 어댑터 단일 바이너리화 → Node 의존 제거
- Gemini CLI 등 2번째 ACP 어댑터 연결 (프로토콜 중립성 실증)
- 중첩 서브에이전트 트랜스크립트 옵인 → 서브에이전트 단위 일지
- ACP `goal` 확장 ↔ ocul-pm 플래너 항목 양방향 결합
- Windows (`#hooks-xplat` 와 동승)
