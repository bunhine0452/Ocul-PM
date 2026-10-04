---
schema_version: 1
type: chore
slug: "native-agent-drivers-design"
status: done
difficulty: medium
created_at: "2026-10-05T02:04:50+09:00"
session_id: "20261005-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20261005_native-agent-drivers/00-master-plan.md"
    op: create
  - path: "docs/20261005_native-agent-drivers/spike/codex_app_server_spike.py"
    op: create
  - path: "docs/20261005_native-agent-drivers/spike/claude_remote_control_spike.py"
    op: create
  - path: "docs/README.md"
    op: update
related:
  - ref: "20261005/Chores/0155_chore_native-agent-protocol-spikes.md"
    kind: "followup"
tags:
  - "acp"
  - "codex"
  - "claude-code"
  - "docs"
  - "mcp-tool"
---
[x] 네이티브 에이전트 드라이버 설계 문서 — Claude stream-json · codex app-server 로 ACP 대체 (D1~D7 · P0~P5)

## 무엇을 했나

직전 스파이크(codex app-server 승인·재개, 헤드리스 claude `remote_control`) 결과를 설계로 굳혔다. `docs/20261005_native-agent-drivers/00-master-plan.md` 신설, `docs/README.md` 「살아 있는 설계」 표에 한 줄. 스파이크 스크립트 2개는 `spike/` 에 재현용으로 넣되 작업 폴더·로그를 `tempfile.mkdtemp` 로 옮겨 저장소를 더럽히지 않게 고쳤다(`SPIKE_WORK` 로 지정 가능).

## 핵심 결정

- **acp-panel §1 의 C 안(Agent SDK 직접) 기각 사유 = 사이드카(Node/Python) 비용**. 이번 안은 SDK 를 안 쓰고 Rust 가 CLI 와 직접 말하므로 그 사유가 성립하지 않는다. 프로토콜 중립성은 ACP 드라이버를 남겨 유지.
- D1 화면 계약(`AcpEvent` + `acp_*` 19개 커맨드) 불변 — 프런트 ~7.6k 줄 무변경이 목표, 이름 정리는 마지막.
- D2 `AgentDriver` trait: ACP 크레이트 결합은 `session.rs`(22) · `process.rs`(8) · `auth_status.rs`(4) 뿐, `journal_gate`·`segments`·`turn`·`identity`·`env` 는 공용 유지.
- D3 Codex: 생성 스키마 커밋 + 설치본 재생성 대조 계약 테스트. D4 Claude: `--permission-prompt-tool stdio` 의 `can_use_tool`, 세션 목록·재생은 기존 `transcript.rs` 재사용, `/rc` 는 기능 감지 후 터미널 폴백.
- D5 바이너리는 사용자 PATH 우선(딸려 온 CLI ≠ 터미널 CLI 문제), 최소 버전 게이트. D6 승인 대기 SQLite 영속 → 자동화 러너 무인 실행 토대. D7 ACP 되돌림 스위치 1릴리스.
- Phase: P0 trait 추출(동작 변화 0) → P1 Codex(문서·스키마가 있어 위험 낮은 쪽 먼저) → P2 Claude → P3 `/rc` → P4 승인 영속+자동화 → P5 기본값 전환·Node 제거 판단.

## 미결

- **원격→로컬 왕복(R7) 재시험 진행 중** — 브라우저 자동화로 메시지를 보내려다 claude.ai 가 재로그인 페이지로 튀어 중단(시험 문장이 로그인 페이지에 입력됨, 인증 정보는 입력 안 함). 사용자에게 직접 전송을 요청해 둠.
- 사용자 결정 4건(문서 §7): 바이너리 기본값 · 되돌림 기간 · `/rc` 노출 · 플랜 생성 여부. 플랜은 승인 전이라 만들지 않았다.

## 검증

- 문서의 수치(커맨드 19 · 서버 요청 10 · 결합 카운트)는 이 세션에서 grep/스키마로 재확인한 값.
- `python3 -m py_compile` 로 스파이크 2개 문법 확인. 커밋 안 함.