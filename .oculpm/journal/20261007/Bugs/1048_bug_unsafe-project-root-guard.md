---
schema_version: 1
type: bug
slug: "unsafe-project-root-guard"
status: done
difficulty: low
created_at: "2026-10-07T10:48:50+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/paths/tool_config.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src/windows/StartTab.tsx"
    op: update
related:
  - ref: "20261007/Bugs/0935_bug_symlink-escape-hardening.md"
    kind: "followup"
tags:
  - "security"
  - "external-review"
  - "mcp-tool"
---
[x] create_project 가 파일시스템 루트·홈을 프로젝트로 받아들였다

## 발생 원인

외부 보안 피드백: 웹뷰가 부를 수 있는 `create_project` 가 `/` 나 홈 폴더도 프로젝트 루트로 받았다. MCP `project_init` 은 이미 둘을 막고 있었는데(폭발 반경 가드) 앱 쪽 `create_project`·`init_project` 는 경로를 그대로 받았다 — 들이면 `.oculpm/`·AGENTS.md·`.gitignore` 블록이 홈에 깔리고 워처·색인이 디스크 전체를 걷는다.

## 해결 방법

- `paths::is_unsafe_project_root` — canonicalize 뒤 파일시스템 루트이거나 홈 자체.
- `create_project` 는 코드 `unsafe_project_root` 를 돌려주고 시작 탭이 ko/en 문장(`err.code.unsafe_project_root`)으로 옮긴다. `init_project` 도 같은 판정으로 거부한다(`OculpmError::UnsafeProjectRoot`) — 이미 그렇게 등록된 프로젝트도 열 때 아무것도 깔지 않는다.
- 하지 않은 것: 그린필드 스캐폴더 허용 목록. `npx` 자체가 임의 패키지를 실행하므로 목록이 좁히는 것이 없다 — 그 경로의 방어는 CSP 다.

## 검증

- 테스트 2(루트·홈 판정, 루트 init 거부). 전체 Rust 1985 통과, clippy 0, vitest 3269, lint·typecheck 통과.