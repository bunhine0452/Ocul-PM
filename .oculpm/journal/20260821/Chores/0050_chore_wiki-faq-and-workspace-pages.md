---
schema_version: 1
type: chore
slug: wiki-faq-and-workspace-pages
status: done
difficulty: medium
created_at: "2026-08-21T00:50:10+09:00"
session_id: "manual-20260821-005010"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "landing/wiki-src/faq.md"
    op: create
  - path: "landing/wiki-src/workspace.md"
    op: create
  - path: "landing/wiki-src/settings.md"
    op: create
  - path: "landing/wiki-src/index.md"
    op: update
  - path: "landing/wiki-src/shortcuts.md"
    op: update
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/journal.md"
    op: update
  - path: "landing/wiki-src/planner.md"
    op: update
  - path: "landing/wiki-src/retro.md"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "landing/wiki-src/agents.md"
    op: update
  - path: "landing/wiki-src/troubleshooting.md"
    op: update
  - path: "landing/wiki-src/data.md"
    op: update
  - path: "landing/sitemap.xml"
    op: update
related:
  - ".oculpm/journal/20260821/Chores/0040_chore_wiki-core-concept-pages.md"
tags: [wiki, docs, landing, onboarding]
---

[x] 위키에 FAQ·작업공간·설정 3편 추가 — 11편 → 14편, 처음 쓰는 사람이 막히는 지점 위주로

## 배경

앞선 라운드([0040](0040_chore_wiki-core-concept-pages.md))에서 개념 문서 5편을 넣고 남은 공백으로
설정·터미널·코드 에디터·멀티 창을 꼽아 뒀다. 이어서 쓰라는 요청에 더해 **"처음 쓰는 사용자가
궁금해할 것, 어려워할 것도"** 라는 주문이 붙었다 — 기능 설명서만으로는 안 풀리는 층이다.

## 변경 요약

**`faq.md` (order 2, 시작하기 바로 뒤)** — 새로 추가된 문서 중 가장 값이 큰 편. 기능이 아니라
*첫 며칠의 불안*을 다룬다.

- "일지는 제가 써야 하나요?" → 아니오, 에이전트가 쓴다 (이걸 모르면 앱의 전제가 안 잡힌다)
- "돈이 드나요?" → 기록은 무료·로컬, AI 가 **새 글을 쓸 때만** 과금. 표로 셋을 갈라 놨다
- **".oculpm 을 git 에 커밋해야 하나요?"** → 앱이 `.gitignore` 관리 블록을 자동으로 깔아
  캐시만 제외한다는 걸 실제 블록과 함께 보여 준다. 조사하다 확인한 사실이라 확신을 갖고 썼다
- 워크데이·세션 개념, 일지/플래너/토의의 시간축 차이, UI 언어 vs AI 작성 언어
- "앱을 지우면 기록은?" / "앱을 항상 켜 둬야 하나?" — 후자는 **앱이 꺼져도 에이전트는 일지를
  쓴다(규칙이 AGENTS.md 에 있으니까). 앱이 놓치는 건 변경 관측**이라는 구분을 명시

**`workspace.md` (order 9)** — 창·탭·터미널·코드를 한 편으로. 탭별 독립 상태·지연 로드·활동 점,
메뉴바 상주 4옵션, 터미널 도크 위치/분리, 코드 화면의 한계표(2MB·바이너리·버퍼 축출).

**`settings.md` (order 10)** — 8개 탭을 "언제 여나" 로 먼저 가른 뒤 항목별로. 프리셋과 액센트가
**상호배타**라는 점, 앱 배율과 터미널 px 가 별개인 이유, 폴백 체인 예시, 청킹 트레이드오프
(클수록 맥락·작을수록 정밀도), API 키가 키체인에만 산다는 점.

**터미널 단축키 발굴** — `TerminalSurface.tsx` 를 읽다 보니 세션(`⌘T`)·페인 닫기(`⌘W`)·분할
(`⌘D`/`⇧⌘D`)·검색(`⌘F`)·화면 지우기(`⌘L`)·글자 크기(`⌘±`/`⇧⌘0`)가 **단축키 문서에 하나도
없었다.** 전부 추가하고, `⌘T`·`⌘W` 가 전역과 겹치지만 **포커스가 터미널 안일 때만** 먹는다는
스코프 규칙을 함께 적었다 (`keyboardScope === "focused"` 가드). 전역 `⌘\`(에이전트 화면)도 누락돼
있어 보탰다.

**순서 재편** — 0 index / 1 시작 / 2 FAQ / 3 화면 / 4 일지 / 5 플래너 / 6 회고 / 7 Claude Code /
8 다른 에이전트 / 9 작업공간 / 10 설정 / 11 문제해결 / 12 데이터 / 13 단축키.

## 검증

`node landing/wiki-src/build.mjs` → **14 pages + sitemap 17 urls** (sitemap 은 지난 라운드에
자동 생성으로 바꿔 둬서 이번엔 손댈 게 없었다 — 의도대로 동작). 내부 `/wiki/*` 링크 전수 대조
**깨진 링크 0**. 신규 3편의 표·콜아웃·코드블록·TOC 렌더 카운트 확인.

브라우저 육안 확인 — FAQ 를 열어 사이드바 14개 순서, `###` 소제목 위계, 비용 표, 콜아웃,
`.oculpm/` 인라인 코드가 정상. `⌘\` 이스케이프와 gitignore 코드블록도 원문대로 나온다.

## 메모

**`⌘B` 는 적지 않았다.** `settings.editor.desc` 문자열에 "외부 에디터로 열기 (⌘B → 파일 선택)"
라고 적혀 있는데, `src/` 전체에서 그 키 바인딩을 찾지 못했다. 문자열만 남은 잔재이거나 다른
경로일 텐데 확인이 안 되므로 **기능만 적고 키는 주장하지 않았다.** 실제로 없는 단축키를 문서에
박아 두면 사용자가 자기 탓을 하게 된다 — 확인되면 그때 넣을 일이다.

배포는 이번에도 안 했다 — `cd landing && vercel --prod` 는 공개 사이트에 반영되는 일이라
사용자 확인 대기. 지난 라운드분과 함께 한 번에 나가면 된다.

남은 공백: 스킬·규칙 화면, AI 패널(에이전트 화면)의 액션 제안, 문서 화면(`./docs` 뷰어),
오늘 현황의 위젯 하나하나.
