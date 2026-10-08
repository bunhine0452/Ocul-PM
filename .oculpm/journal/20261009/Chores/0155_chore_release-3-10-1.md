---
schema_version: 1
type: chore
slug: "release-3-10-1"
status: done
difficulty: verylow
created_at: "2026-10-09T01:55:02+09:00"
session_id: "mcp-20261009-015502"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related:
  - ref: "20261008/Bugs/2323_bug_lsp-trust-chip-missed-event.md"
    kind: "followup"
tags:
  - "release"
  - "mcp-tool"
---
[x] v3.10.1 릴리스 — 「신뢰하고 켜기」 가 이제 뜹니다

## 실린 것
PR #78 — v3.10.0 의 언어 서버 신뢰 칩이 막 마운트된 편집기에서 뜨지 않던 회귀(즉시 답하는 Untrusted 이벤트를 비동기 구독이 놓침 → 열기 실패 시 `lsp_status` 직접 조회).

## 절차
`bump-version 3.10.1`(6파일 + 랜딩 ko/en 6곳), CHANGELOG · README ko/en(🚀 이동) · 랜딩 ko/en 변경 이력 · plugin 배지 ko/en · `build.mjs` 재빌드. 게이트는 typecheck · lint · test 3,298 · build · cargo test 2,017 전부 0 이었다. 릴리스 커밋 cefe8cf1 의 CI 초록을 확인한 뒤 태그를 단독 push → run 37793655463 하나.

## 검증
run 전 단계 success(macOS 서명/공증 · win/linux 번들 · 스모크 · E2E · 공개). 15:20Z 에 공개됐고 자산 10, latest = v3.10.1, latest.json 키 5개다. 랜딩은 vercel(ocul-pm-landing)로 배포했고 oculpm.com · /en 의 softwareVersion 3.10.1 과 /changelog 를 확인했다.