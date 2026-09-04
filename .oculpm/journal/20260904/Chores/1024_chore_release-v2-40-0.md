---
schema_version: 1
type: chore
slug: "release-v2-40-0"
status: done
difficulty: low
created_at: "2026-09-04T10:24:02+09:00"
session_id: "20260904-006"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
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
  - path: "landing/changelog.html"
    op: update
related: []
tags:
  - "release"
  - "v2.40.0"
  - "mcp-tool"
---
[x] v2.40.0 배포 — 넷을 띄우면 넷으로 보인다

## 동기

v2.39.1 이후 미출시 커밋이 여섯이었다 — 병렬 세션 인식, 터미널 세션 색·일감 수·Codex 아이콘, 코드 트리 손 이동 네 라운드, 세션 화면 분리, 그리고 래칫 빚 정리. 기능 라운드가 둘이라 마이너를 올렸다.

## 변경 요약

**릴리스 전 감사에서 잡은 넷을 먼저 고쳤다** (별도 일지 `0926_bug_pre-release-audit-fixes`). 게이트가 전부 초록인 채로 남아 있던 것들이라, 그중 하나(파일 크기 래칫의 미추적 사각지대)는 게이트 자신의 구멍이었다.

**다섯 면을 전부 적었다.**

- 버전 **6파일** + `Cargo.lock`
- `CHANGELOG.md` — `## v2.40.0` (릴리스 노트의 유일한 소스)
- `README.md` · `README.en.md` — 하이라이트 + 「세션」 화면 항목을 **양쪽에**
- 랜딩 **ko·en 각 6곳** + 변경이력 `<li>` · JSON-LD `featureList` · FAQ(가시 + JSON-LD) · 벤토 3셀 · `plugin.html` 배지
- `node landing/wiki-src/build.mjs` 재빌드

**문서가 실제 표면보다 뒤처져 있었다.** `docs/RELEASE.md` 는 버전을 「5파일」이라 적어 두었는데 v2.39.0 에 생긴 `plugin/oculpm-codex/.codex-plugin/plugin.json` 이 빠져 있었고, 랜딩도 `index.html` 만 적어 두어 **영문 랜딩이 옛 버전에 멈출 뻔했다** (`build.mjs` 가 굽지 않는 손 편집 면이다). 둘 다 고쳐 `182051f` 로 커밋했다.

## 검증

게이트를 **체인으로** 확인했다: typecheck · `pnpm test` 2197 · `pnpm lint` 전체 · build · `cargo test` 20 스위트 · `clippy -D warnings` · `fmt --check` 전부 exit 0.

태그를 밀기 전에 **main CI 가 초록인지 conclusion 으로 확인**했다 — run 33821970448(`182051f5`) 두 잡 모두 success. 그 앞의 45fe8a2 런은 새 푸시에 밀려 `cancelled` 로 끝났으므로 판정 재료가 아니다.

발행된 결과:

- 릴리스 `Ocul-PM v2.40.0` — draft 아님, prerelease 아님, 본문 2,248자
- 에셋 4개 — `latest.json` · `Ocul-PM_2.40.0_aarch64.dmg`(27.6MB) · `Ocul-PM_aarch64.app.tar.gz`(28.2MB) · `.sig`
- 업데이터 매니페스트가 `version = 2.40.0`, 서명 포함, 플랫폼 둘(`darwin-aarch64`, `darwin-aarch64-app`)
- 랜딩 라이브 — `oculpm.com` · `oculpm.com/en` · `/changelog` 전부 v2.40.0