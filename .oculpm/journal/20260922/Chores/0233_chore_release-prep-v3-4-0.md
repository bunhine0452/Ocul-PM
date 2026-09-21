---
schema_version: 1
type: chore
slug: "release-prep-v3-4-0"
status: done
created_at: "2026-09-22T02:33:50+09:00"
session_id: "mcp-20260922-023350"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
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
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
related:
  - ref: "20260922/Features_to_add/0144_feature_resume-context-and-card.md"
    kind: "followup"
tags:
  - "release"
  - "v3.4.0"
  - "mcp-tool"
---
[x] v3.4.0 배포 준비 — 다른 세션 라운드(journal-scale) 위에 first-record-loop 통합, 다섯 면 갱신, PR #29 머지 (태그·랜딩 배포는 승인 대기)

## 상황

로컬 main 과 origin/main 이 갈라져 있었다 — 원격에는 다른 세션의 journal-scale-round(PR #26·#27·#28, 20/20)가 머지돼 있고, 로컬에는 first-record-loop 4커밋 + 다른 세션의 `fix(shell)` 숨은 탭 누수(9ab966b6)가 있었다. 로컬 작업 트리에는 또 다른 세션의 미커밋 WIP(확인 대화상자·터미널 키)가 남아 있고 claude 프로세스 5개가 살아 있어 **main 워킹트리를 건드리지 않았다** (stash·rebase 금지).

## 한 일

1. `../ai-pm-release` 워크트리를 `origin/main` 에서 열고(`release/v3.4.0`) 로컬 5커밋을 체리픽. 충돌은 둘뿐 — `src/api/oculpm.ts` 타입 import(`Velocity` vs 세션 이벤트 타입), `oculpm/mod.rs` 모듈 목록(`related`·`rollup` vs `resume`). i18n·bindings·TodayScreenV2 는 git 이 인접 추가를 깨끗이 합쳤고, `export_bindings_typescript` 재생성 결과가 무변경이라 바인딩 정합을 확인했다.
2. 다섯 면: `bump-version.mjs 3.4.0`(버전 6파일 + 랜딩 ko/en 12곳), 플러그인 페이지 배지 2곳, CHANGELOG `## v3.4.0`(첫 기록 카드·이어하기·일지 700건 라운드·숨은 탭 누수), README ko/en 하이라이트(옛 🚀 강등), 랜딩 ko/en 변경 이력 `<li>`·featureList 3·벤토 3(첫 기록/이어하기/일지 700건)·FAQ 1(details+JSON-LD), `node landing/wiki-src/build.mjs` 재빌드(changelog·themes·privacy·sitemap 41).
3. 게이트(워크트리, 공유 CARGO_TARGET_DIR): typecheck·test 2797·lint(6, extension 은 `pnpm -C extension install` 뒤)·build·`cargo test` 36 스위트 exit 0, Cargo.lock 갱신 포함.
4. PR #29 → CI 3잡 success → `gh pr merge --rebase`. origin/main = `64255e88`(release 커밋), 그 커밋의 main CI run 35631925456 도 success — release.yml 게이트 조건 충족.
5. 랜딩 배포용 `landing/.vercel` 링크를 워크트리에 복사해 두었다.

## 남은 것 (사용자 승인 뒤)

- `git tag v3.4.0 64255e88 && git push origin v3.4.0` → release.yml(gate→build→서명·공증 검증→undraft)
- `cd ../ai-pm-release/landing && vercel --prod --yes`
- 로컬 main 동기화는 다른 세션 WIP 가 정리된 뒤: `git rebase origin/main`(체리픽된 커밋은 자동 생략) 또는 WIP 커밋 후 reset.
- 워크트리 `../ai-pm-release` 는 배포 뒤 제거.