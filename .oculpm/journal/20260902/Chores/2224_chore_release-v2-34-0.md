---
schema_version: 1
type: chore
slug: "release-v2-34-0"
status: done
difficulty: low
created_at: "2026-09-02T22:24:11+09:00"
session_id: "20260902-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
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
  - path: "docs/20260902_vscode-borrows/00-master-plan.md"
    op: update
  - path: "src-tauri/src/oculpm/history.rs"
    op: update
  - path: "src-tauri/tests/oculpm_history.rs"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "vscode-borrows"
  - "mcp-tool"
---
[x] v2.34.0 릴리스 — VS Code 차용 라운드 마감 (5면 + 랜딩 배포)

vscode-borrows 라운드 Phase 1~6(저장 위생·자동 저장 · 미리보기 탭 · ⇧⌘O/⌃G · 스티키 스크롤 · 문제 패널 · 로컬 히스토리)과 svg 인라인 미리보기, 터미널 세 가지 수리를 묶어 냈다.

## 무엇을 했나

`docs/RELEASE.md` 의 다섯 면을 순서대로.

- **버전 5파일** — package.json · tauri.conf.json · Cargo.toml · plugin.json · marketplace.json (+ Cargo.lock). `cargo test --test plugin_manifest` 가 동기를 확인.
- **CHANGELOG** — `## v2.34.0` 다섯 문단. 릴리스 노트의 유일한 소스라 헤더를 태그와 정확히 맞췄다.
- **README ko/en 양쪽** — 새 🚀 섹션 6줄, 이전 버전은 🚀 를 뗐다. 「화면 구성 / Screens」의 **코드** 항목에 신규 기능 일곱을 반영.
- **landing** — 버전 문자열 6곳 × 2(한/영) + `plugin.html` 배지, JSON-LD `featureList` 2줄, 변경 이력 `<li>`, 벤토 3칸(한 줄 = `c-span2` ×3), FAQ. FAQ 는 **기존 답변이 거짓이 되는 쪽을 먼저** 고쳤다 — 「svg 는 그림이자 곧 코드라 편집기로 열립니다」가 이번 svg 미리보기와 충돌해, JSON-LD 와 `<details>` 두 곳 모두 갱신. `node landing/wiki-src/build.mjs` 로 changelog·themes·privacy·sitemap 재빌드.
- **docs 동기** — `docs/20260902_vscode-borrows/00-master-plan.md` 를 「구현 완료」로 바꾸고 **구현 중 뒤집힌 결정 9건**을 적었다(로컬 히스토리만 기본 켜짐이 된 이유 = 설정은 켜는 순간부터 듣지만 히스토리는 소급되지 않는다, 전부 빈 줄인 파일은 손대지 않음 = VS Code 와 의도적 분기, 되돌리기는 목록이 아니라 비교 배너에, 등).

## 중간에 잡은 것 — 붉은 CI 하나

첫 푸시에서 main CI 의 Rust 잡이 붉었다. **로컬은 통과, 러너에서만 실패** — `oculpm_history` 두 건. 원인은 테스트가 아니라 결함이었다: `ts_ms` 가 판의 신원인데 같은 밀리초에 두 판이 들어오면 신원이 겹쳐, 읽기가 남의 판을 돌려주고 예산 정리가 「하나 지우기」 지시로 둘을 함께 지웠다. 캡처 시각을 파일 안에서 1ms 씩 밀어 유일하게 만들고(`f7317fa`), 시계에 기대지 않는 회귀 테스트를 붙였다. 로컬 히스토리는 v2.34.0 이 첫 릴리스라 이 형태로 남은 사용자 데이터는 없다.

## 검증

- 게이트 — `pnpm typecheck` · `test` · `lint` · `build` 전부 exit 0 · `cargo test` 1210 통과 · fmt · clippy `-D warnings`.
- main CI **그린 확인 후** 태그를 밀었다(`gh run view` 의 잡별 conclusion 으로 판정 — `--exit-status` 는 취소도 0 이다).
- 랜딩 — `cd landing && vercel --prod --yes` → `oculpm.com` 별칭. 라이브가 `softwareVersion 2.34.0`, `/changelog` 앵커 83개, `/api/notion/oauth/start` 400(살아 있음)인 것까지 확인.

## 메모

남은 것은 **육안 1회** 뿐이다 — 설치본을 끄고 dev 로 일곱 가지를 한 바퀴 보는 항목이라 사람 손이 필요하다(설치본 도는 중 dev 빌드 금지 규율). release.yml 빌드 결과와 에셋 4개는 별도로 확인한다.