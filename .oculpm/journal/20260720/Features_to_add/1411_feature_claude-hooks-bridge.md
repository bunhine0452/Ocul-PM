---
schema_version: 1
type: feature
slug: claude-hooks-bridge
status: done
difficulty: high
created_at: "2026-07-20T14:11:28+09:00"
session_id: "manual-20260720-141128"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/claude_hooks.rs
    op: create
  - path: src-tauri/src/commands/claude_hooks.rs
    op: create
  - path: src-tauri/migrations/026_claude_hooks_inbox.sql
    op: create
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/oculpm/session.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/__tests__/claude_hooks_settings.test.tsx
    op: create
  - path: docs/claude-integration/01-hook-payload-actual.md
    op: create
related: []
tags: ["claude-integration", "PR-CI0", "hooks", "session", "watcher", "settings"]
---

[x] PR-CI0 — Claude Code 훅 브리지 (세션 감지 결정론화)

## 추가 기능

일지·세션 감지가 파일와처 휴리스틱과 AGENTS.md 프롬프트 준수에 의존하던 것을, Claude Code
공식 hooks 로 결정론화하는 첫 트랙 (docs/claude-integration/00-master-plan.md D1·D2).

- **실측 스파이크**: 스크래치 프로젝트 + `claude -p` 헤드리스 3회로 훅 payload 실측
  (01-hook-payload-actual.md). 핵심 확인 — 4개 이벤트 전부 `session_id`/`transcript_path`/`cwd`
  포함, `settings.local.json` 훅도 발화, payload 에 타임스탬프 없음(소비측 스탬프 필요),
  `Stop.last_assistant_message` 존재(PR-CI1 폴백 요약 소스).
- **설치기** (`oculpm/claude_hooks.rs`): `.claude/settings.local.json` 에 SessionStart/Stop/
  SessionEnd 훅(로컬 `cat` append 한 줄) 멱등 설치·제거. 우리 엔트리는 command 의
  `.oculpm/hooks/` 경로 서명으로 식별 — 사용자 훅·미지 키 보존, **파싱 실패 파일은 절대
  덮어쓰지 않음**. 드리프트(부분 설치) 상태 보고.
- **인박스**: 훅이 `.oculpm/hooks/claude-events.jsonl` 에 append → watcher 신규 1.5 라우팅이
  소비 (ndjson/일지 파이프라인 격리). 완전 라인만 파싱(append 중 부분 라인 유예), 깨진 라인
  스킵, 소비 오프셋은 SQLite `claude_hooks_inbox`(026) 영속 — 앱 꺼진 동안 큐잉된 이벤트를
  watcher 시작 시 1회 능동 소비로 처리. truncate 안 함(동시 append 경합 방지).
- **SessionActor 정밀 신호**: `HookAgentActive`(세션 보장+실측 라벨 `claude-code`+inactivity
  리셋) / `HookAgentEnded`(신규 `EndedReason::AgentExit` 로 즉시 종료). 다중 터미널 동시
  세션은 열린-세션 집합으로 마지막 SessionEnd 에서만 종료. 휴리스틱과 병존(훅 신호 우선).
- **설정 UI**: Agents 섹션에 "Claude Code 훅 연동" 블록 — 켜기/끄기/재설치, 상태 배지
  (연동됨/드리프트/꺼짐/설정 파일 오류), 로컬 전용·무네트워크 고지.
- **경계**: `.oculpm/hooks/` gitignore 관리 블록 추가(대화 내용 포함 payload — 머신 로컬
  전용), 00-spec.md §1.2 트리 갱신.

## 동작 흐름

Claude Code 세션 → 훅 stdin JSON 을 인박스에 append → watcher 가 fs 이벤트로(또는 시작 시
1회) 오프셋부터 소비 → 열린-세션 집합 반영 → SessionActor 에 AgentActive/AgentEnded →
세션 시작·라벨·정밀 종료(sessions.json/SQLite upsert). 우리 쪽 쓰기는 DB 뿐 — fs 피드백
루프 없음.

## 검증

- `cargo test` 333 그린 — 신규: claude_hooks 7(설치 왕복/외부 콘텐츠 보존/깨진 JSON 불변/
  드리프트/부분 라인/오염 라인/동시 세션 집합) + session 2(훅 개시·라벨·AgentExit 종료,
  휴리스틱 선종료 후 훅 no-op). bindings.ts 재생성 (specta u64 금지 → inbox_bytes u32).
- `pnpm typecheck` / `test`(139, 신규 6 — 토글 계약·드리프트 재설치·오류 시 설치 차단·a11y) /
  `lint` / `build` 전부 exit 0.
- **E2E(훅 측)**: `install()` 이 쓰는 프로덕션 커맨드 그대로 스크래치 프로젝트에 설치 후
  실세션(`claude -p`) — SessionStart/Stop/SessionEnd 3건이 `.oculpm/hooks/claude-events.jsonl`
  에 정확 적재 확인. 인박스→세션 반영은 단위 테스트로 커버, **실기기(앱 구동) 세션 정확성
  확인은 플래너 #ci0-runtime-verify 로 남김**.

## 메모

- 발견: `src-tauri/migrations/025_fts.sql` 이 디스크에 있으나 MIGRATIONS 배열 미등록 (v2 U11
  잔재로 추정 — 이번 PR 범위 밖, 번호 25 는 비워 두고 26 사용).
- payload 에 시각이 없어 큐잉 이벤트의 정밀 시각은 유실 — transcript `timestamp`(PR-CI1)로
  보강 예정.
