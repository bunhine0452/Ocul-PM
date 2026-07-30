---
schema_version: 1
type: chore
slug: "release-v2-5-0"
status: done
difficulty: low
created_at: "2026-07-31T04:47:24+09:00"
session_id: "mcp-20260731-044724"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
related: []
tags:
  - "release"
  - "v2.5.0"
  - "plugin-round"
  - "mcp-tool"
---
[x] v2.5.0 릴리스 — 플러그인·디스패치·3-depth·템플릿 v7 라운드 출시

plugin-round 의 산출 전체를 v2.5.0 으로 릴리스. 버전 5곳 동기 범프(app/package/Cargo/plugin/marketplace — 매니페스트 테스트가 강제), CHANGELOG v2.5.0 작성(플러그인 마켓플레이스·▶실행 디스패치·3-depth·project-inception·템플릿 v7 −60%·터미널 크래시 근본 수정·하이라이터 경량화), main 커밋+태그 `v2.5.0` 푸시 → release.yml (macOS aarch64 + oculpm-mcp sidecar).

## 검증

- 워크플로 성공(run 30575387617, exit 0). 릴리스 자산 4종 확인: dmg·app.tar.gz·.sig·latest.json, isDraft=false, 노트가 CHANGELOG `## v2.5.0` 섹션에서 자동 추출됨.
- `releases/latest/download/latest.json` 실서빙 = version 2.5.0 (darwin-aarch64) — 기존 사용자 앱의 자동 업데이트 배너 활성 확인.
- 릴리스 전 게이트 전체 그린(cargo·typecheck·lint·vitest 339·build).