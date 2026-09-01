---
schema_version: 1
type: chore
slug: release-v2-27-0
status: done
difficulty: low
created_at: 2026-09-01T11:36:00+09:00
session_id: manual-20260901-113600
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
related:
  - 20260901/Features_to_add/1113_feature_provenance-phase3.md
  - 20260831/Features_to_add/2047_feature_watcher-automation-phase2.md
tags:
  - release
  - osaurus-bench
---

[x] v2.27.0 릴리스 — Phase 2+3 한 버전 · 5면 전부

## 무엇을 했나

Osaurus 라운드 Phase 2(감시 자동화)와 Phase 3(출처·상태 가시화)를 **한
버전으로** 내보냈다. 릴리스 매핑(마스터 플랜 §4)은 P2=v2.27.0 · P3=v2.28.0 을
권했지만 **P2 는 커밋만 되고 태그가 나가지 않은 상태**였다(최신 태그 v2.26.0).
번호를 건너뛰면 사용자가 보는 변경 이력에 없는 버전이 생기므로 v2.27.0 하나로
합쳤다 — v2.26.0 이 두 라운드를 한 버전에 실은 것과 같은 판단이다.

5면 (`docs/RELEASE.md`):

1. **버전 5파일** — `package.json` · `tauri.conf.json` · `Cargo.toml` ·
   `plugin/oculpm/.claude-plugin/plugin.json` · `.claude-plugin/marketplace.json`.
   뒤 둘은 `cargo test --test plugin_manifest` 가 앱 버전과의 동기를 강제한다.
2. **CHANGELOG.md** — `## v2.27.0` (릴리스 노트의 유일한 소스, 태그와 헤더 일치).
3. **README.md · README.en.md** — 양쪽 하이라이트 갱신, 직전 v2.26.0 은 🚀 를
   떼어 아래로.
4. **landing/index.html** — 버전 문자열 6곳 + JSON-LD `featureList` 4줄 +
   변경사항 `<li>` + 벤토 셀 3개(한 줄) + FAQ. FAQ 는 `<details>` 와 JSON-LD
   **두 곳 모두**에 넣었고, 기존 v2.26.0 스케줄 FAQ 가 "자동화 = 시계" 로만
   읽히지 않게 감시 축 한 문장을 덧댔다.
5. **태그 → CI 빌드 → 랜딩 배포** (아래 검증).

## 검증

커밋 전 게이트 전부 exit 0 을 직접 확인: `pnpm typecheck` · `pnpm test`
(131파일 1599건) · `pnpm lint`(storage·i18n·bindings) · `pnpm build` ·
`cargo test`(plugin_manifest 7건 포함) · `cargo clippy --all-targets -D warnings` ·
`cargo fmt --check`.

랜딩은 `grep -n "2\.26\.0" landing/index.html` 로 잔존 문자열을 전수 확인 —
남은 둘은 변경 이력 `<li>` 와 "v2.26.0 부터" 라고 적은 FAQ 로, 둘 다 과거를
가리키는 정상 문장이다. JSON-LD 두 블록은 `json.loads` 로 파싱을 확인했다.

## 메모

로컬 빌드는 하지 않는다 — 태그 푸시가 `release.yml` 에서 굽고 서명한다.
랜딩은 git 연동이 없어 `cd landing && vercel --prod` 로 따로 나간다.
