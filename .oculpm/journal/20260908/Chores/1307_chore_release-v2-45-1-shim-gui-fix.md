---
schema_version: 1
type: chore
slug: "release-v2-45-1-shim-gui-fix"
status: done
difficulty: medium
created_at: "2026-09-08T13:07:30+09:00"
session_id: "20260908-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
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
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related:
  - ref: "20260908/Bugs/1209_bug_shim-unknown-verb-launched-gui.md"
    kind: "followup"
tags:
  - "release"
  - "notarization"
  - "worktree"
  - "verification"
  - "mcp-tool"
---
[x] v2.45.1 — 유령 창 패치 배포 (main 워크트리에서 태운 첫 릴리스)

## 동기

같은 세션에서 고친 심(shim) 유령 창 버그를 빠르게 내보내는 릴리스. 내용은 그 버그 수정 하나뿐이다 — [20260908/Bugs/1209_bug_shim-unknown-verb-launched-gui.md](20260908/Bugs/1209_bug_shim-unknown-verb-launched-gui.md).

## 변경 요약

**작업 브랜치에서 태그를 태우지 않았다.** 작업 중이던 `feat/v3-release-round` 는 main 보다 **25 커밋 뒤**였고, 워킹트리에는 다른 흐름의 미커밋 WIP(터미널 파일 링크 메뉴)가 얹혀 있었다. 브랜치를 갈아타면 그 WIP 가 위험해지고, 그 브랜치에 태그를 밀면 main 에 있는 20여 커밋이 릴리스에서 빠진다.

그래서 **`git worktree` 로 origin/main 위에 별도 작업 사본**을 만들어 거기서 릴리스를 진행했다. 사본에는 수정 3파일만 패치로 옮겼다.

- 게이트를 사본에서 다시 전부 돌렸다. `node_modules` 는 의존성이 동일함을 확인하고 심링크로 재사용, `CARGO_TARGET_DIR` 은 원본 target 을 가리켜 전체 재빌드를 피했다.
- `docs/RELEASE.md` 의 5면을 전부 갱신 — 버전 6파일 · CHANGELOG · README ko/en · 랜딩 ko/en 각 6곳 + `plugin.html` + `build.mjs` 재빌드.
- 정리할 때 **`node_modules` 심링크를 먼저 지우고** 워크트리를 제거했다 (`worktree remove --force` 가 심링크를 따라가 원본을 지우는 사고를 피한다).

## 검증

- 게이트 — typecheck 0 · vitest **2455 passed** · lint 에러 0 · build 0 · `cargo test` 0
- main CI — 3잡 전부 `success` (프런트 / Rust+bindings 신선도 / cargo-deny). 태그는 그린을 본 뒤에 밀었다
- release.yml run `34183800292` `success`, 에셋 4개(`.dmg` · `.app.tar.gz` · `.sig` · `latest.json`), 릴리스 노트 본문 874자(빈 노트 아님)
- **출시된 `.dmg` 를 내려받아 §6 확인** — `Authority=Developer ID Application: Hyunbin Kim (BP57Z7L498)` · `flags=0x10000(runtime)` · `Notarization Ticket=stapled` · `spctl: accepted / source=Notarized Developer ID` · `stapler validate` 통과 · 번들 버전 2.45.1
- 랜딩 — `oculpm.com` · `/en` · `/plugin` · `/changelog` 모두 2.45.1 라이브

## 메모

`gh run watch --exit-status` 대신 **잡 단위 `conclusion`** 으로 판정했다 (취소된 run 도 exit 0 으로 나오는 함정). 공증 왕복 때문에 릴리스 run 은 약 40분 걸렸다 — 예상보다 길지만 정상 범위다.