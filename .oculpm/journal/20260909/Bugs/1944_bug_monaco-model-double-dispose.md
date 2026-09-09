---
schema_version: 1
type: bug
slug: "monaco-model-double-dispose"
status: done
difficulty: low
created_at: "2026-09-09T19:44:12+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
related:
  - ref: "20260909/Refactors/1940_refactor_monaco-discussion-phase4.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "lifecycle"
  - "mcp-tool"
---
[x] 편집기가 소유한 모델을 두 번 죽이던 것

## 발생 원인

`monaco.editor.create(host, { value })` 로 만든 편집기는 모델을 **자기가
소유한다** — Monaco 가 `_ownsModel = true` 로 표시해 두고
`_postDetachModelCleanup` 에서 함께 푼다
(`standaloneCodeEditor.js:199~206, 228~232`).

그걸 모르고 두 곳이 같은 모델을 또 지우고 있었다.

- `CodeEditor.tsx` (Phase 1) — 평범한 편집기 경로에서 `ownedModels` 에 자기
  모델을 담아 `editor.dispose()` **뒤에** 한 번 더 풀었다.
- `DiscussionEditor.tsx` (Phase 4) — 더 나쁜 순서였다. `editor.dispose()`
  **전에** 모델을 풀어, 아직 붙어 있는 모델을 떼면서 죽였다.

파일을 옮길 때마다(부모가 `key` 로 재마운트한다) 지나가는 경로라 조용히 쌓인다.
`ModelData` 가 첫 해제에서 리스너를 걷기 때문에 두 번째 호출이 예외로 터지지는
않았고, 그래서 아무 테스트도 안 깨진 채로 남아 있었다.

## 해결 방법

편집기가 소유한 모델은 **편집기에게 맡긴다.**

- `CodeEditor.tsx` — 평범한 경로에서 `ownedModels` 를 비워 둔다. diff 모드의
  모델 둘은 우리가 `createModel` 로 만든 것이고 diff 편집기는 그것을 소유하지
  않으므로 그쪽은 그대로 우리가 푼다.
- `DiscussionEditor.tsx` — 명시적 모델 해제를 지우고 `editor.dispose()` 하나만
  남겼다.

둘 다 주석에 "누가 소유하는가" 를 적었다 — 이 구분이 없으면 다음 사람이 같은
자리에서 같은 판단을 다시 한다.

## 검증

- `pnpm typecheck` 초록, `discussion_editor` · `monaco_options` 스위트 19개 통과.
- 전체 `pnpm test` 192파일 2,476개 통과 (수정 직전 실행).
- **주의**: 커밋 직후 `pnpm build` 의 `tsc` 가 붉었는데 원인은 **병렬 세션**이
  같은 순간 고치고 있던 `CommandPalette.tsx` · `SettingsPanel.tsx` 의 아이콘
  prop(`size`)이다. 내 파일과 무관하고, 같은 트리에서 `pnpm typecheck` 를 다시
  돌려 오류 둘이 그 두 파일뿐임을 확인했다.