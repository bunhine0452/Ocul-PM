---
schema_version: 1
type: chore
slug: dead-settings-honesty-cleanup
status: done
difficulty: low
created_at: "2026-07-16T21:45:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/settings.ts
    op: update
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/features/terminal/TerminalScreenV2.tsx
    op: update
related:
  - journal/20260716/Refactors/2143_refactor_ai-chat-unification.md
tags: ["settings", "dead-code", "honesty", "audit-fix"]
---

[x] 죽은 설정·거짓 표시 정리 — streamResponses/logLevel 제거 + 터미널 감시 표시 진실화

## 변경 요약

감사 MEDIUM #4 / LOW #7·#8·#10 일괄:
- **streamResponses 제거** — 유일 소비자(ChatPanel)가 은퇴하면서 완전 무효가 된
  "응답 스트리밍" 토글과 설정 키를 제거 (메인 AI 패널은 항상 스트리밍이 정답).
- **logLevel 제거** — 소비자 0 인 유령 키 (LogLevel 타입 포함).
- **Save 재수출 제거** — importer 0 인 "호환용" export.
- **터미널 감시 표시 진실화** — 상시 초록 하드코딩이던 "변경 감시중" 칩/점을
  실제 `oculpmStatus.watcher_state` 에 연결: running=초록 "변경 감시중" /
  error=빨강 "감시 오류" / stopped·null=회색 "감시 꺼짐".

## 검증

- typecheck / test(133) / lint / build exit 0. SQLite 의 기존 stream_responses/
  log_level 행은 읽히지 않을 뿐 그대로 (파괴 없음).
