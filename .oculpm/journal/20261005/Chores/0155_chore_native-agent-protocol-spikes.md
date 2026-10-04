---
schema_version: 1
type: chore
slug: "native-agent-protocol-spikes"
status: done
difficulty: medium
created_at: "2026-10-05T01:55:52+09:00"
session_id: "20261005-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "acp"
  - "codex"
  - "claude-code"
  - "research"
  - "mcp-tool"
---
[x] ACP 대신 네이티브 통로 스파이크 — codex app-server 승인·재개, 헤드리스 claude 의 remote_control 제어 요청

## 배경

사용자가 ACP 경유로는 Claude Code·Codex 의 네이티브 기능(`/rc` 등)이 안 된다며 회의적. 지금 경로는 `ocul-pm ─ACP→ claude-agent-acp(Node) → Agent SDK → claude` / `─ACP→ codex-acp → codex` 로, 어댑터가 노출하기로 한 것만 받는다. ChatGPT dots 류 상시 에이전트 구상(자동화가 에이전트를 무인 실행)의 전제 확인도 겸했다. 저장소 코드 변경 없음 — scratchpad 독립 스크립트로만 시험.

## 스파이크 1 — `codex app-server` (codex-cli 0.155.1)

- `codex app-server generate-json-schema` 로 설치 버전 그대로의 스키마 생성(클라이언트 메서드 102 · 알림 82). 승인 요청 서버→클라이언트 메서드: `item/commandExecution/requestApproval` · `item/fileChange/requestApproval` · `item/permissions/requestApproval` (응답 `{decision: accept|acceptForSession|…}`).
- Python 최소 클라이언트로 `initialize`(experimentalApi) → `thread/start{approvalPolicy:untrusted, sandbox:read-only}` → `turn/start`. 승인 요청 수신 시 스레드 상태 `activeFlags:["waitingOnApproval"]`.
- **승인 대기 중 프로세스 kill → 새 app-server 에서 `thread/resume`**: 직전 turn 은 `interrupted`, 스레드는 `idle` 로 복구. 같은 스레드에 "승인됨, 진행" turn → 승인 요청 재수신 → `accept` → 명령 실행 → `DONE` → 파일 생성 확인. 전 과정 17초.
- 덤: `review/start` · `thread/compact/start` · `thread/fork` · `thread/goal/*` · `turn/diff/updated` · `hook/started|completed` · `remoteControl/status/changed` 가 전부 이 프로토콜에 있다(ACP 어댑터로는 안 보이던 것들).

## 스파이크 2 — 헤드리스 claude 의 `remote_control` 제어 요청 (Claude Code 2.1.289)

- 바이너리 strings 에서 SDK 공개 타입에 없는 제어 요청 `subtype:"remote_control"` 처리기(헤드리스 `initReplBridge`) 발견 — VS Code 확장의 `/rc` 경로로 추정.
- `claude -p --input-format stream-json --output-format stream-json --verbose` (CLAUDECODE·CLAUDE_CODE_* 환경 제거) 에 `initialize` → `{"subtype":"remote_control","enabled":true,"name":"…"}` 전송.
- **응답에 `session_url`·`bridge_session_id`·`bridge_epoch` 가 그대로 왔다**, 이어서 `system/bridge_state` ready→connected. `enabled:false` 로 정상 해제, 종료 코드 0. initialize 응답에도 `remote_control_available`·`remote_control_auto_enable` 필드가 있다.
- 2026-08-15 의 ACP extraArgs `--remote-control` 시도(짝짓기 안내가 어디에도 안 나옴, `useAcpSend.ts`)와 달리, stream-json 직결이면 URL 을 받아 우리 UI 에 그릴 수 있다.

## 결론과 남은 것

- 네이티브 통로(Codex=app-server, Claude=stream-json 제어 프로토콜) 직결이 기술적으로 성립. ACP 는 자체 프로토콜 없는 에이전트용으로 남기는 방향 제안.
- 위험: app-server 는 공식 experimental, `remote_control` 은 비공개 — 버전 계약 테스트(스키마 생성·제어 요청 왕복)로 감시 필요.
- **미검증**: 원격(폰·브라우저)에서 보낸 메시지가 헤드리스 프로세스 stdout 의 user 메시지로 들어오는지 — 5분 창 동안 원격 입력이 없어 확인 못 함. 설계 착수 전 재시험.

## 검증

- Codex: events.log 에 SERVER_REQUEST(requestApproval) → PHASE_A_KILLED → thread/resume(turn interrupted) → APPROVED → turn/completed(completed) → FILE_EXISTS true.
- Claude: RC_ENABLE_RESPONSE 에 session_url 수신, bridge_state connected, RC_DISABLE success, EXIT 0. 두 작업 폴더 모두 부수 파일 없음.