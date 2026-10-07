---
schema_version: 1
type: bug
slug: "release-duplicate-run-guard"
status: done
difficulty: low
created_at: "2026-10-07T23:05:28+09:00"
session_id: "20261007-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/scripts/release/dedupe.mjs"
    op: create
  - path: ".github/scripts/release/dedupe.test.mjs"
    op: create
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/workflows/extension-release.yml"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related:
  - ref: "20260929/Bugs/0832_bug_ci-ort-cache-dir-in-rust-cache.md"
    kind: "followup"
tags:
  - "release"
  - "ci"
  - "mcp-tool"
---
[x] 같은 태그로 Release run 이 둘 떠 draft 를 다툴 수 있던 것 — 뒤에 뜬 run 이 스스로 물러난다

## 발생 원인

v3.9.0 태그를 한 번 밀었는데 Release run 이 같은 초(13:13:53Z)에 둘 떴다 — `37626868742` · `37626870355`, 둘 다 `push` 이벤트·같은 커밋. GitHub 가 push 이벤트를 두 번 전달한 것이다. `release.yml` 에는 동시성 규칙이 없어서 둘이 나란히 가면 같은 draft 를 만들고 자산·latest.json 을 서로 덮을 수 있었다. 이번에는 게이트 단계에서 뒤의 run 을 손으로 취소했다. 사용자 요청: "릴리스 중복 실행 막아줘."

## 해결 방법

- `meta` 잡에 「중복 실행 막기」: 같은 워크플로 · 같은 커밋 · 같은 태그에 **id 가 더 작은 run 이 아직 돌거나 성공했으면** 이 run 을 `gh run cancel` 로 스스로 취소한다(취소가 안 걸리면 120초 뒤 실패로 끝낸다). 둘이 동시에 서로를 봐도 id 로 갈려 하나만 남는다. 판정은 순수 함수 `.github/scripts/release/dedupe.mjs`.
- 앞선 run 이 실패·취소로 끝났으면 막지 않는다 — RELEASE.md §6 의 태그 재푸시 복구와 re-run(같은 id)은 그대로. 조회가 실패하면 단계도 실패한다(중복인지 모르는 채 빌드로 가지 않는다).
- concurrency 그룹은 쓰지 않았다: `cancel-in-progress` 는 공개 도중의 run 을 끊을 수 있고, 줄만 세우면 뒤 run 이 한 바퀴(1시간 반)를 더 돈다.
- 확장 게시(`ext-v*`)에도 같은 단계. `ci.yml`·`release.yml` 의 릴리스 스크립트 시험에 `dedupe.test.mjs` 를 더했고 RELEASE.md §5 에 규칙을 적었다.

## 검증

- `node:test` 12건(실제 사고 run 쌍 · 실패 뒤 재시도 · re-run · 드라이런 · 다른 태그 · 대기 상태 · CLI) + 기존 릴리스 시험 39건 통과. 워크플로 단계와 같은 `gh api` 조회를 오늘의 두 run 으로 재현해 …355 는 …742 에 막히고 …742 는 막히지 않음을 확인.
- PR #72 CI 5잡 success(확장 패키징 포함) → rebase 머지 `3c0f350b`. 실제 태그에서의 동작은 다음 릴리스에서 처음 보인다.