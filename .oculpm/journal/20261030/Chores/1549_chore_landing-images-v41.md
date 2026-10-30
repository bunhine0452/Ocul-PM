---
schema_version: 1
type: chore
slug: "landing-images-v41"
status: done
difficulty: medium
created_at: "2026-10-30T15:49:00+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/banner.png"
    op: update
  - path: "landing/banner-en.png"
    op: create
  - path: "landing/og.png"
    op: update
  - path: "landing/og-en.png"
    op: create
  - path: "landing/social-preview.png"
    op: update
  - path: "landing/demo.gif"
    op: update
  - path: "landing/demo-en.gif"
    op: create
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/wiki-src/build.mjs"
    op: update
related: []
tags:
  - "랜딩"
  - "landing"
  - "images"
  - "mcp-tool"
---
[x] 랜딩: 배너·미리보기·데모를 4.1 화면으로 교체

## 한 일

사용자 요청: 「배너와 스크린샷 모든 것들 다 업데이트」.

| 파일 | 전 | 후 |
|---|---|---|
| `landing/banner.png` · 새 `banner-en.png` | 옛 이름 Ocul-PM, 동심원 장식, 대문자 이름표(README 둘이 같은 영어 배너) | 어두운 무대 + 헤드라인(ko/en) + 실제 4.1 오늘 화면 창, 2400×750 |
| `landing/og.png` · 새 `og-en.png` | 1200×1200 그라디언트 + 빛 번짐, Ocul-PM | 1200×630, 같은 구성. 영어 페이지 · 영어 플러그인 · 영어 위키는 og-en. 메타 `og:image:height` 를 630 으로 |
| `landing/social-preview.png` | 그라디언트 | 1280×640 같은 구성(GitHub 저장소 설정에서 직접 올려야 반영) |
| `landing/demo.gif` · 새 `demo-en.gif` | 3.x 영상 | 4.1 창: 오늘 → 질문에 답 → 터미널이 받음 → 작업 일지 → 계획 → 변경. 800px · 1.3MB, 짧은 교차 페이드 |
| README 화면 구성 | 「스크린샷은 다시 찍는 중(3.x)」 | 실제 4.1 화면 네 장(ko/en) |

- 원본은 `scripts/landing-images/*.html` 이다(랜딩 home.css 토큰 · 자체 호스팅 글꼴 · shots/v4). 옛 og.svg · social-preview.svg 는 지웠다.
- 위키 생성기의 og 를 언어별로 나눴고, theme-color 를 #121514 로 바꿨다. `build.mjs` 로 다시 구웠다.
- 모든 새 래스터에 출처를 넣었다(PNG tEXt, GIF 는 json 사이드카).

## 검증

- `pnpm vitest run src/__tests__/bump_version.test.ts src/__tests__/landing_pages.test.ts` → Tests 18 passed
- `node landing/wiki-src/build.mjs` → sitemap.xml 35 urls
- 렌더 결과를 눈으로 확인했다: og-ko · og-en · banner-ko, 데모 GIF 의 첫 프레임 · 터미널 프레임.