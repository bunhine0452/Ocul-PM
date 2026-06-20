---
schema_version: 1
type: feature
slug: journal-agent-model-info
status: done
difficulty: medium
created_at: "2026-06-20T22:30:00+09:00"
updated_at: "2026-06-20T22:30:00+09:00"
session_id: "20260620-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/migrations/021_oculpm_agent_version.sql
    op: create
    bytes_added: 467
    bytes_removed: 0
  - path: src-tauri/src/oculpm/spec.rs
    op: update
    bytes_added: 340
    bytes_removed: 78
  - path: src-tauri/src/oculpm/cache.rs
    op: update
    bytes_added: 873
    bytes_removed: 541
  - path: src-tauri/src/db.rs
    op: update
    bytes_added: 69
    bytes_removed: 0
  - path: src/features/today/agentColor.ts
    op: update
    bytes_added: 368
    bytes_removed: 0
  - path: src/features/oculpm/JournalCardV2.tsx
    op: update
    bytes_added: 156
    bytes_removed: 117
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
    bytes_added: 156
    bytes_removed: 117
  - path: AGENTS.md
    op: update
    bytes_added: 409
    bytes_removed: 303
  - path: src-tauri/src/oculpm/agents/templates/master_ko.md.tpl
    op: update
    bytes_added: 409
    bytes_removed: 303
  - path: src/lib/bindings.ts
    op: update
    bytes_added: 1329
    bytes_removed: 242
related: []
tags: ["oculpm", "journal", "agent", "antigravity", "pi", "dogfooding-finding"]
---

[x] 작업 일지에 작성 에이전트의 모델 정보 표시 (Claude Code · Opus 4.8) + pi 에이전트 인지

## 추가 기능

- 작업 일지 카드/상세에 에이전트 이름 옆에 **모델명**을 함께 표시한다. 예: `Claude Code · Opus 4.8`, `Antigravity · Gemini 3 Pro`. frontmatter `agent.version` 에 적힌 모델명을 그대로 보여준다.
- `agent.version` (모델명) 을 SQLite 캐시까지 끌어와 목록(JournalEntrySummary)에서도 보이게 했다. 기존엔 디스크 frontmatter 에만 있고 캐시·UI 엔 없었다.
- AGENTS.md 템플릿(`agent.version`) 의 의미를 "선택 버전" → "**돌고 있는 모델명** (예: Opus 4.8 / Gemini 3 Pro / GPT-5)" 으로 명확히 하고, 외부 LLM 이 채우도록 유도. `template_version` 2→3.
- 에이전트 id enum 에 `pi` (earendil-works/pi 코딩 에이전트) 추가 — 라벨맵·색·AGENTS.md·spec 주석. **antigravity / pi 모두 별도 통합 코드 없이 AGENTS.md 만으로 지원됨**을 웹 리서치로 확인(둘 다 프로젝트 루트 AGENTS.md 를 읽음). 별도 패키지 불필요.

## 동작 흐름

1. 외부 LLM 이 일지를 쓸 때 AGENTS.md §3 지시에 따라 `agent.version` 에 모델명을 적는다.
2. 인덱서가 frontmatter 를 파싱 → `CacheRowSnapshot.agent_version` → `oculpm_journal.agent_version` 컬럼(마이그레이션 021)에 저장.
3. 목록 쿼리(`build_list_sql`)·단일 조회·`summary_from_row` 가 `agent_version` 을 함께 읽어 `JournalEntrySummary.agent_version` 으로 전달.
4. 프런트엔드 `agentLabelWithModel(id, version)` 가 `라벨 · 모델` 로 합성해 카드/상세에 렌더. 모델이 없으면 라벨만.

## 검증

- `cargo test` (src-tauri) 289 passed / 0 failed — 마이그레이션 021 미등록으로 40개 실패했던 것을 `db.rs::MIGRATIONS` 에 (21, …) 추가해 해결.
- `pnpm typecheck` / `pnpm test`(125 passed) / `pnpm lint` / `pnpm build` 전부 exit 0.
- `tauri-specta` 가 `bindings.ts` 재생성 → `JournalEntrySummary.agent_version` 확인.

## 메모

- `bindings.ts` 는 자동 생성 파일이라 손대지 않음(cargo test 가 재생성). diff 에 함께 잡혀 files_touched 에 기록.
- antigravity 는 v1.20.3(2026-03)부터 AGENTS.md 네이티브 지원. pi 는 AGENTS.md/CLAUDE.md 를 프로젝트 지침으로 읽음.
