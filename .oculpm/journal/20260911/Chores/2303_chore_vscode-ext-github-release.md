---
schema_version: 1
type: chore
slug: "vscode-ext-github-release"
status: done
difficulty: low
created_at: "2026-09-11T23:03:37+09:00"
session_id: "20260911-013"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/extension-release.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "src-tauri/src/commands/open_native.rs"
    op: create
related: []
tags:
  - "release"
  - "vscode"
  - "extension"
  - "ci"
  - "mcp-tool"
---
[x] 확장 0.1.0 일단락 — PR #21·#22 main 머지, ext-v0.1.0 GitHub Release 에 .vsix, 마켓은 토큰 대기

## 작업 내용

- **PR #21**(확장 0.1.0 + v2.48.0 6면) — 공유 워킹트리가 다른 세션의 `feat/audit-round-20260911` 위였고 `main` 과 갈라져 있어, 임시 워크트리에서 내 파일만 명시 스테이징 → `main` 기준 브랜치에 cherry-pick → 4게이트·cargo fmt/clippy/테스트 초록 확인 → CI 4잡 초록 → rebase 머지(`5271bea`). 그 과정에서 잡은 것: `commands/oculpm.rs` 가 main 기준 800줄 래칫을 넘어 `open_native`/`open_native_url` 을 `commands/open_native.rs` 로 분리(egress 원장 자리 이동·사유 갱신), `VscodeExtensionBlock` 이 bindings 직접 임포트라 `@/api/vscodeExt.ts` 래퍼 신설+allowlist, 문서 표면 테스트의 한글 픽스처에 `i18n-ignore-next-line`. 머지 뒤 공유 워킹트리에서 내 미커밋 사본(순수 파일 restore·i18n 키 제거·bindings 재생성)을 걷어 다른 세션의 리베이스를 막지 않게 했다.
- **PR #22** — 사용자 결정(MS 등록은 보류): publish 잡이 `.vsix` 를 **GitHub Release 에 항상** 걸고, Open VSX·마켓 단계는 `env.<TOKEN> != ''` 일 때만(없으면 notice). `cf0aad2`.
- 태그 `ext-v0.1.0` → 잡 2개 성공 → https://github.com/bunhine0452/Ocul-PM/releases/tag/ext-v0.1.0 에 `ocul-pm-0.1.0.vsix`(82KB). 설치: `code --install-extension ocul-pm-0.1.0.vsix`.

## 검증

`gh run view` 잡 conclusion 둘 다 success, `gh release view ext-v0.1.0` 자산 1개. 마켓 게시는 토큰(`OPEN_VSX_TOKEN`·`VSCE_PAT`) 넣고 같은 run re-run — `{#rel-eyes}` 는 그때. 앱 `v2.48.0` 태그는 아직 안 밀었다(main 의 버전만 2.48.0).