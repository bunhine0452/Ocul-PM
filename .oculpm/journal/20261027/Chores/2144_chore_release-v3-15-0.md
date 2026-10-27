---
schema_version: 1
type: chore
slug: "release-v3-15-0"
status: done
difficulty: low
created_at: "2026-10-27T21:44:36+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
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
  - path: "landing/privacy.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
related:
  - ref: "20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md"
    kind: "followup"
  - ref: "20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md"
    kind: "followup"
tags:
  - "release"
  - "landing"
  - "docs"
  - "mcp-tool"
---
[x] v3.15.0 릴리스 — 기록을 믿을 수 있게 (확인 날 없이, 사용자 결정)

## 변경 요약

v3.14.0 → v3.15.0, 마이너. 담긴 것은 오늘 main 에 합류한 셋 — PR #100(약속 문서·3등급·릴리스 리듬·경계 테스트), #101(일지 파서 복구·유령 색인 경합), #102(플러그인 드리프트·모델 정규화·증거 등급·닫힌 플랜 받은함·files_touched 추정·ACP 0.97.0).

**확인 날 없이 냈다.** `bump-version 3.15.0` 이 「마이너인데 육안 확인 대기 25건」을 경고했고(오늘 새로 들어간 4건 포함), 사용자가 "확인 날 안 하고 배포할거야" 로 결정했다. RELEASE.md §0-2 규칙대로 CHANGELOG 3.15.0 절 첫 줄과 랜딩 변경 이력에 그 사실을 적었다. 실기기 확인 4건은 플랜 `record-quality-round-20261027` 에 빚으로 남는다.

릴리스 5면: 버전 6파일(bump 스크립트) · CHANGELOG · README ko/en 하이라이트 절 · 랜딩 ko/en(버전 6곳 + JSON-LD featureList 3 + 벤토 셀 3 + 변경 이력 li) · plugin.html ko/en nav-ver · `build.mjs` 재생성(changelog·privacy·sitemap). Cargo.lock 은 `cargo metadata --offline` 로 3.15.0 에 맞췄다(cargo clean 직후라 `--locked` 가 먼저 막았다).

## 검증

- `pnpm typecheck` · `lint` · `test`(landing_pages 가 CHANGELOG 머리 == package.json 과 changelog.html 앵커를 잰다) · `build`, `cargo test --locked` — 커밋 전 전부 exit 0 확인.
- 태그 push 뒤 release.yml 의 gate 잡이 그 커밋의 CI 초록을 확인하고 빌드·서명한다. 랜딩은 release run 이 공개된 뒤 `vercel --prod`.