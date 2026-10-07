---
schema_version: 1
type: chore
slug: "release-v3-9-0"
status: done
difficulty: medium
created_at: "2026-10-08T00:05:35+09:00"
session_id: "mcp-20261008-000535"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
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
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
related:
  - ref: "20261007/Errors/2318_error_release-draft-403-workflow-diff.md"
    kind: "followup"
  - ref: "20261007/Bugs/2305_bug_release-duplicate-run-guard.md"
    kind: "followup"
tags:
  - "release"
  - "mcp-tool"
---
[x] v3.9.0 릴리스 — 프로젝트 경계를 끝까지, 화면 머리는 작게

PR #70(보안 피드백 2차)·#71(화면 머리)를 싣는 릴리스. 다섯 면(docs/RELEASE.md)을 origin/main 기준 별도 워크트리에서 채웠다 — 메인 워킹트리에는 다른 세션의 WIP 와 갈라진 로컬 main 이 있었다.

- 버전 6파일 + 랜딩 ko/en 각 6곳(`bump-version.mjs`), 플러그인 페이지 배지 ko/en, Cargo.lock.
- CHANGELOG `## v3.9.0` — **v3.8.0 노트의 링크 문장 정정**(그때 막은 것은 `.oculpm/` 안과 편집기 저장뿐이었다)을 첫 문단에. README ko/en 하이라이트, 랜딩 ko/en 변경 이력 줄. 기존 FAQ 의 링크·마스킹 문장은 여전히 사실이라 그대로. `wiki-src/build.mjs` 로 changelog·sitemap·privacy·themes 재생성.
- 게이트: typecheck · vitest 3270 · lint 7종 · build · `cargo test` 2004 — 전부 exit 0.
- 커밋 `084acb50` → `release/v3.9.0:main` fast-forward, 태그 단독 push.

## 릴리스 run 에서 생긴 일

- **같은 태그로 run 이 둘**(37626868742 · 37626870355, 같은 초) — 뒤의 것을 게이트에서 취소. 재발 방지는 PR #72(별도 일지).
- **1차 시도 macOS 가 draft 생성 403** — 내가 릴리스 도중 워크플로 PR #72 를 머지해 태그 커밋과 main 의 워크플로가 갈라졌다(별도 일지). `target_commitish=main` draft 를 먼저 만들고 `--failed` re-run → 2차 시도 전부 success. 재발 방지 PR #73(공개 뒤 머지).

## 검증

- 공개 2026-10-07T15:02:54Z, `releases/latest` = v3.9.0, 자산 10(macOS 5 · Windows 2 · Linux 3), 본문 2,899자, latest.json `3.9.0` · 키 5(darwin-aarch64 · darwin-aarch64-app · linux-x86_64-appimage · windows-x86_64 · windows-x86_64-nsis). 태그는 그대로 `084acb50`.
- 내려받은 `.dmg` 교차 확인: Developer ID Application(BP57Z7L498) · runtime 플래그 · `spctl` accepted / Notarized Developer ID · 번들 버전 3.9.0.
- 랜딩 `landing/` 에서 `vercel --prod`(ocul-pm-landing): oculpm.com·/en softwareVersion 3.9.0, /changelog 앵커 116 · 맨 위 v3-9-0.
- 실기기 미확인: 설치본 자동 업데이트로 3.9.0 을 받은 뒤의 화면 머리·링크 거부 문구 (`compact-chrome` · `security-feedback-round-2` 의 eyes 항목).