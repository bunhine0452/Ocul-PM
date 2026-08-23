---
schema_version: 1
type: chore
slug: wiki-complete-and-deploy
status: done
difficulty: medium
created_at: "2026-08-21T00:59:18+09:00"
session_id: "manual-20260821-005918"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "landing/wiki-src/today.md"
    op: create
  - path: "landing/wiki-src/ai-panel.md"
    op: create
  - path: "landing/wiki-src/agents.md"
    op: update
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/index.md"
    op: update
  - path: "landing/wiki-src/journal.md"
    op: update
  - path: "landing/wiki-src/planner.md"
    op: update
  - path: "landing/wiki-src/retro.md"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "landing/wiki-src/workspace.md"
    op: update
  - path: "landing/wiki-src/settings.md"
    op: update
  - path: "landing/wiki-src/troubleshooting.md"
    op: update
  - path: "landing/wiki-src/data.md"
    op: update
  - path: "landing/wiki-src/shortcuts.md"
    op: update
  - path: "landing/sitemap.xml"
    op: update
related:
  - ".oculpm/journal/20260821/Chores/0050_chore_wiki-faq-and-workspace-pages.md"
tags: [wiki, docs, landing, deploy]
---

[x] 위키 남은 공백 메우고 oculpm.com 배포 — 6편에서 16편으로

## 배경

두 라운드에 걸쳐 위키를 6 → 14편으로 늘렸고([0040](0040_chore_wiki-core-concept-pages.md),
[0050](0050_chore_wiki-faq-and-workspace-pages.md)) 스킬·규칙 화면, AI 패널, 문서 뷰어,
오늘 현황 위젯이 공백으로 남아 있었다. "다 쓰고 배포해" 요청으로 마무리.

## 변경 요약

**`today.md` (order 4)** — 앱을 열면 처음 보는 화면인데 문서가 없었다. 활동 링 3겹(작업일지·
변경 파일·라인 변화)과 그 옆 모니터, 이번 주 작업량, 커밋 그래프(GitHub 열기·비 git 저장소
안내), 에이전트별 기여, 앞을 가리키는 카드 셋(다음 할 일·계획 업데이트·결정 대기),
**평소엔 안 보이는 카드 둘**(일지 없이 끝난 세션 / 정직성 감사), 스탠드업 복사.

**`ai-panel.md` (order 10)** — 에이전트 화면. 일반 챗봇과의 차이가 **컨텍스트 칩**(코드·작업일지·
플래너·git)이라는 점을 앞세웠고, 토큰 배지에 "매 전송마다 컨텍스트 + 대화 기록 **전체**가 다시
간다 → 주제 바뀌면 새 대화가 싸다" 는 실전 조언을 붙였다. 플래너 액션 제안 5종은 **승인해야
반영된다**는 점을 강조. 끝에 앱 안 Claude Code 와의 대조표(하는 일·비용·제공자·파일 수정).

**스킬·규칙 허브 → `agents.md` 에 흡수** — 별도 페이지를 만들려다 보니 이 화면은 agents.md 가
개념으로 설명하는 것의 *UI* 였다. 같은 주제를 두 페이지로 쪼개면 독자가 왕복한다. 5개 탭
(스킬·샵·규칙·훅·플러그인)을 섹션으로 넣었다 — 스킬 발동 기준이 frontmatter `description`
이라는 점, 비활성화는 `.disabled/` 로 옮길 뿐 **파일을 안 지운다**는 점, 훅이 켜지면 세션
경계가 휴리스틱이 아니라 실측이 된다는 점.

**문서 뷰어 → `screens.md` 에 절 추가** — 읽기 전용 `./docs` 뷰어라 한 페이지 분량이 안 됐다.

**순서 최종** — 0 index / 1 시작 / 2 FAQ / 3 화면 / 4 오늘 / 5 일지 / 6 플래너 / 7 회고 /
8 Claude Code / 9 다른 에이전트 / 10 에이전트 패널 / 11 작업공간 / 12 설정 / 13 문제해결 /
14 데이터 / 15 단축키. 신규 2편이 기존 번호와 겹쳐 sed 연쇄 대신 **파일→번호 맵을 명시**하는
파이썬 한 방으로 재배치했다 (연쇄 치환은 중간 값이 다음 규칙에 걸려 이중 적용된다).

## 검증

`node landing/wiki-src/build.mjs` → **16 pages + sitemap 19 urls**. 자동 검사 셋을 돌렸다:
내부 `/wiki/*` 링크 전수 대조 **깨진 링크 0**, **sitemap 누락 0**(생성 페이지 전부가 sitemap 에
있는지 역방향 확인), 신규 페이지 표·콜아웃·h3·TOC 렌더 카운트.

브라우저 육안 확인 — 오늘 현황을 열어 사이드바 **16개 순서**, TOC 칩, 표, 콜아웃 정상.

**배포**: `cd landing && vercel --prod --yes` → `readyState: READY`, `target: production`.
라이브 대조 — `/wiki/{faq,today,ai-panel,settings,workspace,agents}` 전부 **200**,
`https://oculpm.com/wiki` 사이드바에서 16개 제목 확인, `sitemap.xml` **19 urls** 확인.

## 메모

지난 라운드에 sitemap 을 자동 생성으로 바꿔 둔 것이 이번에 값을 했다 — 페이지 2편을 더하고
10편의 order 를 흔들었는데 sitemap 은 손댈 게 없었고, 역방향 누락 검사도 자동으로 통과했다.
손으로 관리했다면 이번에도 빠뜨렸을 것이다.

문서를 쓰다 앱 쪽 사실을 두 개 발견해 문서에 반영했다: 프리셋 테마를 고르면 **액센트 선택이
비활성**된다는 것(`data-accent` 가 프리셋 활성 중 제거됨), 그리고 터미널 단축키 6종이 문서에
전혀 없었다는 것. 후자는 지난 라운드에 단축키 페이지로 옮겼다.

`⌘B` 는 이번에도 안 적었다 — `settings.editor.desc` 문자열에만 있고 바인딩을 못 찾았다.

남은 것: 영어 위키가 없다. README 는 ko/en 양쪽인데 위키는 한국어뿐이라, 해외 사용자는
랜딩까지만 보고 만다. 별도 라운드로 다룰 일.
