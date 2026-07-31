---
schema_version: 1
type: feature
slug: "mcp-project-init"
status: done
difficulty: medium
created_at: "2026-07-31T17:08:37+09:00"
session_id: "mcp-20260731-170837"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/protocol.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "plugin/oculpm/skills/project-inception/SKILL.md"
    op: update
  - path: "src/features/skills/skillsGallery.ts"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "mcp"
  - "plugin"
  - "project-init"
  - "greenfield"
  - "contract"
  - "mcp-tool"
---
[x] project_init MCP 도구 — 플러그인-온리 그린필드에서 추적 시작

## 추가 기능

플러그인만 설치한 사용자가 새 저장소에서 ocul-pm 추적을 시작할 수 없던 구멍(A0b 가드가 전 도구 거부)을 해소 — **가드의 유일한 예외** 도구:

- `project_init(confirm)` — confirm=true(사용자 명시 확인) 없으면 거부. 심볼릭 링크 `.oculpm` 거부, 이미 추적 중이면 무변경 스킵(idempotent), `.oculpm` 이 파일이면 에러.
- 스캐폴드 = 앱 `init_project` 의 디스크 부분 재현: config.toml 기본값 + `.schema-version` + `.gitignore` 관리 블록(union 병합·다운그레이드 가드 재사용) + `.oculpm/README.md` + `agents::sync_active`(AGENTS.md 어댑터·마스터 템플릿·discussion-spec). 락/워처/DB 는 앱 몫 — 앱을 열면 이어받는다.
- 3중 게이트: confirm 인자(테스트 잠금) + 도구 설명의 호출 조건 + 서버 instructions 의 선제 호출 금지.
- 파급 갱신: 계약 문서 06(예외 행+원칙 개정 각주), plugin README 안전 가드 문단, "도구 4종→5종" 표면 스윕(README 한/영·랜딩 3곳·발사 글·채널 초안), project-inception 스킬 STAGE 0 에 "동의 후 project_init" 연결(+갤러리 패리티).

## 동작 흐름

플러그인 설치 → 새 저장소에서 "이 프로젝트 추적 시작해줘" → 에이전트가 사용자 확인 후 project_init(confirm=true) → AGENTS.md·.oculpm/ 생성 → plan_create/journal_write 즉시 동작 → 인셉션 스킬 흐름 진입.

## 검증

신규 테스트 2(confirm 게이트·스캐폴드·직후 journal_write 동작·재호출 무변경 / 심볼릭 링크 거부) + 프로토콜 tools/list 5종 갱신 — `cargo test --lib mcp` 32/32. 전체 게이트는 스킬 승격 루프와 합산 실행.