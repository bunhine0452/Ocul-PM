---
schema_version: 1
type: chore
slug: "release-v2-6-0"
status: done
difficulty: low
created_at: "2026-07-31T17:28:34+09:00"
session_id: "mcp-20260731-172834"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "release"
  - "v2.6.0"
  - "mcp-tool"
---
[x] v2.6.0 릴리스 — 회고 Claude Code 생성·스킬 승격·project_init

v2.5.1 이후 변경을 v2.6.0 으로 배포:

- 회고 [Claude Code 로] 생성(디스패치→`.oculpm/retro/` 파일→병합) + 생성 상태 전역화(이탈-복귀 유지·경과 표시)
- 반복 절차→스킬 승격 루프(회고 "스킬 후보" 카드)
- project_init MCP 도구(5종째) + project-inception v3
- 라이선스 약속·CONTRIBUTING(DCO), Notion 에러 페이지 안내형

절차: 버전 6곳+Cargo.lock+랜딩 JSON-LD 2.6.0, CHANGELOG `## v2.6.0`(awk 규격), 사전 2-에이전트 검증 — 지적 3건 반영(README 한/영 헤드라인 v2.6.0 갱신, 랜딩 v2.5.0 카피 8곳 정리+밴드에 v2.6 항목 추가, 체인지로그 기타 bullet 의 범위 밖 주장 수정·Notion 안내 페이지 추가).

## 검증

typecheck/lint/test/build/cargo 전체 exit 0 (rust 482). CHANGELOG 헤더 바이트 일치 확인(hex). 태그 푸시 후 release.yml 성공·latest.json 2.6.0 은 별도 확인.