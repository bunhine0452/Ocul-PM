---
schema_version: 1
type: chore
slug: "deps-advisories-v3-13-4"
status: done
difficulty: low
created_at: "2026-10-24T10:39:35+09:00"
session_id: "20261024-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "CHANGELOG.md"
    op: update
related: []
tags:
  - "release"
  - "deps"
  - "security"
  - "mcp-tool"
---
[x] v3.13.3 릴리스가 CI 게이트에 막힘 — 새 보안 공지 의존성 올리고 v3.13.4 로

## 변경 요약

v3.13.3 태그의 release.yml 이 게이트에서 멈췄다 — 그 커밋의 CI 가 이번 변경과 무관한 새 공지로 붉었다.

- cargo-deny: RUSTSEC-2026-0382(rustls-webpki 0.103.15→0.103.16) · 0386(tokio 1.52.3→1.54.1, AsyncFd I/O 안전성) · 0381/0383(webpki-roots·webpki-root-certs 1.0.7→1.0.11, emSign 중간 인증서). `cargo update -p` 네 개.
- pnpm audit: monaco-editor 가 끄는 dompurify ≤3.4.16 (critical GHSA-cg2g-xh64-v4q7 · high GHSA-mrv2-3pqr-j5jr) — `pnpm.overrides` 를 `^3.4.17` 로.

docs/RELEASE.md 규칙대로 태그는 옮기지 않고 v3.13.4 로 다시 낸다. v3.13.3 은 GitHub 릴리스가 만들어지지 않아 CHANGELOG·README·랜딩 문구를 v3.13.4 로 바꿔 달았다.

## 검증

- 로컬 cargo-deny `advisories ok, bans ok, licenses ok, sources ok` · `pnpm audit --prod --audit-level=high` 통과.
- `cargo test --locked` 실패 0 · typecheck · vitest · lint 통과.