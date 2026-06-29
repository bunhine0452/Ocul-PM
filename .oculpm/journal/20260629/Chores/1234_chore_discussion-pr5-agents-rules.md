---
schema_version: 1
type: chore
slug: discussion-pr5-agents-rules
status: done
difficulty: low
created_at: "2026-06-29T12:34:31+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/agents/templates/master_ko.md.tpl
    op: update
  - path: src-tauri/src/oculpm/agents/mod.rs
    op: update
  - path: AGENTS.md
    op: update
related:
  - ./../Features_to_add/1234_feature_discussion-pr4-promote-today.md
tags: ["discussion-feature", "PR-DISC-5", "agents"]
---

[x] 문제 해결(Discussion) PR-DISC 5 — AGENTS.md "문제 해결 문서" 규칙

## 변경 요약

외부 에이전트(터미널 Claude Code 등)가 discussion 문서를 직접 작성할 수 있도록 규칙을 마스터 템플릿에 추가.

- `master_ko.md.tpl` §8 "문제 해결 문서" 신설: 언제(요청 기반·매 작업 아님)·어떻게(frontmatter + 문제정의 우선 + 후보안 `{#id}` + 토의로그 managed block append + 결론/다음단계)·금지(진척추적·실행로그·resolved 수정·secrets). `template_version` 3→4.
- 에이전트별 템플릿(claude_code/gemini/cursor/antigravity)은 thin(@AGENTS.md 상속)이라 무변경 — drift 파이프라인이 같은 managed block 자동 커버.
- 레포 자신의 `AGENTS.md` 도 동일 §8 + version 4 로 동기화(도그푸딩).
- 가드 테스트 `master_template_carries_discussion_rules`(섹션·discussion-log·.oculpm/discussion/·version≥4).

## 검증

`cargo test` 전체 lib 312 green(신규 가드 테스트 포함). 기존 agents drift/sync 테스트 무회귀.
