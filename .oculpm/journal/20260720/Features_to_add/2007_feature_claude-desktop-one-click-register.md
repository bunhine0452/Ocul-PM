---
schema_version: 1
type: feature
slug: "claude-desktop-one-click-register"
status: done
difficulty: medium
created_at: "2026-07-20T20:07:36+09:00"
session_id: "mcp-20260720-200736"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "claude-integration"
  - "mcp"
  - "claude-desktop"
  - "PR-CI2"
  - "mcp-tool"
---
[x] Claude Desktop 원클릭 MCP 등록 — claude_desktop_config.json 직접 기입

## 추가 기능

PR-CI2 의 D3 결정("Desktop 원클릭 + 스니펫 복사 UI") 중 스니펫 복사만 있고 원클릭이 빠져 있던 것을 채웠다. Claude Desktop 은 훅·transcript 가 없어 MCP 가 유일한 연동로인데, 지금까지는 사람이 `claude_desktop_config.json` 을 열어 스니펫을 붙여넣어야 했다.

- `register.rs` — `desktop_config_path()` (`directories::BaseDirs::config_dir()/Claude/claude_desktop_config.json`, macOS·Windows·Linux 공통), `desktop_status_at/register_at/unregister_at`. `.mcp.json` 등록기와 동일 계약: 우리 키(`oculpm-<폴더명>`)만 만지고, 남의 서버·미지 키 보존, 파싱 불가 파일 절대 덮어쓰기 금지.
- 프로젝트별 키라 여러 프로젝트가 한 Desktop 설정에 공존. 같은 루트의 옛 키(폴더명 변경)는 등록 시 걷어내 멱등. 다른 프로젝트의 oculpm 엔트리는 foreign 도 ours 도 아닌 중립으로 보존.
- 설정 폴더가 없으면(=Desktop 미설치 추정) 폴더를 만들지 않고 에러 — 남의 앱 데이터 디렉터리를 창조하지 않는다.
- 커맨드 3종 `mcp_desktop_status/register/unregister` + bindings 재생성.
- 설정 UI: MCP 블록에 "Claude Desktop" 행 추가 — 배지(미설치/미등록/등록됨) + Desktop 등록/해제 버튼, 등록 후 재시작 필요 고지. 스니펫 복사는 폴백으로 유지(Desktop 행으로 이동).

## 동작 흐름

설정 → 에이전트 → MCP 블록 → "Desktop 등록" 클릭 → 앱이 `claude_desktop_config.json` 의 `mcpServers["oculpm-<프로젝트폴더명>"]` 에 사이드카 바이너리 절대경로 + `--root <프로젝트>` 를 원자적으로 머지 → Claude Desktop 재시작 → `plan_status` 등 3 도구로 프로젝트 현황 질의 가능. 해제는 이 프로젝트의 엔트리만 걷어낸다.

## 검증

cargo test 389 전부 통과(register.rs 신규 5 테스트: 왕복 보존·옛 키 정리·미설치 거부·깨진 설정 불변), vitest 198(mcp_settings 8, Desktop 케이스 4 신규), typecheck·lint·build exit 0. 실제 Desktop 재시작 후 도구 왕복은 #ci2-runtime-verify 실기기 확인으로 남김.