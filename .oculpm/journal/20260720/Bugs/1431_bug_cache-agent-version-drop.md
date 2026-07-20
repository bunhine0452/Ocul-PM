---
schema_version: 1
type: bug
slug: cache-agent-version-drop
status: done
difficulty: low
created_at: "2026-07-20T14:31:10+09:00"
session_id: "manual-20260720-143042"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/cache.rs
    op: update
related:
  - 20260720/Features_to_add/1430_feature_claude-transcript-journal-draft.md
tags: ["cache", "agent-version", "latent-bug", "claude-integration"]
---

[x] 캐시 하이드레이션이 frontmatter agent.version 을 버리던 잠복 버그

## 발생 원인

`get_entry` 의 행→`JournalFrontmatter` 재구성(cache.rs)이 `AgentRef.version: None` 을
하드코딩하고 있었다. 021 마이그레이션부터 `oculpm_journal.agent_version` 컬럼이 존재하고
업서트는 값을 저장하는데, 단건 조회 SELECT 가 컬럼을 아예 안 가져와 하이드레이션에서
소실됐다. 목록 요약 경로는 별도 컬럼을 직접 읽어 UI "라벨·모델" 표시는 정상 → 그동안
발견되지 않음. PR-CI1 의 agent 오버라이드 테스트(작성 직후 재조회 검증)가 잡아냈다.

## 해결 방법

`EntryRow` 에 `agent_version` 필드 추가, `get_entry` SELECT 에 컬럼 추가(꼬리에 append —
기존 인덱스 불변), 하이드레이션이 `version: r.agent_version` 으로 복원.

## 검증

`create_manual_entry_honours_agent_override` 테스트가 작성→단건 재조회에서 version 보존을
단언 (수정 전 실패 → 수정 후 그린). `cargo test` 344 전체 그린.
