---
schema_version: 1
type: chore
slug: "release-v2-33-0"
status: done
difficulty: medium
created_at: "2026-09-02T13:34:26+09:00"
session_id: "20260902-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
language: "ko"
verified_by_user: false
files_touched:
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
  - path: "landing/changelog.html"
    op: update
  - path: "landing/themes.html"
    op: update
  - path: "landing/privacy.html"
    op: update
  - path: ".oculpm/planner/acp-adapter-073.md"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "changelog"
  - "ci"
  - "mcp-tool"
---
[x] v2.33.0 릴리스 — 「AI 가 만든 티」를 걷어낸 화면 · ACP·일지·터미널 결함 수리 (PR #11 rebase 머지 · release.yml 성공 · 랜딩 배포)

## 작업 내용

사용자 지시 「다른 세션이 만든 변경사항도 확인하고 다음 릴리즈 배포해」.

**다른 세션의 변경 검토.** 브랜치 `fix/acp-idle-spin-and-per-session-config` 에 세 커밋이 main 보다 앞서 있었다 — fix(acp) 8d62c76(되읽기 고리 · 대화별 장부) · fix(journal) c8ebf11(본문 검색 되버림 외 6건) · fix(terminal) 7792b9e(빠른 터미널 프로젝트 간 세션 충돌 · 끝난 셸 «다시 시작» 외). 셋 다 일지(1121 · 1152 · 1230)에 원인·해결·검증이 적혀 있고 각 세션이 게이트를 통과시킨 상태였다. 미커밋으로 남아 있던 것은 그 세션이 v2.32.0 릴리스를 마치며 갱신한 플랜 로그(`acp-adapter-073.md`) 한 파일 — `docs(plan)` 커밋으로 올렸다. 이 세션의 de-AI 라운드는 `refactor(design)` 커밋으로 별도 기록했다.

**버전 결정.** v2.33.0(마이너) — 디자인 라운드가 화면 전반에 보이는 변화라 패치로 두지 않았다.

**다섯 면 기재 (docs/RELEASE.md).**
- 버전 5파일(package.json · tauri.conf.json · Cargo.toml · plugin.json · marketplace.json) + Cargo.lock(`cargo test --test plugin_manifest` 로 갱신·동기 검증).
- CHANGELOG `## v2.33.0` — 다섯 단락: 「AI 가 만든 티」 제거 · 테마가 어느 화면에서도 온전히 · 빠른 터미널 프로젝트 격리 · 일지 본문 검색 · Claude Code 유휴 트래픽.
- README ko/en — 🚀 v2.33.0 하이라이트 4항목, v2.32.0 은 일반 섹션으로.
- landing ko/en — 버전 6곳(softwareVersion · nav-ver · ap-new · 히어로/CTA 받기 버튼 · eyebrow) + `update-points` 새 `<li>`. ap-new 문구가 두 릴리스 전 태그라인(v2.31.0 것)을 번호만 바꿔 달고 있던 것을 이번 릴리스 문구로 고쳤다. plugin.html 배지 6곳(nav-ver + 동봉 스킬 pill 5). `node landing/wiki-src/build.mjs` 로 changelog/themes/privacy/sitemap 재빌드(릴리스 82개, 최신 v2.33.0).
- 기능 추가가 아니라 featureList·FAQ·벤토 셀은 손대지 않았다.

**흐름.** 게이트(typecheck · test 150/1871 · lint 4종 · build · cargo test 1110+통합 · fmt) → 릴리스 커밋 17bc689 → 브랜치 푸시 → PR #11 → CI 두 잡 success → `gh pr merge --rebase --delete-branch` → main fa49a53 · CI success → `git tag v2.33.0` · 태그 단독 푸시 → release.yml 33589207316 success(에셋 4: dmg · app.tar.gz · sig · latest.json, 노트 2028자) → `cd landing && vercel --prod --yes` → 라이브 softwareVersion 2.33.0(ko/en) · changelog `#v2-33-0` 앵커 확인.

## 남긴 것

- 랜딩·README 의 스크린샷(`landing/shots/*.jpg`)은 옛 디자인(KPI 색상자·스파클)이다 — 앱을 끄고 재촬영해야 한다(영문 스크린샷 이월 항목 `first-run-and-english-landing #en-shots` 와 함께).
- 실기기 육안 확인은 아직 미완(설치본 실행 중 dev 빌드 금지 규율). 자동 업데이트로 v2.33.0 이 설치되면 오늘 현황·AI 패널·설정·그린필드 네 화면을 보면 된다.

## 검증

- PR CI(33588356311) · main CI(33588772965) · release.yml(33589207316) 전부 conclusion `success` — `gh run view` 의 잡 단위 conclusion 으로 확인(watch 의 exit 0 만 믿지 않음).
- `gh release view v2.33.0`: 에셋 4개, 본문 2028자(CHANGELOG 헤더 == 태그).
- `curl https://oculpm.com/` · `/en` → `"softwareVersion": "2.33.0"`, `/changelog` → `<h2 id="v2-33-0">` 최상단.