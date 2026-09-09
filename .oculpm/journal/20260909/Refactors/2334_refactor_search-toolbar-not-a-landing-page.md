---
schema_version: 1
type: refactor
slug: "search-toolbar-not-a-landing-page"
status: done
difficulty: medium
created_at: "2026-09-09T23:34:13+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
related: []
tags:
  - "design"
  - "search"
  - "toolbar"
  - "de-web-idiom"
  - "mcp-tool"
---
[x] 한 바에 같은 문장이 두 번, 그리고 도구가 랜딩 페이지처럼 굴었다

## 동기

`{#layout-search-toolbar}` 의 두 주장을 실측했고 **둘 다 정확했다**.

첫째, 툴바가 같은 문장을 두 번 말했다 — 문자 그대로:

```tsx
<Toolbar title={t("nav.search")} sub={t("search.localIndex")}>
  <span className="chip"><Database size={13} /> {t("search.localIndex")}</span>
</Toolbar>
```

`sub` 와 유일한 칩이 **같은 키**다. 액션은 0개였다. 16화면 중 이 바만 자기 말을 반복하고 있었다.

둘째, 주 컨트롤이 본문에 있었다 — `.search-hero`(720px 가운데 열) 안의 `.search-big`(46px, 카드 배경, `--radius-l`, 그림자). 그건 **웹 랜딩의 관용구**다. 화면 한가운데 큰 검색창 하나를 놓는 건 그것 말고 할 일이 없는 페이지의 문법이고, 이 앱은 밀도 도구다.

## 규격은 이미 있었다

`{#layout-page-enter}` 와 같은 모양의 발견이다. 일지 화면이 이미 패턴을 정해 놓았다 — `<Toolbar>` 안에 `.search-box`(30px, primitives.css) + `scope-chip` 필터들. 검색 화면만 자기 문법을 갖고 있었고, 그래서 앱에서 **검색이 두 가지 크기**(30px / 46px)로 존재했다.

## 변경 요약

입력과 스코프 칩을 툴바로 올렸다. 중복 칩은 사라지고 그 자리를 실제 컨트롤이 채운다. `sub` 는 **남겼다** — 결과가 「로컬 색인」에서 온다는 건 이 화면의 정직성 문장이고(무엇을 검색하는지가 아니라 무엇을 검색하지 *않는지*를 말한다), 두 번 말하던 것을 한 번으로 줄인 것이지 지운 게 아니다.

`.search-hero`·`.search-big` 은 정의째 지웠다 — 호출부가 이 화면 하나뿐이었다. 딸린 두 줄도 문맥이 바뀌어 함께 고쳤다: `.search-scope` 의 `justify-content: center` + `margin-top`(가운데 열의 사정)과 `.search-recent` 의 `justify-content: center` + `margin-top`(히어로 마지막 줄의 사정)을 걷어, 이제 결과 목록과 같은 왼쪽 선에 선다. 시맨틱 스코프의 문서 포함 토글이 갖고 있던 `style={{ marginLeft: "auto" }}` 도 같은 이유로 사라졌다 — 툴바에서는 그냥 다음 칩이다.

`.search-box` 에 인라인 폭을 주지 **않았다.** 일지가 `style={{ minWidth: 180 }}` 로 프리미티브를 덮고 있는데, 그게 `{#unify-search-input}` 이 지적하는 바로 그 습관이다. 여기서 따라 하면 6종을 2단으로 접자는 항목이 7종으로 늘어난다. 프리미티브의 `min-width: 220px` 를 그대로 쓰고, 좁은 창은 `.toolbar-actions` 의 가로 스크롤이 이미 방어한다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9 = 기준선) · `pnpm test` · `pnpm build` 각각 exit 0 직접 확인. 지운 클래스 둘의 호출부가 0인 것과 `Database` 아이콘 import 가 고아가 된 것을 grep 으로 확인해 함께 제거했다. **이 화면은 레이아웃이 바뀌는 변경이라 실기기 확인이 필요하다** — 히어로가 사라지고 컨트롤이 52px 바로 올라간다.