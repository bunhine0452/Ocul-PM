---
schema_version: 1
type: feature
slug: "oculpm-plugin-skeleton"
status: done
difficulty: low
created_at: "2026-07-20T18:28:57+09:00"
session_id: "mcp-20260720-182857"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: create
  - path: "plugin/oculpm/hooks/hooks.json"
    op: create
  - path: "plugin/oculpm/.mcp.json"
    op: create
  - path: "plugin/oculpm/README.md"
    op: create
  - path: "docs/claude-integration/04-plugin-packaging.md"
    op: create
related: []
tags:
  - "claude-integration"
  - "plugin"
  - "packaging"
  - "mcp-tool"
---
[x] PR-CI8 oculpm 플러그인 골격 — 훅+MCP 번들, 스펙 실측 조사 + 가드 검증

## 추가 기능

Phase C 마지막 PR — CI0(훅)+CI2(MCP) 설정을 수동 없이 구성하는 Claude Code 플러그인 프로토타입.

- **스펙 실측 조사** (공식 plugins/plugins-reference/hooks/mcp 문서 재검증, `04-plugin-packaging.md` §1): `.claude-plugin/` 에는 plugin.json 만, hooks/·.mcp.json 은 플러그인 루트. 훅은 settings.json 과 동일 JSON 형태 + 프로젝트 cwd 실행(`${CLAUDE_PROJECT_DIR}` 사용 가능). MCP `command`/`args` 에서도 변수 확장 지원, 플러그인 밖 절대경로 바이너리 참조 가능. 설치는 개발 `--plugin-dir`, 배포는 마켓플레이스.
- **골격** (`plugin/oculpm/`): plugin.json + hooks.json(3 이벤트) + .mcp.json + README.
- **결정 2가지가 핵심**: ① 훅 커맨드를 `[ -d …/.oculpm ] && … || true` 로 가드 — user 스코프 설치라도 **ocul-pm 비추적 저장소에는 아무 파일도 만들지 않음** (CI0 의 프로젝트별 옵인과 달리 스코프가 넓어져 필요해진 가드). ② MCP 는 `--root "${CLAUDE_PROJECT_DIR}"` — CI2 의 머신 종속 절대경로 문제가 플러그인 변수 확장으로 해소, **유저 스코프 서버 하나가 전 프로젝트 커버**.
- 캐비앗 문서화: 바이너리 경로는 sidecar 번들(#ci2-sidecar-bundle) 후의 .app 경로 기준(개발은 target/debug 로 수정), 앱 훅 토글과 중복 설치 시 인박스 2배 적재(집합 연산이라 정확성은 유지 — 하나만 쓰기).

## 동작 흐름

`claude --plugin-dir plugin/oculpm` → 훅 3종 + oculpm MCP 서버가 세션에 로드 → .oculpm 있는 프로젝트에서만 인박스 적재·도구 노출.

## 검증

- JSON 3파일 파스 OK + 훅 커맨드 `sh -n` 문법 OK.
- 가드 실동작 검증: 비추적 디렉터리에서 exit 0·파일 무생성, `.oculpm` 있는 디렉터리에서 이벤트 1줄 적재 확인 (스크래치 샌드박스).
- typecheck/lint/test 그린 (앱 코드 무변경 — cargo 382 유지). 플러그인 실로드 검증은 sidecar 번들 선행이라 #phase-c-runtime-verify 로.