---
schema_version: 1
type: feature
slug: "english-subpages-and-promise-truth"
status: done
difficulty: medium
created_at: "2026-09-07T20:29:17+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Sonnet 5"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/en/keynote.html"
    op: create
  - path: "landing/en/plugin.html"
    op: create
  - path: "landing/en/index.html"
    op: update
  - path: "landing/keynote.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/wiki-src/build.mjs"
    op: update
  - path: "landing/sitemap.xml"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: ".oculpm/planner/codex-acp.md"
    op: correct
  - path: ".oculpm/planner/drag-and-drop-round.md"
    op: correct
  - path: ".oculpm/planner/menubar-tray.md"
    op: correct
  - path: ".oculpm/planner/hardening-and-optimization.md"
    op: correct
related: []
tags:
  - "landing"
  - "i18n"
  - "docs"
  - "v3-release"
  - "mcp-tool"
---
[x] 영문 표면이 제 페이지를 갖고, 약속 문구가 원장과 맞는다

## 추가 기능

**`{#en-subpages}`** — `landing/en/keynote.html` · `landing/en/plugin.html` 을 만들었다
(479줄 · 258줄 전체 번역). `landing/en/index.html` 의 기존 관례(절대경로 자산 · hreflang 3종 ·
`og:locale`)를 그대로 따랐다. 한국어판 두 페이지에도 영문 전환 링크를 넣고
`wiki-src/build.mjs` 의 `STATIC_URLS` 에 4개 URL 을 더해 sitemap(43 urls)을 재빌드했다.

**작업 중 잡은 진짜 버그** — `landing/en/index.html` 이 `/keynote` · `/plugin` 을 가리키던
**8자리**가 전부 한국어판으로 가고 있었다. 영문 방문자가 키노트나 플러그인 문서를 누르면
한국어 페이지가 떴다는 뜻이다. `/en/` 접두사로 고쳤다.

**`{#promise-text-truth}`** — 제품 약속 문구("LLM 호출과 업데이트 확인 말고는 기기 밖으로 안
나간다")가 실제보다 좁았다. 사실의 원장은 `src-tauri/tests/egress_inventory.rs` 이고, 대조 결과
`CLAUDE.md`·`landing/index.html`·`landing/en/index.html` 은 **이미** Notion OAuth 브로커
(`oculpm.com`)를 명시하고 있었다(이전 라운드에 정정됨). 빠져 있던 곳은 `README.md` ·
`README.en.md` 두 곳뿐이라 거기만 채웠다.

**`{#glyph-hygiene}`** — 글리프가 사실과 어긋난 네 자리:
`codex-acp` 는 `status: done` 인데 6항목이 `[~]` 라 **`active` 로 되돌리고**, 근거를 확인한 2건만
`[x]` 로 올렸다(나머지 4건은 fixture 가 handshake 하나뿐 · lifecycle 정리가 v3-release 의
`{#acp-segment-close}` 로 여전히 열려 있음 · 종료 정리 테스트 부재 · live-smoke 후속 증거
없음). `drag-and-drop-round` Phase 8 의 4건은 항목 본문이 이미 "(Phase 9 가 대체)" 라 적고
Decision 7 도 그렇게 잠가 뒀는데 글리프만 안 따라온 것이라 `[-]` 로. `menubar-tray` 의 v2.3.0
항목은 릴리스가 40여 번 지나도록 다시 열리지 않은 죽은 항목이라 `[-]` 로.
`skill-catalog-round-2` 는 이미 `archived` 였다.

**같은 병이 이번 라운드 중에도 났다** — `hardening-and-optimization` 이 `{#csp}`·`{#entry-chunk}`
2건을 남긴 채 `status: done` 으로 닫혀 있는 것을 발견해 `active` 로 되돌렸다.

## 검증

새 HTML 두 장의 태그 짝·참조 자산 실존을 확인했고, 남은 한국어 문자열과 한국어판 링크가
**언어 전환기(`hreflang="ko"`)뿐**임을 grep 으로 못 박았다. `node landing/wiki-src/build.mjs`
재실행 시 sitemap.xml 만 바뀌고 wiki·changelog·themes·privacy 는 바이트 동일 — 위키 소스를
건드리지 않았다는 증거다. `pnpm lint`·`pnpm build` exit 0.

**미완** — 영문 스크린샷(`{#en-shots}`)은 여전히 한국어 UI 를 참조한다. 앱을 영어 모드로 띄워
다시 찍어야 하는 일이라 육안 대장으로 넘긴다. 랜딩 배포(`vercel --prod`)는 하지 않았다.