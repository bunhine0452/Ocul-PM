---
schema_version: 1
type: bug
slug: "fix-landing-hero-fit-and-marquee-edge"
status: done
difficulty: medium
created_at: "2026-08-01T15:49:19+09:00"
session_id: "mcp-20260801-154919"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/landing.css"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "landing"
  - "css"
  - "responsive"
  - "mcp-tool"
---
[x] 랜딩 히어로 — 마키 양끝 흰 얼룩 제거 + 첫 화면 한 눈에 들어오게 적응형

첫 화면(히어로) 하단 마키 양끝이 흰색으로 비치고, 낮은 화면에서는 마키가 화면 밖으로 밀려 잘렸다.

## 발생 원인

**흰 얼룩** — 마키 양끝 페이드를 `.trigbar` 의 `mask-image` 로 구현했는데, 마스크는 바의 배경(`--green-950`)까지 함께 깎는다. 그 자리로 `body` 의 `--paper(#f5f6f5)` 가 그대로 비쳤다.

**첫 화면 초과** — 히어로의 세로 리듬(패딩 96px, h1 최대 62px, 각 블록 margin)이 전부 고정값이라 화면 높이와 무관했다. 1280×700 같은 낮은 뷰포트에서 설치 명령·마이크로 목록·마키가 `100dvh` 밖으로 밀렸다. `.hero` 는 flex 자식인데 `min-height:0` 이 없어 콘텐츠 높이 밑으로 줄지도 못했다.

## 해결 방법

- 페이드를 마스크 → **바와 같은 색의 그라디언트 오버레이**(`.trigbar::before/::after`)로 교체. `.trig-track` 에 마스크를 거는 대안은 트랙이 `translateX` 로 흐르는 탓에 페이드가 글자를 따라 움직여 기각.
- 히어로 세로 리듬을 `clamp(min, …vh, max)` 로 화면 높이에 연동 — 패딩·h1·본문·CTA 높이·설치 스니펫·마이크로 목록·마키 패딩·프리뷰 카드 내부 간격. 위쪽 패딩만은 `clamp(78px, 9vh, 112px)` 로 하한을 둬서 fixed 네비(64px) 밑으로 콘텐츠가 들어가지 않게 했다.
- `.hero { min-height: 0 }` — flex 자식이 줄어들 수 있게.
- 곁들여: `.hero-copy`·`.hero-preview`·`.hero-snip code` 에 `min-width: 0`. 그리드/플렉스 자식의 기본 `min-width:auto` 가 nowrap 인 설치 명령의 min-content 폭만큼 열을 벌리는 구조였다. 좁은 화면에서 공지 필과 eyebrow 도 줄을 나눴다(≤700px).
- 업데이트 밴드 머리말이 v2.5 시절 문구("v2.5 는 …합니다")로 굳어 있어 현재 범위(v2.5 → v2.8)로 갱신.

## 검증

- 헤드리스 Chrome 스크린샷 — 1280×700 / 1440×900 / 1512×600 / 1920×1080 전부 마키까지 한 화면에 들어오고 양끝 흰 얼룩 없음.
- 함정: 헤드리스 Chrome 은 최소 창 폭이 500px 이라 `--window-size=390` 을 줘도 500px 로 레이아웃하고 이미지만 잘라낸다. 처음엔 이걸 모바일 가로 넘침으로 오독했다. iframe(390·360px)으로 진짜 좁은 뷰포트를 만들어 재확인 — 넘침 없음, 설치 명령은 말줄임 처리.