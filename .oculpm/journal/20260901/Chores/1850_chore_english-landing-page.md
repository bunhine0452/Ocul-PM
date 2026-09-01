---
schema_version: 1
type: chore
slug: english-landing-page
status: done
difficulty: medium
created_at: 2026-09-01T18:50:00+09:00
session_id: manual-20260901-184500
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: landing/en/index.html
    op: create
  - path: landing/index.html
    op: update
  - path: landing/landing.css
    op: update
  - path: landing/wiki-src/build.mjs
    op: update
  - path: landing/sitemap.xml
    op: update
  - path: README.en.md
    op: update
related:
  - .oculpm/journal/20260901/Features_to_add/1845_feature_first-run-wizard.md
tags: [landing, seo, i18n, marketing]
---

[x] 영문 랜딩 `/en` — 위키만 영어였고 정작 첫 페이지가 한국어였다

## 무엇을 했나

위키는 2026-08 에 ko/en 두 벌이 됐는데 **랜딩(첫 페이지)은 한국어 한 벌**이었다. 영어권 방문자가 `oculpm.com` 에 떨어지면 읽을 것이 없고, 영문 위키의 네비 「Features」는 한국어 랜딩으로 되돌려 보내고 있었다.

- **`landing/en/index.html` 신규** — 한국어 랜딩과 같은 구조(히어로 · 문제 제기 · 3막 · 벤토 30셀 · 키노트 배너 · 변경 이력 · 로컬-우선 · FAQ 19 · CTA · 푸터)를 영어로. 직역이 아니라 README.en.md 의 목소리를 따랐다("Agents write the code. You keep the memory.").
- **SEO** — canonical `/en` · hreflang 3(ko/en/x-default)을 **양쪽 페이지에** · `og:locale` + `og:locale:alternate` · JSON-LD 두 벌(SoftwareApplication featureList 55 · FAQPage 19)을 영어로. 자산은 루트 절대경로(`/landing.css` · `/shots/…`)라 하위 폴더에서도 같은 파일을 쓴다.
- **언어 전환** — `.nav-lang` 알약(한국어 ↔ English)을 네비와 푸터에. `.nav-links` 는 860px 아래에서 사라지므로 이 알약만 그때 `margin-left:auto` 를 물려받는다(둘 다 auto 면 flex 가 공간을 반씩 나눠 가운데로 벌어진다).
- **위키 네비** — `build.mjs` 의 로케일에 `home` 을 더해 영문 위키의 워드마크·「Features」가 `/en` 으로 간다. 재생성 diff 는 영문 16쪽의 두 줄뿐(한국어 쪽 무변경).
- **sitemap** — 손으로 관리하지 않는다(위키 빌더가 만든다). `STATIC_URLS` 에 `/en` 을 더하고 `/` ↔ `/en` hreflang 을 내보내게 했다 (36 URL).
- **README.en.md** — 사이트/위키 링크를 영문 표면(`/en` · `/wiki/en`)으로.

변경 이력은 영어권 독자 기준으로 편집했다 — v2.13.x 다섯 줄(전부 한글 입력기 버그)은 한 줄로 접었다.

## 검증

- HTML 파서로 양쪽 페이지 태그 균형 확인(미닫힘 0 · 오류 0), JSON-LD 2벌 `json.loads` 통과.
- 로컬 정적 서버(`python3 -m http.server`)로 크롬에서 육안 확인 — `/en` 히어로·벤토·CTA·푸터, `/` 네비의 English 알약, 700px 폭에서 네비 접힘까지.
- 영문 페이지에 남은 한글은 의도한 4곳뿐(언어 전환 2 · 벤토 셀 제목 · FAQ 문장).

## 메모

- **스크린샷은 여전히 한국어 UI** 다(`landing/shots/*.jpg`). 영어 페이지에서 가장 눈에 띄는 미완이라, 앱을 English 로 두고 다시 찍어 `landing/shots/en/` 으로 넣는 것이 다음 수순.
- 키노트(`/keynote`)·플러그인(`/plugin`)은 아직 한국어다. 키노트 배너에는 그 사실을 한 줄로 적어 뒀다.
- 랜딩은 git 연동이 없다 — 배포는 `cd landing && vercel --prod` (사용자 승인 대기).
