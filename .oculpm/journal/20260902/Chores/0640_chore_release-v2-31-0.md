---
schema_version: 1
type: chore
slug: release-v2-31-0
status: done
difficulty: easy
created_at: 2026-09-02T06:40:00+09:00
session_id: manual-20260902-064000
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/Cargo.lock
    op: update
  - path: plugin/oculpm/.claude-plugin/plugin.json
    op: update
  - path: .claude-plugin/marketplace.json
    op: update
  - path: CHANGELOG.md
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
  - path: landing/index.html
    op: update
  - path: landing/en/index.html
    op: update
  - path: landing/plugin.html
    op: update
  - path: landing/wiki-src/pages.mjs
    op: update
related:
  - .oculpm/journal/20260902/Features_to_add/0550_feature_landing-phase8.md
  - .oculpm/planner/osaurus-bench-round.md
tags:
  - release
  - landing
---

[x] v2.31.0 릴리스 — Phase 8 을 5면에 적고 태그·랜딩 배포까지

## 배경

Osaurus 라운드의 마지막 Phase(랜딩)를 릴리스로 닫는다. 플랜의 릴리스 매핑이
`v2.31.0 = P8` 이었다.

## 한 일

`docs/RELEASE.md` 순서대로 다섯 면:

- **버전 5파일** → 2.31.0 (`Cargo.lock` 의 `ocul-pm` 항목까지 — CI 가
  `--locked` 로 돌아 어긋나면 붉게 난다)
- **CHANGELOG** `## v2.31.0` — release.yml 의 awk 가 뽑을 본문 1,269자
- **README ko/en** 하이라이트 교체, 직전 v2.30.0 섹션은 🚀 를 떼어 강등
- **landing** 버전 6곳 × 2로케일 · JSON-LD `featureList` 한 줄 × 2 ·
  새 FAQ「무엇이 밖으로 나가나요?」를 JSON-LD 와 `<details>` **네 곳** ·
  변경 이력 `<li>` × 2 · `plugin.html` 배지 · 생성물 재빌드
- 커밋 → 태그 → `vercel --prod`

**손으로 관리하는 버전 자리를 셋 줄였다.** 생성 페이지(changelog·themes·
privacy)의 nav 배지가 `pages.mjs` 에 하드코딩돼 있었다 — 이번 릴리스에서 바로
쓰레기가 될 자리였다. `package.json` 에서 읽게 바꿨다.

## 검증

**로컬 `cargo test` 가 이 환경에서 돌지 않았다.** tauri-build 의 사이드카
복사(`fs::copy`)가 빌드 스크립트 안에서만 `Operation not permitted` 로 죽는다
— 같은 복사를 셸에서 하면 성공한다(스크립트 밖에서는 `ln`/`fs::copy` 모두
정상). macOS 가 `com.apple.provenance`·`com.apple.macl` 이 붙은 링커 서명
바이너리에 거는 제약으로 보이고, `xattr -c`/`-d` 로는 지워지지 않는다.

그래서 **Rust 게이트를 CI 로 돌렸다** — RELEASE.md §0 이 요구하는 순서
("태그를 밀기 전에 main 의 CI 가 그린인지")와 같으므로 우회가 아니다.
`plugin_manifest` 의 버전 동기 단언 3종은 파일 읽기로 미리 재현해 통과를
확인한 뒤 푸시했다.

- CI `992a8db`: 프런트 · Rust 두 잡 모두 success (잡 단위 `conclusion` 확인)
- 로컬: `pnpm typecheck` · `test`(1808) · `lint` · `build` exit 0
- 배포 후 실물: `/themes` 200 text/html · `/themes/ink.json` 200
  application/json · `/changelog` 앵커 80개 · `/privacy` · `/wiki/automation`
  ko/en · `/plugin` · sitemap `daily` 1건 · `softwareVersion 2.31.0` ·
  영문 랜딩 `Get v2.31.0`

## 메모

**Phase 8 이 남겨 둔 유일한 미확인 지점이 해소됐다.** 페이지(`themes.html`)와
디렉터리(`themes/*.json`)가 `/themes` 를 공유하는데, Vercel 이 예상대로
갈라 준다 — 페이지는 HTML, 파일은 JSON 으로 200 이다. 딥링크가 가리키는
`https://oculpm.com/themes/ink.json` 이 실제로 살아 있으므로 「앱에서
가져오기」 경로가 끝까지 성립한다.

남은 것은 설치본에서의 딥링크 클릭 확인뿐이다 — `oculpm://` 스킴 등록은
번들된 `.app` 에서만 OS 에 반영되므로 이 릴리스를 받은 뒤에야 잴 수 있다.
