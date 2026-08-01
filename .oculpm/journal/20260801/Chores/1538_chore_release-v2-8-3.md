---
schema_version: 1
type: chore
slug: "release-v2-8-3"
status: done
difficulty: verylow
created_at: "2026-08-01T15:38:33+09:00"
session_id: "mcp-20260801-153833"
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
[x] release: v2.8.3 — 터미널 붙여넣기 이중 입력 수정

붙여넣기 이중 입력 수정을 v2.8.2 직후 패치로 낸다. 중복만이 아니라 개행이 bracketed paste 없이 셸로 나가 각 줄이 실행될 수 있는 문제라 모아두지 않고 바로 배포한다.

## 변경 요약

- 버전 2.8.2 → 2.8.3 — `package.json` · `tauri.conf.json` · `Cargo.toml`/`lock` · `plugin.json` · `marketplace.json`.
- `CHANGELOG.md` v2.8.3 섹션, 랜딩 버전 5곳.
- 주의: 랜딩의 다운로드 버튼·CTA 줄 번호가 직전 릴리스에서 업데이트 목록 항목을 추가하며 한 줄씩 밀렸다. 줄 번호로 sed 하기 전에 `grep -n` 으로 현재 위치를 확인할 것.

## 검증

- typecheck / test(50 files, 611) / lint exit 0. 빌드는 태그 푸시가 `release.yml` 에서 수행 — 로컬 `pnpm build` 는 돌리지 않는다.