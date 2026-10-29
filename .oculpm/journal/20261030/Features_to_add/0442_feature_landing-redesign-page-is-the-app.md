---
schema_version: 1
type: feature
slug: "landing-redesign-page-is-the-app"
status: done
difficulty: high
created_at: "2026-10-30T04:42:08+09:00"
session_id: "20261030-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/home.css"
    op: create
  - path: "landing/fonts/pretendard-landing.woff2"
    op: create
  - path: "landing/shots/v4/ko/today.webp"
    op: create
  - path: "landing/demo.mp4"
    op: delete
  - path: "scripts/bump-version.mjs"
    op: update
  - path: "src/__tests__/bump_version.test.ts"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "PRODUCT.md"
    op: create
related: []
tags:
  - "landing"
  - "design"
  - "impeccable"
  - "mcp-tool"
---
[x] 랜딩 리디자인 — 페이지가 곧 앱, 실제 화면에 답해 보기

## 요청

「랜딩 사이트도 디자인 전면 업그레이드」 → 「impeccable 플러그인으로 새롭게 디자인」 → 「사용자를 매혹시켜 감기게 해서 앱을 다운받게」. 중간에 「스케치라 그런가? 퀄리티가 별로, 지금 랜딩을 봐라」로 되돌렸다.

## 과정

- impeccable init 으로 PRODUCT.md 를 썼다. 사용자 답:
  - 주 방문자는 매일 AI 로 코딩하는 개인 개발자다.
  - 증거는 이 저장소의 실제 기록 · 다운로드 수 · Product Hunt 다.
  - 성공은 앱 내려받기가 주, 플러그인이 보조다.
  - 「앱 색감 · 실제 화면」은 지킨다.
  - 틀린 것: SaaS 템플릿 · AI 장식 · 글이 많음.
- 구성 추첨(concept-seed, surface scope)을 두 판 돌렸다. 첫 판은 밝은 아이보리 스케치 셋(장부 · 일지 한 건 · 예외만)이었고, 사용자가 다시 뽑기를 골랐다. 둘째 판의 THE ROLL 「페이지가 곧 앱」으로 가던 중 사용자가 저품질을 지적했다.
- 바로잡은 판단: 「앱 색감」을 밝은 테마로만 좁게 읽었다. 앱에는 어두운 Deep Forest 가 있고 기존 랜딩의 무대가 그 색이다. 그래서 기존 랜딩의 어두운 무대 · 굵은 활자 · 창의 깊이를 기준선으로 삼고, 저화질 스케치 대신 실제 품질로 지었다.
- 실제 화면: 앱 하네스(Vite + mockIPC)로 찍었다.
  - 데이터는 이 저장소의 10-29 · 10-30 일지 34건과 그 커밋의 실제 diff 다. 질문 · 기다림 행은 데모로 넣었다.
  - 1180×720 @2x, 어두운 테마 · ko/en 으로 찍었다. 윗줄은 잘라 내고 HTML 로 다시 그려 탭이 진짜로 바뀌게 했다.

## 결과 (landing/index.html · en/index.html · home.css)

- 히어로: 왼쪽 정렬 헤드라인, 내려받기 + 플러그인 두 줄 복사, 그리고 실제 4.1 창.
  - 「Claude 가 물어요」의 답 버튼(이미지 위 진짜 버튼)을 누르면 터미널 탭으로 넘어간다. 거기서 `ask_user` 의 answer 와 이어진 작업 네 줄이 차례로 선다.
  - 모바일(≤720)은 같은 질문을 44px 버튼이 있는 카드로 창 위에 둔다.
- 하루 한 왕복: 어제 18:40 · 18:41 · 오늘 09:02. 둘째 · 셋째 단계에는 실제 화면 조각을 넣었다(일지 머리, 계획의 「✓ 통과 1158 passed」).
- 그 아래: 다섯 원칙 표, 작은 것들 여섯, 로컬, 플러그인, 실제 기록 수(일지 932 · 계획 89 · 릴리스 133), FAQ 8 + 접힌 17, 내려받기.
- 걷은 것: 동심원 장식 · 스크롤 페이드인 · 가운데 정렬 · 벤토 카드 · 3.x 영상과 스크린샷 셋(참조 0).
- 글꼴: 앱의 Pretendard 를 서브셋했다(1.7MB → 110KB). 코드 안 한글은 unicode-range 로 Pretendard 가 그린다.
- bump-version 의 버전 자리를 새 마크업에 맞췄다(「새 판」 라벨 자유, CTA eyebrow → cta-ver). 테스트와 RELEASE.md 도 함께 고쳤다.
- 찍는 중에 앱 결함 둘을 찾아 따로 고쳤다(영어 복수 · 시간 칸, 같은 날 bug 일지).

## 검증

- impeccable detect: 대비 1건(버튼 보조 글자 4.3:1)과 여백 1건을 고쳤다. 남은 것은 줄표 과다(ko 38 · en 43)뿐이고, 그중 32/37 은 기존 FAQ 원문을 그대로 둔 것이다.
- 마무리 검토(impeccable-finish-reviewer)를 두 차례 받았다.
  - 1차 fix 8건을 반영했다.
  - 2차에서 6건이 resolved 였다. 남은 넷(단계 시각 위치 · 답한 뒤 숫자 어긋남 · 표시 칩 · 모바일 카드 위치)도 고치고 캡처로 확인했다.
- 측정:
  - 답 버튼이 접히는 선보다 위에 있다: 1440×900 에서 135px, 1280×800 에서 91px(ko · en).
  - 모바일 390 의 답 버튼 아래 끝은 743/768px 로 첫 화면 안이다.
  - 가로 넘침 0 이다(scrollWidth == viewport).
- `pnpm vitest run src/__tests__/bump_version.test.ts src/__tests__/landing_pages.test.ts` → Tests 18 passed
- 이미지 출처: `impeccable embed-prompt --scan landing/shots/v4` → 12 rasters, 0 missing(webp 라 json 사이드카).

## 남은 것

- 위키 · 변경 이력 · 개인정보 · 플러그인 페이지는 아직 옛 landing.css 다. 같은 체계로 옮기는 일은 따로 한다.
- README 의 demo.gif · banner.png 는 3.x 화면이다.
- 랜딩 배포(`cd landing && vercel --prod`)는 사용자가 한다.