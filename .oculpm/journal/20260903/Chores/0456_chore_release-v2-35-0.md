---
schema_version: 1
type: chore
slug: "release-v2-35-0"
status: done
difficulty: low
created_at: "2026-09-03T04:56:42+09:00"
session_id: "20260903-002"
agent:
  id: "claude-code"
  version: "Opus 5"
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
  - path: "src-tauri/Cargo.toml"
    op: update
related:
  - ref: "20260903/Bugs/0345_bug_pty-host-survives-protocol-bumps.md"
    kind: "followup"
  - ref: "20260903/Features_to_add/0345_feature_acp-session-id-visible.md"
    kind: "followup"
tags:
  - "release"
  - "landing"
  - "mcp-tool"
---
[x] v2.35.0 릴리스 — 5면 전부 반영 · 거짓이 된 FAQ 정정

## 변경 요약

`docs/RELEASE.md` 의 다섯 면을 전부 적었다.

1. **버전 5파일** — `package.json` · `tauri.conf.json` · `Cargo.toml` · `plugin.json` · `marketplace.json` → `2.35.0` (+ `landing/plugin.html` 배지 6곳, `plugin_manifest` 테스트가 동기를 강제).
2. **CHANGELOG.md** — `## v2.35.0` 두 문단 (PTY 호스트 · 세션 id). release.yml 이 이 섹션만 뽑아 릴리스 노트로 쓴다.
3. **README.md · README.en.md** — 양쪽 하이라이트 3줄.
4. **landing/** — 버전 문자열 6곳 × ko/en, 변경 이력 `<li>`, JSON-LD `featureList` 2줄, 벤토 셀 3개(한 줄), `node landing/wiki-src/build.mjs` 로 생성물 재빌드.
5. **커밋 → 태그 → 배포** — `9cddf96` → `v2.35.0` → `vercel --prod`.

## 거짓이 된 FAQ

「앱을 업데이트하면 터미널 세션이 끊기나요?」가 **"아니요, v2.19.0 부터는 끊기지 않습니다"** 라고 단언하고 있었다. v2.34.0~v2.34.1 은 실제로 끊었으므로 그 예외를 적었다 — 한국어·영어 각각 JSON-LD 와 `<details>` **네 곳**. 새 항목을 더하는 것보다 이쪽이 먼저라는 RELEASE.md §4-2 의 경고가 정확히 이 경우였다.

## 검증

커밋 전 게이트 전부 exit 0 (typecheck · vitest 2045 · lint · build · `cargo test` 1137). main CI 두 잡 `conclusion: success` 를 확인한 뒤에 태그를 밀었다. release.yml run 33672472181 성공 — 에셋 4개(`.dmg` · `.app.tar.gz` · `.sig` · `latest.json`), 릴리스 노트 1281자, draft 아님. 라이브 확인: `oculpm.com` · `oculpm.com/en` 둘 다 `softwareVersion 2.35.0`, `/changelog` 에 `id="v2-35-0"` 앵커(릴리스 85개).