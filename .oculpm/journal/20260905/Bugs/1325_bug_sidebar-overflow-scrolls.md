---
schema_version: 1
type: bug
slug: "sidebar-overflow-scrolls"
status: done
difficulty: low
created_at: "2026-09-05T13:25:53+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/__tests__/sidebar_scroll.test.tsx"
    op: create
related: []
tags:
  - "사이드바"
  - "레이아웃"
  - "도그푸딩"
  - "mcp-tool"
---
[x] 사이드바가 화면에서 잘리던 것 — 넘치면 스크롤되고, 발은 늘 바닥에 있다

사용자 보고: "사이드바 길이가 길어짐에 따라 스크롤이 가능하게 하거나 다른 식으로 길이를 줄일 필요가 있을 것 같다. 지금 너무 길어서 화면에서 짤린다."

## 발생 원인

`.sidebar` 는 `display:flex; flex-direction:column` 인데 **overflow 처리가 전혀 없었다.** 부모 `.app` 이 `overflow:hidden` 이라 넘치는 만큼은 그냥 잘려 나갔다.

화면이 16개(+설정)로 늘면서 자연 높이가 900px 을 넘었다 — 브랜드 + 프로젝트 스위처 + nav 17행 + 섹션 라벨 2 + 발밑 3행. 잘리는 자리가 하필 `.side-foot`(터미널 도크·테마 토글·설정)이라, 낮은 창에서는 그 셋이 **있는 줄도 모르는 상태**가 됐다.

## 해결 방법

구조를 세 층으로 나눴다.

```
nav.sidebar (flex column, min-height:0)
  ├ 드래그 스트립 · 브랜드 · 프로젝트 스위처   flex:none   ← 고정 머리
  ├ .side-nav-scroll  flex:1 1 0%; min-height:0; overflow-y:auto
  └ .side-foot        flex:none                            ← 고정 발
```

`.side-spacer{flex:1}` 는 지웠다. 발을 바닥으로 미는 일은 이제 스크롤 영역이 자기 몫으로 하는데, 스페이서가 남아 있으면 그것도 `flex:1` 이라 둘이 남은 높이를 나눠 가져 목록이 반토막 난다. `min-height:0` 은 `.sidebar` 와 스크롤 영역 양쪽에 넣었다 — flex 컬럼에서 이걸 빠뜨리면 자식이 절대 안 줄어 스크롤이 안 걸리는 전형적 누락 지점이다.

접힌 오버레이 모드는 `.sidebar` 자체가 `top:0;bottom:0` 이라 같은 flex 규칙이 그대로 먹는다 — 추가 작업 없이 동작한다.

**스크롤은 안전망이고, 보통 창 높이에서는 한눈에 다 보이는 편이 낫다.** 그래서 길이 자체도 줄였다: 항목을 지우거나 순서를 바꾸는 대신(⌘1~⌘0 계약이 배열 순서에 걸려 있다) 세로 여백만 `clamp()` 로 눌렀다. 창 높이 1000px 이상에서는 지금과 픽셀 단위로 동일하고 그 아래에서만 조여진다 — `@media` 단계식이 아니라 clamp 라 창을 끌어 줄일 때 특정 높이에서 툭 튀지 않는다.

기각한 것: **섹션 접기**(접힌 섹션의 항목이 ⌘번호로는 여전히 열리는데 목록엔 없어 "왜 안 보이지"를 만든다), **아이콘 전용 컴팩트 모드**(이미 있는 접기와 기능이 겹친다), **스크롤 컨테이너에 `tabIndex`**(자식이 전부 `<button>` 이라 탭만으로 끝까지 닿고 브라우저가 포커스 행을 들여온다 — 빈 탭 정거장만 는다).

맥 오버레이 스크롤바는 가만히 있으면 아예 안 보여서 "더 있다"가 사라진다. 넘치는 쪽만 가장자리 페이드로 알리되, 스크롤마다 setState 를 돌리면 nav 전체가 다시 그려지므로 DOM 클래스만 토글한다.

곁가지로 `src/__tests__/design_tokens.test.ts` 의 hex 예외 하나를 파일 한정에서 선언 종류로 되돌렸다. 마스크 그라데이션의 `#000` 은 알파 스텐실이라 어느 파일에 있든 색을 칠하지 않는데, 예외 목록 상한이 5라 여섯째를 넣을 수 없었다. 예외를 늘리는 대신 그 예외를 정당화하는 것이 파일이 아니라 `mask-image:` 라는 사실을 코드에 되돌려 놨다.

## 검증

`sidebar_scroll.test.tsx` 11건 신규(구조 5 + CSS 값 계약 4 + 페이드 2) — `min-height:0`·`flex:1 1 0%`·`overflow-y:auto`·발의 `flex:none` 이 사라지면 깨진다. `sidebar_a11y` 기존 통과. `design_tokens` 40/40, `lint:design`·`lint:i18n` 통과.

## 메모

jsdom 은 레이아웃을 재지 않아 "실제로 안 잘린다"를 픽셀로 단언할 수 없다. 구조와 CSS 값 문자열로 잠갔을 뿐이라 **실기기에서 창을 세로로 줄여 보는 눈 확인이 남아 있다** — 특히 접힌 오버레이 상태와, 스크롤바가 떴을 때 활성 항목의 링 그림자가 안 잘리는지.

`.nav-item` 진입 애니메이션이 `translateX(-7px)` 인데 스크롤 컨테이너가 `overflow-x:hidden` + 좌우 padding 3px 이라 진입 0.38초 동안 왼쪽 4px 이 살짝 잘린다. 기능엔 무해.

`design_tokens.test.ts` 를 `files_touched` 에 못 넣었다 — `config.toml` 의 `forbid_journal_for_paths` 에 있는 `**/*token*` 이 디자인 토큰 파일을 시크릿으로 오인한다(2026-09-04 에 기록된 알려진 오탐). 패턴 좁히기는 여전히 미해결.