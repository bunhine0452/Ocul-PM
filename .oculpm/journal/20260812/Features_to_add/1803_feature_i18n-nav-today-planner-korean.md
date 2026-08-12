---
schema_version: 1
type: feature
slug: "i18n-nav-today-planner-korean"
status: done
difficulty: low
created_at: "2026-08-12T18:03:43+09:00"
session_id: "mcp-20260812-180343"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
related: []
tags:
  - "i18n"
  - "nav"
  - "mcp-tool"
---
[x] 사이드바 Today·Planner 한국어화 + 하드코딩 영어 1건 발견

한국어 모드 사이드바에서 `Today` · `Planner` 만 영어로 남아 있어 "작업 일지 / 문제 해결" 과 섞여 보였다.

## 추가 기능

`nav.today` → **오늘**, `nav.planner` → **플래너** (ko 만; en 은 그대로).

두 단어는 **코드베이스가 이미 쓰던 표기**다 — `nav.*.alias` 에 각각 `오늘` · `플래너` 가 들어 있었고, 본문 카피도 "오늘 일지" · "오늘의 흐름" · "플래너 진행 상황" 으로 일관됐다. 새 용어를 고른 게 아니라 라벨만 뒤늦게 따라간 것이다.

## 별칭 정리

사전 주석이 "라벨 자체도 자동으로 색인되므로 라벨에 있는 단어는 반복하지 않는다" 고 못박아 뒀는데, 라벨이 한국어가 되면서 별칭의 `오늘` · `플래너` 가 중복이 됐다. 대신 **반대 언어 단어를 넣었다** (`today` · `planner`) — 한국어 모드에서도 영어로 검색되게. `tAll()` 이 양 언어를 색인하므로 원래 찾히긴 하지만, 별칭에도 넣어 손버릇이 확실히 살아 있게 했다.

## 곁들여 — 하드코딩 영어 1건

`TodayScreenV2.tsx:140` 이 `<Toolbar title="Today" …>` 였다. 사이드바 라벨을 바꿔도 **화면 제목은 영어로 남는** 자리다. `t("nav.today")` 로 바꿔 둘이 함께 움직인다.

직전 라운드의 `<h2>Settings</h2>` 와 **같은 부류** — `pnpm lint` 는 한글을 찾는 게이트라 하드코딩 *영어*를 원리적으로 못 본다. 이번엔 `today_v2` 테스트가 `queryByText("Today")` 로 단언하고 있어서 드러났다(그 테스트는 `within` 임포트를 쓰려는 sanity 체크였는데 우연히 감시자 역할을 했다).

## 테스트 계약 갱신

`tAll("nav.today")` 로 "양 언어 값이 같으면 한 번만" 을 검사하던 dedup 테스트가 이제 성립하지 않는다 — 값이 갈렸다. 두 개로 나눴다:

- dedup 은 `settings.tab.llm`(양쪽 "LLM")으로 이전
- **새 테스트**: `tAll("nav.today")` 가 `["Today", "오늘"]` 둘 다 돌려주는지 — ⌘K 팔레트가 양 언어로 찾히는 계약이 이번 변경의 핵심이라 명시적으로 못박았다

`sidebar_a11y` · `today_v2` 의 ko 단언도 갱신.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 678통과(+1) / lint(남은 0) / build.