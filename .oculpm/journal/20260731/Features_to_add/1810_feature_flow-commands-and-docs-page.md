---
schema_version: 1
type: feature
slug: "flow-commands-and-docs-page"
status: done
difficulty: medium
created_at: "2026-07-31T18:10:02+09:00"
session_id: "mcp-20260731-181002"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/commands/inception.md"
    op: create
  - path: "plugin/oculpm/commands/next.md"
    op: create
  - path: "landing/plugin.html"
    op: create
  - path: "landing/index.html"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
related: []
tags:
  - "plugin"
  - "commands"
  - "docs"
  - "landing"
  - "flow"
  - "mcp-tool"
---
[x] 흐름 완결 커맨드 2종(/oculpm:inception·next) + oculpm.com/plugin 문서 페이지(테스트 강제 동기)

## 추가 기능

사용자 표준 흐름을 커맨드로 완결 + 살아있는 문서 페이지:

- **/oculpm:inception** — 설계 시작 커맨드: `.oculpm` 없으면 추적 여부 확인→project_init, 이어서 project-inception 스킬 전 과정(리서치→사양 확정→3-depth 계획→EVALS→rules). `$ARGUMENTS` = 아이디어.
- **/oculpm:next** — 구현 루프 커맨드(플래너 ▶실행의 플러그인 대응물): plan_status 로 다음 미완 리프 확인→구현→게이트→journal_write→plan_update 한 사이클. `$ARGUMENTS` 로 항목 지정.
- **oculpm.com/plugin 문서 페이지**(landing/plugin.html, cleanUrls): 권장 흐름(init→inception→next 반복→standup), 커맨드 4종·MCP 도구 5종·스킬 5종 전체 표면, 설치 2줄 복사 버튼. 인덱스(플러그인 카드·푸터)에서 링크.
- **"항상 업데이트" 를 테스트로 강제**: plugin_manifest 에 `landing_plugin_docs_page_lists_every_command_and_tool` — commands/*.md 전수 스캔으로 문서 페이지에 `/oculpm:<이름>` 이 없으면 커밋 게이트 실패. 커맨드 4종 고정 단언 + 예산 합산도 갱신.

## 동작 흐름

플러그인 설치 → `/oculpm:project_init` → `/oculpm:inception 아이디어` → `/oculpm:next` 반복 → `/oculpm:standup`. 새 커맨드 추가 시 문서 페이지 미갱신이면 cargo 게이트가 막는다.

## 검증

plugin_manifest 7/7(신규 문서 동기 테스트 포함), typecheck/test/build/lint exit 0. 배포 후 oculpm.com/plugin 렌더 확인은 커밋 후.