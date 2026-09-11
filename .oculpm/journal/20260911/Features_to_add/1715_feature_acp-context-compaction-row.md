---
schema_version: 1
type: feature
slug: "acp-context-compaction-row"
status: done
difficulty: medium
created_at: "2026-09-11T17:15:54+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/tool_meta.rs"
    op: create
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/chat/compaction.ts"
    op: create
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/activity/presenters.tsx"
    op: update
  - path: "src/features/chat/conversation/TraceRow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/acp_compaction.test.ts"
    op: create
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20260906/Features_to_add/1025_feature_acp-adapter-0751-usage-markdown.md"
    kind: "followup"
tags:
  - "acp"
  - "compaction"
  - "adapter-meta"
  - "activity"
  - "mcp-tool"
---
[x] 컨텍스트 압축을 제 모양으로 — `_meta.contextCompaction` 을 읽어 「128k → 42k 토큰 (−68%) · 자동 · 2.3초」

0.75.1 이월 첫 항목. 어댑터는 압축을 `kind: think` 의 합성 도구 호출("Compact conversation")로 접어 보내서, 화면엔 「생각 · Compact conversation」 한 줄만 남고 **몇 토큰이 줄었는지는 아무 데도 없었다**.

## 추가 기능

**1. 어댑터가 무엇을 보내는지부터 실측했다** (0.76.0 dist `context-compaction.js` · `context-compaction-meta.js`). `ContextCompactionLifecycle` 이 생애를 도구 호출 하나로 접는다: `start` → `tool_call`(think, in_progress, `_meta.contextCompaction: {version:1}` 빈 껍데기) · `heartbeat` → `tool_call_update`(메타는 여전히 빈 껍데기) · `finish` → `tool_call_update` 에 `{trigger: "manual"|"automatic", preTokens, postTokens?, durationMs?, error?}`. 실패는 `content` 에 "Compaction failed: …" 텍스트도 같이. 시작엔 숫자가 없고 끝에만 있다는 것이 리듀서 설계를 정했다.

**2. 백엔드 — `AcpCompaction` + `compaction_meta()`.** `AcpEvent::ToolCall`/`ToolUpdate` 에 `compaction: Option<AcpCompaction>` 필드. 메타의 `contextCompaction` 키가 있을 때만 `Some` — 메타 없는 `think` 는 진짜 생각이다. 토큰은 `Usage` 와 같은 이유로 `u32` 포화. `session.rs` 가 크기 래칫(1231)에 딱 붙어 있어 9줄이 넘쳤다 → 같은 `_meta` 읽기인 `claude_meta`(`claudeCode.toolName`/`title`)와 함께 **`acp/tool_meta.rs`** 로 갈랐다(「도구 호출의 `_meta` 확장」이라는 하나의 관심사). `session.rs` 1231 → 1228.

**3. 프런트 — 숫자를 문장으로.** `AcpToolCall.compaction`. 리듀서는 `event.compaction ?? tool.compaction` — 시작의 빈 껍데기를 끝의 숫자가 덮고, 그 뒤 메타 없는 갱신은 지우지 않는다. 순수 헬퍼 `compaction.ts`: `fmtTokens`(128000→"128k", 1.25M) + `compactionSummary` — 진행 중 「대화를 접는 중」 / 끝 「128k → 42k 토큰 (−68%) · 자동 · 2.3초」 / 뒤 토큰 없으면 「90k 토큰에서 · 수동」 / 실패 「압축에 실패했어요 — 사유」. `ThinkActivity` 프리젠터가 압축이면 얼굴 `Minimize2` · 이름 「컨텍스트 압축」을 주고, `TraceRow` 가 제목 자리에 문장을 놓는다. 어휘(`ActivityKind`)는 안 늘렸다 — 15낱말은 이벤트 표면에서 뽑은 것이고 압축은 `think` 로 오는 사실이 그대로라, 얼굴만 다르게 준다.

## 동작 흐름

어댑터 `tool_call`(think + `_meta.contextCompaction`) → `tool_meta::compaction_meta` → `AcpEvent::ToolCall{compaction: Some(빈)}` → 리듀서 `AcpToolCall.compaction` → 끝의 `tool_call_update` 가 숫자를 덮음 → `ThinkActivity` → `TraceRow` 제목 = `compactionSummary()`.

## 검증

- Rust: `tool_meta::tests::compaction_meta_is_read_from_tool_call_and_update` — 시작(빈 메타·`name=compact`)·끝(숫자 4개)·메타 없는 think(`None`). `cargo test --no-fail-fast` 전 스위트 0 failed · clippy `-D warnings` · fmt · `bindings.ts` 재생성 일치.
- 프런트: `acp_compaction.test.ts` 8건 — `fmtTokens` 5단계 · 문장 5갈래 · 리듀서 생애(빈→숫자→heartbeat 가 안 지움) · 메타 없는 think. 기존 `acp_turns.test.ts` 픽스처에 `compaction: null` 12곳. `typecheck` · `test` 210파일 2679건 · `lint` 6게이트(새 테스트를 `TESTS` 허용목록에) · `build` 전부 exit 0 — 병렬 세션 WIP 와 섞이지 않게 main(`c010e83`) 워크트리에 13파일만 얹어 돌렸다.
- 커밋 `52d4501` (임시 인덱스 + CAS). 실기기: 실제 `/compact` 를 쳐서 줄이 「컨텍스트 압축 · 숫자」로 뜨는지는 `{#eyes-usage-meter}` 와 같은 자리에서 본다.