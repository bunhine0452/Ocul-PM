---
schema_version: 1
type: chore
slug: "release-v2-2-0-sidecar-and-promo"
status: done
difficulty: medium
created_at: "2026-07-20T21:24:23+09:00"
session_id: "mcp-20260720-212423"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/build-sidecar.mjs"
    op: create
  - path: "src-tauri/build.rs"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/landing.css"
    op: update
  - path: ".gitignore"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
related: []
tags:
  - "release"
  - "claude-integration"
  - "mcp"
  - "landing"
  - "PR-CI2"
  - "mcp-tool"
---
[x] v2.2.0 릴리스 — 사이드카 번들 배선 + README/랜딩 홍보 + 누적 다운로드 배지

## 작업 내용

Claude 직접 연동 라운드를 v2.2.0 으로 릴리스. main 머지(ff, 9e77863) → v2.2.0 태그 푸시 → release.yml 가동.

1. **사이드카 번들 배선(#ci2-sidecar-bundle)** — `externalBin: ["binaries/oculpm-mcp"]` + `scripts/build-sidecar.mjs`(호스트 triple 로 릴리스 빌드, 1MB 크기 가드로 플레이스홀더 출하 차단) 를 beforeBuildCommand 에 연결. **함정**: externalBin 선언 시 tauri_build 가 컴파일 시점에 파일 존재를 검증해 사이드카 자신의 빌드·갓 클론 `cargo test` 가 전부 깨지는 순환 발생 → `build.rs` 가 0바이트 플레이스홀더를 자가 생성해 해소. CI 동일조건(--target aarch64-apple-darwin + 서명키) 로컬 빌드로 `.app/Contents/MacOS/oculpm-mcp`(5.8MB) 동봉과 `--version` 응답 실검증.
2. **홍보** — CHANGELOG v2.2.0(연동 라운드 전체), README 한/영: v2.2.0 섹션 + 지원 에이전트에 직접 연동 명시. 랜딩: 히어로 NEW 필 + `#update` 다크밴드(Claude Desktop 채팅 목업 — plan_status/plan_update 왕복), 나브 "새 소식", 화면 수 12 교정, JSON-LD softwareVersion/featureList 갱신. 앱 토큰 색감(#12a06b 계열) 유지.
3. **누적 다운로드 배지** — badgen assets-dl(최신 릴리스만 집계)을 shields `github/downloads/:repo/total`(전 릴리스 누적)로 교체. 버전이 올라가도 리셋되지 않는다.
4. **gitignore 방어** — `.oculpm/hooks/` 가 관리블록에서 또 유실된 것을 발견(#managed-block-versioning 리스크 실현) → 블록 **밖** 사용자 영역에 고정해 앱 재작성에도 생존.

## 검증

커밋 전 게이트 전부 exit 0 직접 확인(cargo test·typecheck·vitest 198·lint·build). 로컬 릴리스 번들에서 사이드카 동봉+실행 확인. 태그 푸시 후 release.yml run 29742014325 in_progress 확인 — 완료·자산 업로드는 별도 확인 진행.