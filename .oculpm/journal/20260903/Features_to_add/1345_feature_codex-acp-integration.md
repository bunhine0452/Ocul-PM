---
schema_version: 1
type: feature
slug: codex-acp-integration
status: done
created_at: 2026-09-03T13:45:58+09:00
session_id: "manual-20260903-134558"
agent:
  id: codex
  version: gpt-5
language: ko
verified_by_user: false
files_touched:
  - { path: src-tauri/src/acp/adapter.rs, op: update }
  - { path: src-tauri/src/acp/mod.rs, op: update }
  - { path: src-tauri/src/acp/process.rs, op: update }
  - { path: src-tauri/src/acp/session.rs, op: update }
  - { path: src-tauri/src/commands/acp.rs, op: update }
  - { path: src-tauri/tests/acp_handshake.rs, op: update }
  - { path: src/components/Sidebar.tsx, op: update }
  - { path: src/contexts/WorkspaceContext.tsx, op: update }
  - { path: src/features/chat/AcpConversation.tsx, op: update }
  - { path: src/features/chat/AcpUsageMeter.tsx, op: update }
  - { path: src/features/chat/acpBusyBus.ts, op: update }
  - { path: src/features/chat/CodexScreenV2.tsx, op: create }
  - { path: src/features/settings/OculpmSettings.tsx, op: update }
  - { path: src/features/settings/tabs/DoctorSection.tsx, op: update }
  - { path: src/features/shell/ShellV2.tsx, op: update }
  - { path: src/features/terminal/terminalLaunch.ts, op: update }
  - { path: src/i18n/en.ts, op: update }
  - { path: src/i18n/ko.ts, op: update }
  - { path: src/lib/bindings.ts, op: update }
  - { path: src/lib/navRegistry.ts, op: update }
  - { path: src/__tests__/acp_conversation_seams.test.tsx, op: update }
  - { path: src/__tests__/acp_parallel_sessions.test.tsx, op: update }
  - { path: src/__tests__/nav_registry.test.ts, op: update }
related: []
tags: [acp, codex, agent]
difficulty: high
---
[x] Codex ACP 기본 작업 경로 통합

## 추가 기능

공식 `@agentclientprotocol/codex-acp@1.8.0`을 앱 데이터 디렉터리에 고정 설치하고, Codex를 별도 내비게이션과 공통 ACP 대화 화면에서 실행하도록 연결했다. provider와 project의 복합 키로 프로세스·세션·이벤트·사용량·권한 상태를 분리했으며 Claude 호출은 provider 생략 시 기존 동작을 유지한다.

설정 화면에는 Codex 어댑터 버전과 손상 여부, `CODEX_HOME/auth.json` 또는 `OPENAI_API_KEY` 존재 여부만 확인하는 비밀값 비노출 진단을 추가했다. Codex 탭·이름·마지막 세션·busy/attention 배지도 Claude와 독립적으로 저장·표시한다.

## 동작 흐름

Codex 화면 진입 → 필요 시 고정 버전 어댑터 설치 → ACP initialize → 프로젝트 루트를 cwd로 새 세션 생성 → 기존 대화 컴포넌트에서 prompt/stream/config/cancel/list/load/delete/permission 흐름을 provider별 상태로 라우팅한다. Codex는 Claude 전용 `/usage`와 `/remote-control` 경로를 사용하지 않는다.

## 검증

`cargo fmt --check`, ACP Rust 테스트 46개, `pnpm typecheck`, lint, production build, 전체 Vitest 159파일 2,072개를 통과했다. 임시 설치 경로에서 Codex ACP 1.8.0을 실제 설치해 initialize·새 세션·프롬프트 end_turn까지 확인했다. 전체 Rust 스위트는 기존 watcher/PTY 환경 의존 실패 및 장기 실행 테스트 때문에 별도 통과하지 못했다.

## 메모

EVALS.md가 없어 oculpm run-evals 기록은 생성하지 않았다. 실제 도구 승인·파일 변경·세션 load를 한 흐름으로 수행하는 수동 smoke와 전체 Rust 환경 실패 정리는 플래너에 남긴다.
