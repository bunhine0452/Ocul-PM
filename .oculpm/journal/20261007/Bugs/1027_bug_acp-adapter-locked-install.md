---
schema_version: 1
type: bug
slug: "acp-adapter-locked-install"
status: done
difficulty: medium
created_at: "2026-10-07T10:27:44+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/acp-lock/claude/package.json"
    op: create
  - path: "src-tauri/acp-lock/claude/package-lock.json"
    op: create
  - path: "src-tauri/acp-lock/codex/package.json"
    op: create
  - path: "src-tauri/acp-lock/codex/package-lock.json"
    op: create
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
related:
  - ref: "20261007/Bugs/0947_bug_redaction-floor-and-input-masking.md"
    kind: "followup"
tags:
  - "security"
  - "acp"
  - "external-review"
  - "mcp-tool"
---
[x] ACP 어댑터 설치가 하위 의존성을 고정하지 않았다 — 고정 lockfile + npm ci

## 발생 원인

외부 보안 피드백 #5. Claude Code 화면이 어댑터가 없으면 묻지 않고 `npm install --no-audit --no-fund --prefix <app_data>/acp @agentclientprotocol/claude-agent-acp@0.81.0` 을 돌렸다(`commands/acp.rs` acp_start). 어댑터 버전만 고정이라 범위로 적힌 하위 의존성(112개)은 설치하는 순간의 최신이 들어왔고, `--ignore-scripts` 도 없었다. 하위 패키지 하나가 탈취되면 그대로 받아 실행하는 구조였다.

## 해결 방법

- `acp-lock/{claude,codex}/` 에 package.json + package-lock.json(v3)을 두고 `include_str!` 로 바이너리에 싣는다. 설치는 그 둘을 prefix 에 쓰고 `npm ci --ignore-scripts --no-audit --no-fund --prefix …`. lockfile 생성은 `npm install --package-lock-only --ignore-scripts`(메타데이터만, 실행 없음).
- 실측: claude 트리 112·codex 24 패키지 전부 레지스트리 URL + sha512, 설치 스크립트 0(`prepare` 만 — 레지스트리 의존성엔 안 돈다), 모든 플랫폼 바이너리 항목 포함. 스크래치에서 `npm ci --prefix` 가 진입점까지 깔리는 것과, integrity 한 칸을 바꾼 lockfile 이 `EINTEGRITY` 로 실패하는 것을 확인했다.
- Codex 는 형제 prefix `acp-codex/` 로 옮겼다 — `npm ci` 는 prefix 의 node_modules 를 통째로 갈아엎으므로 한 자리에 두면 Claude 를 깔 때 Codex 가 사라진다. 옛 판이 `acp/` 에 깐 Codex 는 새 자리가 빌 동안 그대로 쓴다(`codex_prefix`).
- `the_locked_trees_pin_every_package` 가 상수 버전·URL·sha512·스크립트 없음을 지킨다. egress 원장 호스트 표에 `registry.npmjs.org` 를 사유와 함께 올렸다.
- 그대로 둔 것: Claude 어댑터의 "없으면 묻지 않고 설치" 결정(사용자가 Claude 화면을 연 것이 곧 시작이라는 기존 판단). 설치 내용이 이제 고정·검증되므로 묻는 단계는 더하지 않았다.

## 검증

- adapter 테스트 3 추가(Codex 새 자리·옛 자리 이어 쓰기·lockfile 계약). ACP 98 통과, 전체 Rust 1983 통과, clippy 0, 파일 크기 게이트 통과.
- 남은 공백(원장 기록): egress 원장의 자리 스캔은 하위 프로세스(npm)의 송출을 세지 못하고, CLAUDE.md 의 송출 목록에도 어댑터 다운로드가 없다 — 플랜 후속 항목.