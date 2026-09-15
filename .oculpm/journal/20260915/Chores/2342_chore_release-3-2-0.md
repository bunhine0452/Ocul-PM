---
schema_version: 1
type: chore
slug: "release-3-2-0"
status: done
difficulty: low
created_at: "2026-09-15T23:42:20+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
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
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
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
  - path: "landing/privacy.html"
    op: update
  - path: "landing/themes.html"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "changelog"
  - "3.2.0"
  - "mcp-tool"
---
[x] 릴리스 v3.2.0 — 확인은 내용에 묶입니다 (5면: 버전 6파일 · CHANGELOG · README ko/en · 랜딩 ko/en · build.mjs)

## 작업 내용

v3.1.1 → **v3.2.0**. 실린 것: Astra 리뷰 수용 라운드(PR #24) + 최적화 라운드 2(PR #25). 사용자에게 보이는 변화 — 「확인 뒤 내용이 변경됐어요 · 다시 검토」(verified_hash), 일지 동시 생성 유실 수정, file_guard 소유, 진단 탭 「워처 계측」, 지원 에이전트 4등급표, 배포 게이트+서명 검증, 800줄 상위 7 분할, AI 컨텍스트 왕복 4→2, 확장 vitest CI.

### 5면
1. **버전 6파일 + 랜딩 ko/en 각 6곳** — `bump-version.mjs 3.2.0 --title-ko "확인은 내용에 묶입니다" --title-en "a review is bound to the content"`. `landing/plugin.html`·`en/plugin.html` nav-ver 는 손으로(스크립트 범위 밖). `Cargo.lock` 은 `cargo test --test plugin_manifest`(unlocked) 로 갱신 — `--locked` 는 lock 갱신을 거부한다.
2. **CHANGELOG `## v3.2.0`** — 리드 문단(확인 표시가 700건 중 8건이던 이유와 해법) + 항목 6. 3.1.1 이 붉은 커밋에서 나갔던 사실을 공개적으로 적음.
3. **README ko/en** — `## 🚀 v3.2.0` 하이라이트 6줄, 3.1.1 의 🚀 내림.
4. **랜딩 ko/en** — 변경 이력 `<li>`, JSON-LD featureList 맨 위에 「확인이 내용에 묶입니다」 + 「서명된 배포」 항목에 draft→검증→공개 한 문장, 벤토 셀 1개(53→54 = 18행 × 3 맞춤), FAQ 「확인 표시를 한 뒤 에이전트가 고치면?」을 `<details>` 와 JSON-LD 양쪽에. en 의 featureList 편집에서 정규식이 `\"` 이스케이프에서 끊겨 문장이 중간에 박혔던 것을 JSON 파싱으로 잡아 수정.
5. `node landing/wiki-src/build.mjs` — changelog.html(v3.2.0 앵커)·themes·privacy·sitemap 재빌드.

## 검증

- 랜딩 두 파일 JSON-LD 파싱 OK, `3.1.1` 잔존은 변경 이력 `<li>` 뿐. 벤토 54셀.
- `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` 218파일 2740/2740(`landing_pages` 의 CHANGELOG==package.json 검사 포함) · `pnpm build` 0 · `cargo test --test plugin_manifest` 12 통과 · 전체 `cargo test --locked` 는 커밋 전 확인(#merge-gates 규율).
- 태그 푸시 → release.yml **첫 실전**(gate → draft → codesign/spctl/stapler/updater 검증 → undraft) 관찰은 #eyes-release-gate.