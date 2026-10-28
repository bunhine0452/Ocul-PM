---
schema_version: 1
type: refactor
slug: "skills-12-to-5-drop-board-renderer"
status: done
difficulty: medium
created_at: "2026-10-28T23:25:15+09:00"
session_id: "20261028-010"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/board/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/standup/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/self-audit/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/run-evals/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/tdd-workflow/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/project_init/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/project-inception/SKILL.md"
    op: delete
  - path: "plugin/oculpm/skills/inception/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/next/SKILL.md"
    op: update
  - path: "plugin/oculpm/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/session-end.sh"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "src-tauri/src/oculpm/board.rs"
    op: delete
  - path: "src-tauri/src/oculpm/board.html"
    op: delete
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
  - path: "src/features/skills/skillsGallery.ts"
    op: update
  - path: "src/__tests__/plugin_docs_sync.test.ts"
    op: update
  - path: "src/__tests__/plugin_skills_sync.test.ts"
    op: update
  - path: "src/__tests__/skills_gallery_v2.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "plugin"
  - "skills"
  - "simplify"
  - "mcp-tool"
---
[x] 플러그인 스킬 12→5 — 남긴 것은 next · redteam · inception · help · oculpm-journal

## 동기
덜어내기 라운드(사용자 승인 3번). 스킬 12개 중 일곱은 쓰임이 없거나(standup·board), Claude Code 가 이미 하는 일을 겹쳐 적었거나(self-audit·tdd-workflow·run-evals), 둘이 같은 일을 했다(inception·project-inception). 세션마다 실리는 스킬 설명이 길어질수록 「어떤 프로젝트여도 최고의 결과」 와 멀어진다 — 에이전트가 읽어야 할 것은 다섯 원칙과 기록 규칙이지 스킬 카탈로그가 아니다. `project_init` 커맨드는 MCP 도구 `project_init` 와 앱이 이미 맡고 있어 스킬로 둘 이유가 없었다.

## 변경 요약
- 걷음: `board` · `standup` · `self-audit` · `run-evals` · `tdd-workflow` · `project_init` · `project-inception`. `inception` 은 project-inception 의 STAGE 0~4 를 흡수(EVALS 단계는 뺌 — 완료 조건·확인 명령이 그 자리). `help` 는 커맨드 4 · MCP 도구 7 · 스킬 1 로, `next` 는 보드 문장을 뗐다. `session-end.sh` 안내 → `/oculpm:next`.
- 보드 스킬이 유일한 호출자였던 `oculpm::board`(board.rs 276줄 + board.html 223줄)와 MCP 바이너리의 `board` 서브커맨드를 함께 지웠다 — 대체가 옛 경로를 남기지 않는다(CLAUDE.md 규칙).
- 게이트: `plugin_manifest.rs` 의 KNOWLEDGE_SKILLS=[oculpm-journal] · COMMAND_SKILLS=[help, inception, next, redteam]; `plugin_docs_sync.test.ts` 지식 스킬 목록·`pluginDocs.ts` 커맨드 4종 + 권장 흐름 inception→next→redteam; 인앱 스킬 갤러리는 비움(`GALLERY_SKILLS = []`, 지운 SKILL.md 를 raw import 하던 자리). `skill.*` i18n 8키 제거.
- 표면: landing/plugin.html ko·en 카드 4종, landing/index.html ko·en 의 featureList 「플랜 보드」 항목과 모바일 FAQ 의 보드 안내 삭제(JSON-LD 파싱 확인), 06-plugin-contract.md, README ko·en 플러그인 줄, CLAUDE.md 「Already removed 2026-10-28」.

## 검증
- `node -e "readdirSync('plugin/oculpm/skills').length"` → 5 · `cargo test --test plugin_manifest` → 11 passed · `cargo test --test rule_canary` → 6 passed
- `pnpm vitest run plugin_docs_sync plugin_skills_sync` → 63 passed · `pnpm test` → Test Files 148 passed · Tests 1913 passed · `pnpm typecheck` exit 0 · `pnpm lint` 0 errors 2 warnings · `pnpm build` OK
- `cargo test --no-fail-fast` FAILED 0 · `cargo clippy --all-targets --locked -- -D warnings` 경고 0 · `cargo fmt --check` OK

## 메모
README 의 v3.13.0 절(보드 소개)은 릴리스 이력이라 그대로 두었다 — 걷은 사실은 v3.18.0 CHANGELOG 가 말한다. 설치본의 옛 플러그인 판은 `/plugin update` 전까지 12개 스킬을 계속 보인다.