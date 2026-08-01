---
schema_version: 1
type: chore
slug: "release-v2-8-2"
status: done
difficulty: verylow
created_at: "2026-08-01T15:27:17+09:00"
session_id: "mcp-20260801-152717"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "release"
  - "mcp-tool"
---
[x] release: v2.8.2 — 터미널 한국어 입력·표시 수정

터미널 한국어 수정 2건(글자 크기 · 이중 입력)을 패치 릴리스로 낸다.

## 변경 요약

- 버전 2.8.1 → 2.8.2 — `package.json` · `tauri.conf.json` · `Cargo.toml`/`lock` · `plugin.json` · `marketplace.json` (plugin_manifest 테스트가 동기를 강제).
- `CHANGELOG.md` v2.8.2 섹션 — 릴리스 워크플로가 태그와 같은 헤더의 본문을 릴리스 노트로 쓴다.
- 랜딩 버전 5곳 — JSON-LD softwareVersion · 공지 필 · 업데이트 목록(신규 항목 추가) · 다운로드 버튼 · CTA.

## 검증

- typecheck / test(50 files, 610) / lint exit 0.
- 프로덕션 빌드는 로컬에서 돌리지 않는다 — 태그 푸시가 `release.yml`(tauri-action)을 띄워 거기서 빌드·서명·릴리스까지 한다. 로컬 `pnpm build` 는 그 작업의 중복이다.