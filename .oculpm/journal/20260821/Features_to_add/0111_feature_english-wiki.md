---
schema_version: 1
type: feature
slug: english-wiki
status: done
difficulty: high
created_at: "2026-08-21T01:11:21+09:00"
session_id: "manual-20260821-011121"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "landing/wiki-src/build.mjs"
    op: update
  - path: "landing/wiki.css"
    op: update
  - path: "landing/wiki-src/en/index.md"
    op: create
  - path: "landing/wiki-src/en/getting-started.md"
    op: create
  - path: "landing/wiki-src/en/faq.md"
    op: create
  - path: "landing/wiki-src/en/screens.md"
    op: create
  - path: "landing/wiki-src/en/today.md"
    op: create
  - path: "landing/wiki-src/en/journal.md"
    op: create
  - path: "landing/wiki-src/en/planner.md"
    op: create
  - path: "landing/wiki-src/en/retro.md"
    op: create
  - path: "landing/wiki-src/en/claude-code.md"
    op: create
  - path: "landing/wiki-src/en/agents.md"
    op: create
  - path: "landing/wiki-src/en/ai-panel.md"
    op: create
  - path: "landing/wiki-src/en/workspace.md"
    op: create
  - path: "landing/wiki-src/en/settings.md"
    op: create
  - path: "landing/wiki-src/en/troubleshooting.md"
    op: create
  - path: "landing/wiki-src/en/data.md"
    op: create
  - path: "landing/wiki-src/en/shortcuts.md"
    op: create
  - path: "landing/sitemap.xml"
    op: update
related:
  - ".oculpm/journal/20260821/Chores/0059_chore_wiki-complete-and-deploy.md"
tags: [wiki, i18n, docs, landing, seo]
---

[x] 영어 위키 16편 + 빌더 다국어화 — oculpm.com 의 첫 영어 표면

## 추가 기능

위키가 한국어뿐이라 해외 사용자는 랜딩까지만 보고 끝났다. `/wiki/en/` 아래 16편을 내고
빌더를 2로케일로 확장했다. 한국어 URL(`/wiki/...`)은 **한 글자도 안 건드렸다** — 이미 색인됐고
외부 링크도 걸려 있다.

**빌더 다국어화 (`build.mjs`)**
- `LOCALES` 배열이 로케일당 `srcDir`·`outDir`·`base`·UI 문구를 들고 있다. `wiki-src/*.md` → ko,
  `wiki-src/en/*.md` → en. **소스 폴더가 없으면 조용히 건너뛴다** — 영어를 쓰기 전에도 빌드가 돈다
- 사이드바·이전/다음 네비·TOC 헤더·"마지막 수정"·"이 문서 고치기"가 전부 로케일 문구로
- **언어 전환 링크** — 같은 슬러그가 상대 로케일에 있으면 그리로, 없으면 그쪽 index 로
- `<html lang>`, canonical, `og:locale`, **양방향 hreflang** 자동
- sitemap 이 두 로케일을 다 싣고 각 URL 에 `xhtml:link` 대체 언어를 붙인다. 영어는 priority 를
  0.1 낮춰 한국어를 정본으로 신호했다 (랜딩·플러그인 문서가 아직 한국어뿐이라)

**소스 검증 추가** — 아래 「메모」 참고.

**콜아웃 배지 로케일화** — `render()` 가 라벨 맵을 인자로 받는다. 안 고쳤으면 영어 페이지에
「팁」·「참고」가 박혀 나갔다 (실제로 첫 빌드에서 그렇게 나왔고 스크린샷으로 잡았다).

**사이드바 푸터 CSS** — 링크가 하나였을 땐 문제가 없었는데 언어 전환이 붙어 둘이 되자 인라인
앵커라 한 줄에 붙었다. `flex-direction: column` + gap.

## 동작 흐름

영어 문서는 번역이 아니라 **다시 쓴 것**에 가깝다. 다만 앱 UI 라벨은 지어내지 않고
`src/i18n/en.ts` 에서 실제 문자열을 뽑아 썼다 — Today / Work Journal / Changes / Retro /
Code Search / Code Map / Skills & Rules, 지표는 Entries·Shipped·Resistance·Agents,
플래너 글리프는 To do·In progress·Blocked·Deferred·Dropped, 검색 모드는
Semantic·Symbols·Exact match. 문서가 실제 화면과 다른 단어를 쓰면 사용자가 못 찾는다.

## 검증

`node landing/wiki-src/build.mjs` → **32 pages (ko 16 + en 16) + sitemap 35 urls**.
자동 검사: 두 로케일 교차 링크 전수 대조 **깨진 링크 0**, **슬러그 집합 불일치 0**
(ko 와 en 이 같은 16개 슬러그를 갖는지 대칭 확인), hreflang·canonical·언어 전환 양방향 확인.

브라우저 육안 — 영어 FAQ 에서 nav(Features/Keynote/Wiki/Plugin/Download), 사이드바 16개
영어 제목, "Last updated"/"On this page", 콜아웃 배지 **Tip**, 푸터 "한국어 → / Edit this page →"
확인. 한국어 쪽 콜아웃이 여전히 참고/팁인 것도 grep 으로 대조했다.

**배포** → `READY`, `target: production`. 라이브 대조: 영어 16개 URL **전부 200**,
한국어 회귀 없음, `hreflang` 양방향, 언어 전환 링크 양방향, `sitemap.xml` **35 urls**.

## 메모

**빌더에 소스 검증을 넣었다.** `en/today.md` 를 쓰다 콜아웃 `:::` 닫기를 빠뜨렸는데, 렌더러가
"파일 끝까지 삼키기" 로 조용히 처리해 **페이지 절반이 콜아웃 안으로 사라진 채 빌드가 성공**했다.
눈으로 잡았지만 다음엔 못 잡는다. `validate()` 가 코드펜스·콜아웃 짝을 세고 파일명과 줄 번호를
달아 빌드를 세운다. 일부러 다시 깨뜨려 `Error: today.md: 72번째 줄에서 연 콜아웃이 안
닫혔습니다` 가 뜨는 것까지 확인했다 — 이빨이 있다.

남은 것: 랜딩(`index.html`)·키노트·플러그인 문서는 아직 한국어뿐이다. 영어 위키에서 nav 의
Features/Keynote/Plugin 을 누르면 한국어 페이지로 간다. 위키가 먼저 난 셈이라 어색하지만,
문서가 없는 것보다는 낫다고 판단했다. 랜딩 영어판은 별도 라운드.
