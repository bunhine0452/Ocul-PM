---
schema_version: 1
type: feature
slug: landing-phase8
status: done
difficulty: medium
created_at: 2026-09-02T05:50:00+09:00
session_id: manual-20260902-055000
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: landing/page.css
    op: create
  - path: landing/wiki-src/md.mjs
    op: create
  - path: landing/wiki-src/pages.mjs
    op: create
  - path: landing/wiki-src/build.mjs
    op: update
  - path: landing/changelog.html
    op: create
  - path: landing/themes.html
    op: create
  - path: landing/privacy.html
    op: create
  - path: landing/themes/ink.json
    op: create
  - path: landing/themes/ember.json
    op: create
  - path: landing/plugin.html
    op: update
  - path: landing/wiki-src/automation.md
    op: create
  - path: landing/wiki-src/en/automation.md
    op: create
  - path: landing/index.html
    op: update
  - path: landing/en/index.html
    op: update
  - path: landing/sitemap.xml
    op: update
  - path: src-tauri/src/commands/themes.rs
    op: update
  - path: src-tauri/src/deeplink.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/tests/plugin_manifest.rs
    op: update
  - path: src/features/theme/themeInstallIntent.ts
    op: create
  - path: src/features/theme/ThemeGallery.tsx
    op: update
  - path: src/api/themes.ts
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/__tests__/landing_pages.test.ts
    op: create
  - path: src/__tests__/landing_themes.test.ts
    op: create
  - path: src/__tests__/plugin_docs_sync.test.ts
    op: update
  - path: src/__tests__/plugin_skills_sync.test.ts
    op: update
  - path: src/__tests__/deep_link.test.tsx
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
  - path: docs/RELEASE.md
    op: update
related:
  - .oculpm/planner/osaurus-bench-round.md
  - .oculpm/journal/20260901/Features_to_add/1915_feature_declarative-config-plugins-phase6.md
tags:
  - landing
  - seo
  - themes
  - privacy
  - phase8
---

[x] `/changelog` · `/themes` · `/privacy` · `/automation` 가이드 · 스킬 카탈로그 · 릴리스 절차

## 배경

Osaurus 라운드 Phase 8 (마지막). 설계는
[06-landing.md](../../../../docs/20260831_osaurus-bench/06-landing.md).

Phase 8 이 마지막인 이유가 이 일의 성격을 말한다 — **없는 기능을 미리
광고하지 않는다.** 그래서 이 라운드에서 실제로 만든 것(자동화·테마 파일·
플러그인 임포트)만 웹 표면으로 꺼낸다.

## 한 일

### 랜딩 빌더가 됐다 (`build.mjs`)

`node landing/wiki-src/build.mjs` 한 줄이 위키 34면 + `changelog.html` +
`themes.html` + `privacy.html` + `sitemap.xml` 을 전부 굽는다.

마크다운 렌더러를 `md.mjs` 로 뺐다 — 변경 이력이 위키와 **같은 렌더러**를
쓰게 하려고. 두 벌이면 위키에서 되는 표기가 변경 이력에서 조용히 깨진다.

sitemap 을 쓰는 곳을 하나로 유지한 것이 핵심이다. 생성기를 따로 만들면
sitemap 이 둘이 되고, 그때부터 새 페이지가 색인되지 않는다 (2026-08-21 에
위키 5면이 그렇게 누락됐다).

### `/changelog` — 릴리스 79개 전문

`CHANGELOG.md` 를 잘라 버전 앵커(`#v2-30-0`)와 함께 렌더한다. sitemap 에서
**`changefreq: daily` 는 이 페이지 하나뿐**이고, `lastmod` 는 CHANGELOG.md 의
마지막 커밋 날짜라 손으로 관리하지 않는다.

같은 파일에서 이 페이지와 GitHub 릴리스 노트가 함께 나온다 — 세 곳(앱 업데이트
탭 · 웹 · GitHub)이 어긋날 수 없다.

### `/themes` — 갤러리 + 딥링크가 **실제로** 설치한다

내장 5종은 「앱 내장」 배지만, 배포 테마는 딥링크와 `.json` 내려받기를 준다.
미리보기는 그 테마의 실제 토큰 값으로 그리고, **지정하지 않은 색은 가족
기본값**(`tokens.css` 의 `:root` / `[data-theme="dark"]`)을 물려받는다 — 앱이
칠하는 방식과 같아야 미리보기가 거짓말을 하지 않는다.

배포 테마 2종(Ink · Ember)을 만들어 실었다. 설치 경로가 실제로 도는지
보여 주는 표본이 없으면 「기여하세요」가 빈 말이 된다.

**딥링크가 하던 거짓말을 고쳤다.** Phase 6 의 시트는 「테마 파일을 받아
갤러리에 추가합니다」라고 말하고 승인하면 설정 화면만 열었다 — URL 은 버려졌다.
이제 `theme_import_url` 이 실제로 받아온다:

- https + 호스트 화이트리스트는 **딥링크와 같은 파서**(`validate_theme_url`)
- 크기 상한은 `Content-Length` 를 믿지 않고 읽으면서 센다
- 받은 뒤는 파일 임포트와 **같은 문**을 지난다 (임시 파일 → `theme_import`).
  그래서 검증·id 재발급·이름 충돌 질의가 한 벌뿐이고, 충돌 재시도도
  `source_path` 로 그대로 돌아온다 (다시 받지 않는다)
- 시트 → 갤러리 전달은 `settingsNav` 와 같은 끈적 플래그
  (`themeInstallIntent`). 갤러리가 충돌 UI 를 소유하므로 임포트도 거기서 한다

**무확인 실행 0 은 그대로다** — 승인 버튼을 지나지 않는 경로가 여전히 없다.

### `/privacy` — 나가는 것 **다섯**

설계 문서는 셋이라고 적었지만 코드를 세어 보니 다섯이었다. 임베딩 모델 최초
1회(`huggingface.co`)와 Notion 연동(옵인)이 빠져 있었다. 목록으로 못박는
페이지가 스스로 부정확하면 안 되므로 실측으로 고쳤다.

절대 안 나가는 것 · 배경 자동화의 세 가드 · `rg` 로 직접 세는 법 · 이 웹사이트
자신의 분석 스크립트까지 적었다. 끝에 영어 요약 한 문단.

### `plugin.html` — 스킬 카탈로그 + 깨진 스타일 복구

그 페이지는 2026-08-16 랜딩 재설계 **이전** 토큰(`--paper`·`--line`·
`--green-600`·`.foot`·`.nav .wrap`)을 쓰고 있었다 — 정의되지 않은 변수 위에
서 있어 화면이 깨진 채였다. 문서 페이지 네 장이 공유하는 `page.css` 로 옮겨
현재 디자인 언어에 맞췄다.

카탈로그 25종에 **고정된 커밋**(`ecc@e4e4163`) 배지와 원문 링크를 붙였다 —
"커밋 고정 사본" 이라는 주장을 그 자리에서 확인할 수 있게. 동봉 스킬 5종에는
버전 pill · SKILL.md 링크 · 딥링크.

### 게이트 넷

문서가 뒤처지는 것을 리마인더가 아니라 테스트로 막는다.

| 테스트 | 무엇을 막는가 |
|---|---|
| `plugin_docs_sync` | 카탈로그 스킬·핀 SHA·개수가 페이지와 어긋남 |
| `plugin_skills_sync` | 동봉 스킬의 딥링크·원문 링크 누락 |
| `plugin_manifest`(Rust) | 랜딩 버전 배지가 옛 버전에 멈춤 |
| `landing_pages` | changelog 재생성 누락 (CHANGELOG 맨 위 == package.json 버전) |
| `landing_themes` | PR 로 들어온 테마의 스키마·색 값·**본문 대비 4.5:1** |

`docs/RELEASE.md` §4 를 4-1(재빌드 한 줄)/4-2(손으로)로 갈랐다.

## 검증

`pnpm typecheck` · `pnpm test`(146 파일 / 1808 통과, 신규 24건) · `pnpm lint` ·
`pnpm build` · `cargo test`(1101 + 통합 스위트 전부) · `cargo fmt --check` ·
`cargo clippy --all-targets -D warnings` 전부 exit 0.

네 페이지를 로컬 서버에 띄워 실제로 렌더를 확인했다 (테마 미리보기·카탈로그
표·개인정보 2열·위키 자동화 면). 정적 HTML 이라 테스트가 문자열만 보므로,
스타일이 깨졌는지는 눈으로만 잡힌다 — plugin.html 이 깨진 채 있었던 것이 그
증거다.

## 메모

`/themes` 는 페이지(`themes.html`)와 디렉터리(`themes/*.json`)가 같은 경로를
쓴다. Vercel 정적 라우팅이 `/themes` → `themes.html`, `/themes/ink.json` →
파일로 갈라 주는 것에 기대고 있다 — **배포 후 실물 확인이 필요한 유일한 지점**
이다. 어긋나면 딥링크 URL 만 `raw.githubusercontent.com`(이미 화이트리스트)으로
돌리면 된다.

스킬·플러그인 딥링크는 여전히 승인 뒤 **설정 화면을 여는 데까지**만 한다
(시트의 버튼도 「미리보기」다 — 거짓말은 아니다). 번들을 받아 스킬 하나만
꺼내는 것은 테마 JSON 한 장과 규모가 다르므로 이 Phase 에 넣지 않았다.

Phase 8 로 osaurus-bench-round 의 9 Phase 가 전부 끝났다. 다음은 v2.31.0
릴리스 — 5면(버전 5파일 · CHANGELOG · README ko/en · landing) 을 채우고
`vercel --prod`.
