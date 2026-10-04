# 네이티브 에이전트 드라이버 — 마스터 플랜

> 작성 2026-10-05 · 기준 v3.7.0 (`5c55b5ba`) · **상태: 설계, 미구현**
>
> 진행 상태는 이 문서가 아니라 플래너가 갖는다: [`.oculpm/planner/native-agent-drivers.md`](../../.oculpm/planner/native-agent-drivers.md) (플랜 id `native-agent-drivers`).
> 재현 스크립트: [`spike/`](spike/) · 스파이크 일지: `.oculpm/journal/20261005/Chores/0155_chore_native-agent-protocol-spikes.md`
>
> 선행 문서: [`acp-panel/00-master-plan.md`](../acp-panel/00-master-plan.md) — 이 문서는 그 §1 의 선택(B. ACP)을
> Claude Code · Codex 에 한해 다시 연다.

## 0. 요약

앱 안의 Claude Code · Codex 화면은 지금 ACP 어댑터를 거친다.

```
지금   ocul-pm ─ACP→ claude-agent-acp (Node) → Agent SDK → claude
       ocul-pm ─ACP→ codex-acp (Node) ─────────────────→ codex
제안   ocul-pm ─stream-json 제어 프로토콜──────────────→ claude
       ocul-pm ─app-server JSON-RPC───────────────────→ codex
```

우리는 어댑터가 노출하기로 한 것만 받는다. `/remote-control`(`/rc`)이 대표적이다 —
2026-08-15 에 ACP `extraArgs` 로 `--remote-control` 을 넘겨 봤지만 짝짓기 안내가
어디에도 오지 않았다(`src/features/chat/conversation/useAcpSend.ts` 주석). 그래서
지금은 `/rc` 를 치면 터미널로 보낸다.

**2026-10-05 스파이크 결과: 두 CLI 모두 자기 공식 클라이언트에 쓰는 통로에 Rust
앱이 직접 붙을 수 있다.** Codex 는 승인 대기 중 프로세스가 죽어도 이어서 끝났고,
헤드리스 Claude 는 `remote_control` 제어 요청에 세션 URL 을 그대로 돌려줬다 (§2).

제안: Claude · Codex 는 **네이티브 드라이버**로 옮기고, ACP 는 자체 프로토콜이
없는 에이전트를 위한 드라이버로 남긴다. 화면(프런트 약 7.6k 줄)은 이벤트 계약을
그대로 받으므로 거의 바뀌지 않는다 (D1).

---

## 1. 왜 다시 여는가 {#why}

acp-panel §1 은 세 안을 비교했고 C(Agent SDK 직접)를 **"사이드카 비용"**(Node/Python
런타임)으로 기각했다. 그런데 이번 제안은 SDK 를 쓰지 않는다 — SDK 가 안에서 하는
일(CLI 를 stream-json 으로 띄우고 제어 메시지를 주고받기)을 Rust 가 직접 한다.
**사이드카가 없으므로 그 기각 사유가 성립하지 않는다.** B 의 결정타였던 프로토콜
중립성은 ACP 드라이버를 남겨 둠으로써 유지된다.

ACP 를 거쳐서 생기는 비용 (전부 이 저장소에서 확인한 것):

| 비용 | 근거 |
|---|---|
| 어댑터가 숨긴 기능은 못 쓴다 — `/rc`, Codex 의 `review/start` · `thread/fork` · `thread/goal/*` · `turn/diff/updated` | `useAcpSend.ts` 의 `/rc` 터미널 우회, 스파이크 §2.1 |
| Node 런타임 의존 (D2 · R3) — 패키징 `.app` 의 PATH 탐색, 진단 UI | `acp/env.rs` 345 줄, `acp/adapter.rs` |
| 어댑터 고속 배포 추적 (R2) — 버전 고정·`dist/` 대조·재스파이크를 릴리스마다 | `adapter.rs` `PINNED_VERSION` 이력 (0.67 → 0.77 → 0.81, codex-acp 1.8 → 1.13) |
| **딸려 온 CLI ≠ 터미널 CLI** — 어댑터가 묶어 온 claude/codex 바이너리를 쓰므로 사용자가 터미널에서 쓰는 버전과 기능이 다를 수 있다 | `adapter.rs::bundled_claude` |

---

## 2. 실측 팩트 시트 (2026-10-05) {#facts}

**전부 이 날짜에 로컬에서 직접 확인한 값이다.** 재현: [`spike/`](spike/).

### 2.1 Codex — `codex app-server` (codex-cli **0.155.1**)

| 항목 | 실측값 | 캐비앳 |
|---|---|---|
| 정체 | Codex VS Code 확장이 쓰는 JSON-RPC 2.0 서버. 구현은 `openai/codex/codex-rs/app-server` (Rust, 오픈소스) | 공식 표기 **experimental — "프로덕션 미지원"** |
| 전송 | 기본 stdio, 줄 구분 JSON | WebSocket 은 실험적 |
| 스키마 | `codex app-server generate-json-schema --out <dir>` → **설치된 버전 그대로**의 스키마. 클라이언트 메서드 102 · 알림 82 · 서버 요청 10 | 버전마다 다르다 → 계약 테스트의 재료 (D3) |
| 초기화 | `initialize{clientInfo, capabilities:{experimentalApi:true}}` → `initialized` 알림 | experimental 메서드는 opt-in 없으면 거부 |
| 승인 요청 (서버→클라이언트) | `item/commandExecution/requestApproval` · `item/fileChange/requestApproval` · `item/permissions/requestApproval` | 응답 `{decision: "accept" \| "acceptForSession" \| …}` |
| 승인 대기 표시 | `thread/status/changed` → `activeFlags:["waitingOnApproval"]` | |
| **승인 대기 중 프로세스 kill → 재개** | 새 app-server 에서 `thread/resume` → 직전 turn `interrupted`, 스레드 `idle`. 같은 스레드에 "승인됨, 진행" turn → 승인 요청 재수신 → `accept` → 실행 → 완료. **전 과정 17초** | 재개 후 에이전트가 **다시 묻는다** — 승인을 "기억"시키려면 `acceptForSession` 이나 정책 조정 (D6) |
| ACP 로는 안 보이던 것 | `review/start` · `thread/compact/start` · `thread/fork` · `thread/goal/*` · `turn/diff/updated` · `turn/plan/updated` · `hook/started\|completed` · `thread/tokenUsage/updated` · `account/rateLimits/updated` · `remoteControl/status/changed` | |
| 훅 | 사용자의 ocul-pm Codex 플러그인 훅(sessionStart · stop)이 그대로 돌고, 그 실행이 `hook/*` 이벤트로 보인다 | |

### 2.2 Claude Code — stream-json 제어 프로토콜 (Claude Code **2.1.289**)

| 항목 | 실측값 | 캐비앳 |
|---|---|---|
| 기동 | `claude -p --input-format stream-json --output-format stream-json --verbose` | 부모가 Claude Code 세션이면 `CLAUDECODE` · `CLAUDE_CODE_*` 환경을 지우고 띄운다 |
| 제어 프로토콜 | `{"type":"control_request","request_id","request":{"subtype":…}}` ↔ `control_response`. 공개 참조 구현은 [claude-agent-sdk-python `_internal/query.py`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py) | 공식 문서는 SDK API 를 설명하지 와이어를 설명하지 않는다 |
| 클라이언트→CLI 요청 (SDK 소스) | `initialize` · `interrupt` · `set_permission_mode` · `set_model` · `rewind_files` · `mcp_status` · `get_context_usage` · `mcp_reconnect` · `mcp_toggle` · `stop_task` | |
| CLI→클라이언트 요청 (SDK 소스) | `can_use_tool`(권한 — `--permission-prompt-tool stdio` 필요) · `hook_callback` · `mcp_message` | `can_use_tool` 응답 `{behavior:"allow"\|"deny", …}` |
| `initialize` 응답 | `commands` · `agents` · `models` · `account` · `current_permission_mode` · `remote_control_available` · `remote_control_auto_enable` · `session_state` · `capabilities` … | |
| **`remote_control` (비공개)** | `{"subtype":"remote_control","enabled":true,"name":"…"}` → **`session_url`** · `connect_url` · `bridge_session_id` · `bridge_epoch` 응답, 이어서 `system/bridge_state` ready → connected. `enabled:false` 로 정상 해제, 종료 0 | **SDK 공개 타입에 없다.** 바이너리 strings 에서 찾았다(헤드리스 `initReplBridge`). VS Code 확장의 `/rc` 경로로 추정 |
| 원격 → 로컬 왕복 | **미검증** — 두 번 열었다(5분 · 15분). 두 번 다 켜기 → connected → 끄기 → 종료 0 은 재현됐지만 그 사이 원격 입력이 없었다. 브라우저 자동화로 보내려던 시도는 claude.ai 재로그인 화면에 막혀 중단 (§6 R7) | P3 `rc-roundtrip` 의 완료 조건 |
| claude.ai 쪽 흔적 | 켤 때마다 claude.ai/code 세션 목록에 이름이 남는다 (스파이크가 "ocul-pm spike" · "ocul-pm spike 2" 를 만들었다) | 이름 규칙 + 끄기 보장 필요 (R5) |

### 2.3 같은 날 확인한 문서 사실

- Claude Code 훅: `PreToolUse` 결정 `allow`/`deny`/`ask`/`defer` + `updatedInput`, `PermissionRequest` 의 `decision.behavior`, `Notification` 의 `permission_prompt` · `agent_needs_input`, HTTP 훅(`type:"http"`), 기본 타임아웃 600초. ([hooks](https://code.claude.com/docs/en/hooks))
- Remote Control 은 **모바일 푸시**("Push when actions required")로 권한 요청을 폰에 보낸다 — 승인 전달 통로를 우리가 만들 필요가 없을 수 있다. ([remote-control](https://code.claude.com/docs/en/remote-control))
- Codex 훅: v0.114 부터 `PreToolUse` · `PermissionRequest` 가 Claude 와 같은 모양으로 있다 (서드파티 가이드 기준 — 공식 config reference 로 P1 에서 재확인). 스파이크에서는 `hook/started|completed` 이벤트로 훅 실행 자체만 확인했다.

---

## 3. 목표 / 비목표 {#goals}

**목표**

1. Claude Code · Codex 화면이 각 CLI 의 공식 클라이언트와 **같은 통로**를 쓴다 — 어댑터가 고른 부분집합이 아니라.
2. `/rc` 가 앱 화면에서 된다 (세션 URL · QR 표시).
3. 승인 대기가 **앱 재시작을 견딘다** — 대기 상태를 메모리가 아니라 디스크에 둔다.
4. 자동화 러너가 에이전트를 무인으로 돌릴 토대 (dots 류 구상, [`20260831_osaurus-bench/01-automation.md`](../20260831_osaurus-bench/01-automation.md) 의 러너 위).
5. 마지막에 Claude · Codex 경로에서 **Node 의존 제거**.

**비목표**

- 터미널 화면에만 사는 명령(`/login` · `/config` · `/mobile` …) 재현. 툴바의 「터미널에서 열기」를 유지한다.
- ACP 제거. 자체 프로토콜이 없는 에이전트(Gemini CLI 등)는 ACP 가 맞다.
- 채팅 화면 재설계. 이 라운드는 배관만 바꾼다.

---

## 4. 아키텍처 결정 (D1~D8) {#decisions}

### D1 — 화면의 계약은 그대로: `AcpEvent` + `acp_*` 커맨드 {#d1-contract}

프런트가 소비하는 것은 `acp/session.rs::AcpEvent`(답변 조각 · 생각 · 도구 호출 ·
권한 · 플랜 · 사용량 · 설정 변경 · 실패 …)와 `commands/acp.rs` 의 커맨드 19개다.
새 드라이버는 **같은 이벤트를 낸다**. 그러면 화면은 드라이버가 바뀐 줄 모른다.

이름(`Acp*` → `Agent*`)은 마지막 Phase 에서 기계적으로 바꾼다. 중간에 바꾸면
배관 변경과 이름 변경이 한 diff 에 섞여 리뷰가 안 된다.

새 능력(Codex 리뷰 · fork · goal, Claude `/rc`)은 이벤트 **추가**로만 들어간다 —
기존 변형의 의미는 바꾸지 않는다.

### D2 — 드라이버 trait 하나, 구현 셋 {#d2-trait}

```
trait AgentDriver
  start / stop                     프로세스 수명
  new_session / load_session       load 는 지난 대화를 AcpEvent 로 재생
  list_sessions / delete_session
  prompt / cancel
  respond_permission
  set_config_option                모드 · 모델
  commands / usage
  extension(kind, payload)         드라이버 고유 능력 (remote_control · review · fork …)

impl  AcpDriver           지금 코드 (process.rs + session.rs) — P0 에서 동작 변화 0 으로 옮긴다
impl  CodexAppServer      P1
impl  ClaudeStreamJson    P2
```

ACP 크레이트에 묶인 것은 `session.rs`(22곳) · `process.rs`(8) · `auth_status.rs`(4)
뿐이다. `journal_gate` · `segments` · `turn` · `identity` · `env` 는 ACP 를 모른다 —
**공용으로 남긴다.** 기록 신원(`recording.rs`)은 ACP UUID 자리를 드라이버의
대화 id 로 일반화한다.

### D3 — Codex = `codex app-server` (stdio JSON-RPC) {#d3-codex}

- 타입은 **최소 지원 버전에서 생성한 JSON 스키마**로 만든다. 생성물은 커밋하고 손으로 고치지 않는다 (`bindings.ts` 규약과 같다).
- **계약 테스트**: CI 와 앱 진단이 설치된 `codex` 로 스키마를 다시 생성해 우리가 쓰는 메서드·필드가 여전히 있는지 대조한다. 없어졌으면 해당 기능을 숨기고 진단에 적는다 — 조용히 깨지지 않게.
- 승인 3종 → `AcpEvent::Permission`. 선택지는 스키마의 결정 값(`accept` · `acceptForSession` · …)을 그대로 옮긴다.
- 세션 목록 · 재생 = `thread/list` · `thread/read` (+ `thread/turns/list`). ACP 의 `session/load` 재생과 같은 이벤트로 바꾼다.

### D4 — Claude = stream-json 제어 프로토콜 {#d4-claude}

- 기동: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio` (+ `--resume <id>`).
- 권한: `can_use_tool` → `AcpEvent::Permission`. 모드 · 모델: `set_permission_mode` · `set_model`.
- 세션 목록 · 재생: **이미 있는 트랜스크립트 리더**(`oculpm/transcript.rs` · `transcript_sessions.rs`)를 쓴다. 새 파서를 만들지 않는다.
- `/rc`: `remote_control` 제어 요청 → `session_url` 을 대화에 링크 · QR 로. **실패하거나 필드가 없으면 지금처럼 터미널로** (기능 감지 후 폴백).
- 와이어 형식의 참조 구현은 Python Agent SDK 소스다. 그 저장소의 변경을 계약 테스트로 따라간다.

### D5 — 바이너리는 사용자 PATH 의 것을 먼저 {#d5-binary}

목표 1("공식 클라이언트와 같은 통로")의 절반은 **같은 버전**이다. 터미널에서 되는
기능이 앱에서 안 되는 이유가 "앱은 딸려 온 옛 CLI 를 써서"여서는 안 된다.

- 순서: 사용자 PATH 의 `claude` / `codex` → (없으면) 지금의 딸려 온 바이너리(`adapter.rs::bundled_claude`).
- **최소 버전 게이트**: 그보다 낮으면 그 드라이버를 쓰지 않고 ACP 로 내려간다 + 진단에 적는다.
- 딸려 온 바이너리 폴백은 Node 제거(P5) 때 다시 판단한다.

### D8 — 버전은 고정하지 않고 감시한다 {#d8-drift-watch}

사용자 결정(2026-10-05): **"버전은 계속 업데이트해야 한다."** 지금의 ACP 경로는
그 반대다 — 어댑터를 고정하고 릴리스마다 손으로 올렸다(0.67 → 0.77 → 0.81,
codex-acp 1.8 → 1.13). 그 사이 사용자는 옛 CLI 를 쓴다.

D5 로 바이너리를 사용자 PATH 에서 가져오면 CLI 는 스스로 업데이트된다(Claude
Code 는 자동 업데이트). 우리 몫은 **따라가는 것이 아니라 깨졌을 때 먼저 아는 것**이다.

| 층 | 무엇 | 언제 |
|---|---|---|
| CI 드리프트 잡 `agent-cli-drift` (신설, 스케줄) | 최신 `claude` · `codex` 를 설치 → Codex 스키마 재생성 후 커밋본과 diff · Claude `initialize` 핸드셰이크와 제어 요청 응답 모양 대조 → 깨지면 이슈 | 매주 + 수동 실행 |
| 앱 진단 | 감지한 두 CLI 의 버전 · 최소 버전 게이트 결과 · 기능 감지 결과(`remote_control_available` 등) | 앱 시작 · 진단 화면 |
| 런타임 기능 감지 | 모르는 이벤트는 로그만 남기고 흘린다(acp-panel R2 의 방어적 파싱 그대로) · 없는 메서드는 그 기능을 숨긴다 | 매 연결 |

최소 버전은 **올리기만** 한다 — 드리프트 잡이 새 필드에 의존할 이유를 찾았을 때.
CI 에는 로그인이 없으므로 `remote_control` 처럼 계정이 필요한 것은 앱 쪽 기능 감지가
맡는다 (CI 에서 `initialize` 가 로그인 없이 응답하는지는 P0 에서 확인).

### D6 — 승인 대기는 디스크에 둔다 {#d6-durable-approval}

지금은 `acp/process.rs` 가 권한 요청을 `oneshot` 채널로 메모리에서 기다린다. 앱이
꺼지면 요청이 사라진다. 스파이크 §2.1 이 보인 것: **두 CLI 의 대화는 디스크에
남고, 끊긴 턴은 재개 후 다시 시도할 수 있다.**

- 권한 요청이 오면 SQLite 에 한 줄 (대화 · 도구 · 입력 요약 · 물은 시각 · 상태).
- 앱이 꺼지거나 드라이버가 죽으면 그 줄은 `interrupted` 로 남는다. 재시작 시 「승인을 기다리던 대화」로 보여 주고, 승인하면 **재개 + "승인됨, 진행" 턴**.
- 이 줄이 자동화 러너의 "에이전트 실행" 스텝(P4)이 기다리는 자리다. 러너는 승인을 기다리며 슬롯을 붙잡지 않는다 — 기록하고 비운다.
- Claude 쪽 재개(`--resume`)로 같은 동작이 되는지는 P2 에서 검증한다 (Codex 만 실측됨).

### D7 — ACP 는 드라이버 하나로 남고, 한 릴리스 동안 되돌림 스위치 {#d7-acp-stays}

- 공급자별 드라이버 선택: 기본 네이티브, 설정에서 ACP 로 되돌림. 기본값 전환 후 **한 릴리스** 동안 유지하고, 회귀가 없으면 Claude · Codex 의 ACP 경로를 걷는다.
- Gemini CLI 등은 계속 ACP.

---

## 5. Phase 분해 {#phases}

| Phase | 내용 | 끝났다는 증거 |
|---|---|---|
| **P0** | `AgentDriver` trait 추출, 지금 코드를 `AcpDriver` 로 이동 (동작 변화 0). 드라이버 계약 테스트 하네스 · 드리프트 잡 `agent-cli-drift` · 앱 진단의 버전 게이트 (D8) | 기존 ACP 테스트 전부 초록, 화면 변화 0, 드리프트 잡 첫 실행 초록 |
| **P1** | `CodexAppServer` 드라이버 — 스키마 생성 타입 · 승인 3종 · 목록/재생 · 사용량/한도 | 앱에서 Codex 대화 · 승인 · 재시작 후 재개. 계약 테스트 CI |
| **P1b** | Codex 고유 능력을 화면에 — `review/start` · `thread/fork` · `turn/diff/updated` | 이벤트 추가만, 기존 변형 불변 |
| **P2** | `ClaudeStreamJson` 드라이버 — `can_use_tool` · 모드/모델 · 트랜스크립트 재생 · `--resume` | 앱에서 Claude 대화 · 승인 · 재개. **Claude 재개 후 재시도 실측** (D6 의 미검증분) |
| **P3** | `/rc` — `remote_control` 요청 · URL/QR 표시 · 끄기 · 실패 시 터미널 폴백 | **원격 → 로컬 왕복 실측** (R7) |
| **P4** | 승인 대기 영속 (D6) + 자동화 러너의 "에이전트 실행" 스텝 + 위험 등급 정책(읽기 자동 · 쓰기 대기 · 외부 거부) | 무인 실행 중 앱 재시작 → 승인 → 완료, 일지에 결정 기록 |
| **P5** | 기본값 전환 · ACP 되돌림 스위치 1릴리스 · `Acp*` → `Agent*` 이름 정리 · Node 의존 제거 판단 | 한 릴리스 회귀 0 |

P1 을 P2 보다 먼저 하는 이유: Codex 쪽은 **문서와 생성 스키마**가 있고 Claude 쪽은
참조 구현(SDK 소스)뿐이다. 위험이 낮은 쪽으로 trait 모양을 먼저 굳힌다.

---

## 6. 리스크 {#risks}

| | 리스크 | 대응 |
|---|---|---|
| **R1** | `codex app-server` 는 공식 experimental | 생성 스키마 + 계약 테스트(D3). 깨지면 기능 숨김 + ACP 되돌림(D7) |
| **R2** | `remote_control` 은 비공개 — 예고 없이 바뀌거나 사라질 수 있다 | 기능 감지(`initialize` 의 `remote_control_available`) + 실패 시 터미널 폴백(D4). 문서화 요청은 별도로 |
| **R3** | stream-json 제어 프로토콜의 공식 문서가 없다 | 참조 구현(Python SDK) 추적 + 최소 버전 게이트(D5) |
| **R4** | 사용자 PATH 바이너리 버전이 제각각 | 최소 버전 게이트 + 진단 표시. 낮으면 ACP 로 |
| **R5** | `/rc` 를 켤 때마다 claude.ai 세션 목록에 흔적이 남는다 | 이름 규칙(프로젝트명) · 대화 종료 시 확실히 끄기 · 사용자가 명시적으로 켤 때만 |
| **R6** | Windows — stdio 는 같지만 Codex 샌드박스 구현이 다르다 (`windowsSandbox/*`) | portability CI 에 드라이버 계약 테스트 동승 |
| **R7** | **원격 → 로컬 메시지 왕복 미검증** (§2.2) | P3 의 완료 조건. 안 되면 `/rc` 는 "URL 표시 + 터미널에서 이어받기"로 축소 |
| **R8** | `--permission-prompt-tool stdio` 와 사용자 설정의 권한 규칙 · 훅이 겹치는 순서 | P2 에서 실측해 이 문서 §2 에 추가 |

---

## 7. 결정 (2026-10-05) {#decided}

| # | 질문 | 결정 | 누가 |
|---|---|---|---|
| 1 | 바이너리 기본값 (D5) | **사용자 PATH 우선** — "버전은 계속 업데이트해야 한다". 고정 대신 감시(D8) | 사용자 |
| 2 | ACP 되돌림 스위치 유지 기간 (D7) | 한 릴리스 | 사용자 위임 → 제안안 채택 |
| 3 | `/rc` 노출 방식 (R5) | 명령으로만 켠다. 기본 켜기 없음 | 사용자 위임 → 제안안 채택 |
| 4 | 플랜으로 만들지 | 만든다 — §5 를 그대로 | 사용자 위임 → 제안안 채택 |

2~4 는 사용자가 "모르겠다"며 맡긴 것이다. 구현 중 뒤집혀도 되는 결정이고, 뒤집으면
이 표에 정정 줄을 단다.
