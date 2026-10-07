---
schema_version: 1
type: error
slug: "release-draft-403-workflow-diff"
status: done
difficulty: medium
created_at: "2026-10-07T23:18:56+09:00"
session_id: "20261007-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/release.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related:
  - ref: "20261007/Bugs/2305_bug_release-duplicate-run-guard.md"
    kind: "followup"
tags:
  - "release"
  - "ci"
  - "mcp-tool"
---
[x] v3.9.0 릴리스가 draft 생성 403 으로 멈춘 것 — 릴리스 도중 main 에 워크플로 PR 을 머지했다

## 에러 증상

Release run 37626868742 의 macOS 잡이 빌드·서명·공증을 마치고 tauri-action 이 draft 를 만드는 순간 `##[error]Resource not accessible by integration - …#create-a-release` (14:11:49Z). publish 는 건너뛰었고 릴리스는 만들어지지 않았다(설계대로 사용자에게는 나가지 않음). Windows·Linux 번들·스모크·E2E 는 전부 초록.

## 원인 분석

- 잡 토큰은 `Contents: write` 였고 워크플로는 v3.8.0 과 한 글자도 같았다. 저장소 ruleset·태그 보호·불변 릴리스도 없었다.
- 실패 6분 전(14:05:03Z) 내가 PR #72(중복 실행 막기 — 워크플로 3개 수정)를 main 에 머지했다. GitHub 릴리스 API 는 `target_commitish` 커밋의 `.github/workflows/` 가 **기본 브랜치와 다르면** `workflows` 권한을 요구하고 GITHUB_TOKEN 은 그것을 못 받는다. release.yml 은 `releaseCommitish: github.sha`(태그 커밋)를 줬고, 머지 뒤 태그 커밋과 main 의 워크플로가 갈라졌다. v3.8.0 때는 둘이 같아 통과했다.
- 즉 원인은 내가 릴리스 run 이 도는 중에 워크플로 PR 을 머지한 것이다.

## 해결 방법

- 복구: tauri-action 은 같은 태그의 draft 가 있으면 고치지 않고 거기에 올린다(소스 확인). `target_commitish=main` 인 v3.9.0 draft(id 405841151, 본문은 `notes.mjs release-body` 로 같은 것)를 먼저 만들고 `gh run rerun --failed` — 비-mac 결과는 1차 것을 그대로 쓴다. 태그는 이미 있어 대상 값이 태그를 옮기지 않는다.
- 재발 방지(PR #73): `releaseCommitish` 를 기본 브랜치로. 드라이런도 같은 이유로 필요했다(워크플로를 고친 브랜치의 커밋은 늘 기본 브랜치와 다르다). RELEASE.md §6-1 표에 오류와 복구 절차.

## 검증

- 원인 확인: 같은 조건의 사례(container-compose #662)와 GitHub 문서 문장, 머지·실패 시각, 잡 토큰 권한·ruleset 조회.
- 복구 결과와 PR #73 머지는 2차 시도가 끝난 뒤 확인한다.