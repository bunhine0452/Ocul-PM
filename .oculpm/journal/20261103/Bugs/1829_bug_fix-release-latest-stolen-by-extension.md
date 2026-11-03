---
schema_version: 1
type: bug
slug: "fix-release-latest-stolen-by-extension"
status: done
difficulty: medium
created_at: "2026-11-03T18:29:10+09:00"
session_id: "20261103-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/extension-release.yml"
    op: update
  - path: ".github/workflows/release.yml"
    op: update
related:
  - ref: "20261103/Chores/1735_chore_release-v4-5-1.md"
    kind: "followup"
tags:
  - "ci"
  - "release"
  - "updater"
  - "mcp-tool"
---
[x] CI: 확장 릴리스가 Latest 를 뺏지 않게

## 발생 원인
앱 업데이터의 엔드포인트는 `releases/latest/download/latest.json` 이다. 11-03 00:36Z 에 나간 `ext-v0.3.0` 이 GitHub 의 Latest 를 가져갔고, 그 릴리스에는 latest.json 이 없어 **설치된 모든 앱의 업데이트 확인이 실패**했다. 둘이 겹쳤다.
- `extension-release.yml` 의 `gh release create` 에 `--latest=false` 가 없었다(기본값이 latest).
- `release.yml` 공개 단계는 「지금 latest 보다 새로울 때만 `--latest`」 인데 `sort -V` 가 `ext-v0.3.0` 을 `4.5.x` 보다 크다고 봐서 v4.5.0 · v4.5.1 둘 다 latest 를 못 옮겼다(`--latest=false` 로 공개).

## 해결 방법
- 즉시: `gh release edit v4.5.1 --latest` — `releases/latest` → v4.5.1, 엔드포인트 200 확인.
- 확장 릴리스는 `--latest=false` 로 만든다.
- 앱 릴리스는 latest 가 앱 태그(`v[0-9]*`)가 아니면 비교하지 않고 되찾는다.

## 검증
- `gh api repos/.../releases/latest` → v4.5.1, `releases/latest/download/latest.json` HTTP 200
- 분기 스크립트 세 경우: ext-v0.3.0→4.5.2 latest · v4.5.1→4.5.2 latest · v4.6.0→4.5.2 keep