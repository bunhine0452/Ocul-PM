---
schema_version: 1
type: feature
slug: "artifact-plan-board"
status: done
difficulty: medium
created_at: "2026-10-14T05:59:01+09:00"
session_id: "20261014-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4582e4ac-7f89-4e5b-9172-d92d9aa9650b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/board.rs"
    op: create
  - path: "src-tauri/src/oculpm/board.html"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/guards.rs"
    op: update
  - path: "plugin/oculpm/commands/board.md"
    op: create
  - path: "plugin/oculpm/commands/help.md"
    op: update
  - path: "plugin/oculpm/commands/next.md"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
related:
  - ref: "20261014/Refactors/0558_refactor_remove-notion-integration.md"
    kind: "followup"
tags:
  - "plugin"
  - "planner"
  - "artifact"
  - "redaction"
  - "mcp-tool"
---
[x] /oculpm:board — 활성 플랜을 claude.ai 비공개 아티팩트 보드로 발행·동기화

## 추가 기능
- 플러그인 커맨드 `/oculpm:board`(6번째): 활성 플랜을 claude.ai 의 **비공개** 아티팩트 보드 한 장에 비추고, 다시 부르면 갱신한다. 읽기 전용, 원본은 `.oculpm/planner/`. Notion 이 맡던 "밖에서 보기"의 대체다. 앱에 새 화면·연동·리스너를 만들지 않는다 — 송출은 사용자가 시킨 Claude Code 가 한다(범위 동결 준수).
- `oculpm-mcp board --root <dir> --out <폴더>` (`oculpm/board.rs`, verdict 와 같은 셔틀 서브커맨드): `plan_status`(view=full)를 끝까지 넘겨 `plans/<id>.json`·`meta.json`·`page.html` 을 낸다. 에이전트는 항목 207개를 옮겨 적지 않고 `ArtifactData batch` 에 `file_path` 만 넘긴다(토큰·변형 위험 제거). 문서가 200KB 를 넘으면 끝난 항목을 빼고 `trimmed`.
- 페이지 템플릿 `oculpm/board.html` 은 바이너리에 `include_str!` — 데이터 없이 db(`plans`·`meta/board`)를 onSnapshot 으로 읽는다. 앱 초록 액센트·IBM Plex, 라이트/다크 토큰, 남은 항목/전부 토글, 디스크 글리프 어휘 그대로의 상태 마크.
- db 규칙: `plans`·`meta` 는 view 읽기·owner 쓰기 — 공유받은 사람은 보기만.
- **마스킹**: `plan_status` 가 플랜 제목·항목 문구를 `patterns_for_project` 로 가린 뒤 응답한다(손으로 쓴 플랜은 지금까지 원문 그대로 나갔다). 보드도 이 응답을 재료로 쓴다.
- 문서 면: `/oculpm:help`, `next.md`(보드 쓴 세션이면 갱신), landing plugin.html ko/en(커맨드 6종), 앱 플러그인 문서 탭(`pluginDocs.ts`), plugin_manifest 커맨드 목록.

## 동작 흐름
`board` 서브커맨드 → stdout JSON(title·page·files) → `Artifact list` 로 같은 제목 보드 찾기 → 없으면 page.html 발행(capabilities db rules) → `ArtifactData list` 로 version 읽고 batch set(+옛 플랜 delete).

## 검증
- 이 저장소로 실발행: https://claude.ai/artifact/Fan44UXGchRqvmDg9guX5A — 플랜 6개 batch 7건 커밋, view 레벨 읽기 성공 · interact 레벨 쓰기 거부 확인.
- 신규 시험 4(board 3 · plan_status 마스킹 1), cargo test 2053/0 · clippy 0 · vitest 3322 · lint · typecheck · build 0.
- 미확인: `${CLAUDE_PLUGIN_ROOT}` 가 커맨드 본문에서 풀리는지(폴백 경로 안내 넣음), 설치본 앱은 아직 `board` 를 모른다(다음 릴리스부터).