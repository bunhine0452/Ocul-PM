---
schema_version: 1
type: chore
slug: wiki-core-concept-pages
status: done
difficulty: medium
created_at: "2026-08-21T00:40:57+09:00"
session_id: "manual-20260821-004057"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "landing/wiki-src/screens.md"
    op: create
  - path: "landing/wiki-src/journal.md"
    op: create
  - path: "landing/wiki-src/planner.md"
    op: create
  - path: "landing/wiki-src/retro.md"
    op: create
  - path: "landing/wiki-src/agents.md"
    op: create
  - path: "landing/wiki-src/index.md"
    op: update
  - path: "landing/wiki-src/shortcuts.md"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "landing/wiki-src/troubleshooting.md"
    op: update
  - path: "landing/wiki-src/data.md"
    op: update
  - path: "landing/wiki-src/build.mjs"
    op: update
  - path: "landing/sitemap.xml"
    op: update
related: []
tags: [wiki, docs, landing, seo]
---

[x] 위키에 핵심 개념 문서 5편 추가 — 정작 제품의 두 기둥(일지·플래너)에 설명서가 없었다

## 배경

oculpm.com/wiki 에는 문서가 6편(index·시작하기·Claude Code 연동·문제 해결·데이터 구조·단축키)
있었는데, **앱의 화면 14개 중 어느 것도 제대로 설명하지 않았다.** 특히 제품의 존재 이유인
작업 일지와, 두 번째 기둥인 플래너에 전용 문서가 없었다. 회고·검색·코드 맵·문제 해결(토의)은
이름조차 나오지 않았고, 연동 문서는 Claude Code 전용이라 나머지 어댑터 9종이 빠져 있었다.

## 변경 요약

**새 문서 5편** (`landing/wiki-src/`):

- `screens.md` — 화면 둘러보기. 사이드바 순서=⌘번호라는 규칙과 함께 14개 화면을 「기록/도구」
  두 덩어리로. 코드 검색 3모드와 코드 맵의 쓸모를 표로.
- `journal.md` — 5개 트리거, 파일 경로 규칙, frontmatter 예시, 고정 헤더 순서, 변경 diff
  영속화, 세션, 정직성 감사.
- `planner.md` — 글리프 6종, `{#id}`, 변경 로그(덧붙이기만), 결정 잠금, plan status 별
  수정 가능 여부.
- `retro.md` — 7·14·30일 구간, 지표 4종, 신호 카드, `oculpm-defer` 원장, 산출물 3종
  (AI 생성 vs Claude Code 위임), 내보내기 3경로, Eval 추이.
- `agents.md` — 어댑터 10종의 규칙 파일 경로 표, ManagedBlock vs Overwrite 구분(사용자
  콘텐츠 보존 여부), `_template.md` 마스터 전파, 자동 기록 확실성 3등급.

**순서 재편** — 0 index / 1 시작하기 / 2 화면 / 3 일지 / 4 플래너 / 5 회고 / 6 Claude Code /
7 다른 에이전트 / 8 문제 해결 / 9 데이터 / 10 단축키. 시작 → 화면 → 개념 → 연동 → 그 밖에.

**기존 문서 수정** — index 를 4개 묶음으로 재구성(v2.11→v2.14). shortcuts 에 `⌘0`(터미널)
누락 보정 — `⌘1~⌘9` 만 적혀 있어 10번째 화면이 문서에 없었다.

**sitemap 자동 생성** — 손으로 관리하던 `sitemap.xml` 에 새 문서 5편을 더하려다, 이게 바로
**문서를 추가할 때마다 재발할 드리프트**임을 알았다. `build.mjs` 가 위키 항목을 페이지 목록에서
자동 생성하도록 바꿨다 (`updated` 를 lastmod 로, 허브는 priority 0.8). 위키 밖 3개 URL 만
스크립트 상단 리터럴로 남겼다 — 늘어날 일이 드물고 lastmod 를 사람이 판단해야 해서.

## 검증

`node landing/wiki-src/build.mjs` → 11 pages + sitemap 14 urls. 스크립트로 생성 HTML 의
`/wiki/*` 내부 링크를 전부 추출해 실제 페이지와 대조 — **깨진 링크 0**. 표·콜아웃·TOC 렌더
카운트를 페이지별로 확인(예: screens 표 3·콜아웃 2).

로컬 정적 서버로 브라우저에서 육안 확인: 작업 일지·플래너 두 편을 열어 사이드바 11개 순서,
TOC, 표, 콜아웃, 중첩 목록이 정상이고 — 특히 planner.md 의 **코드펜스 안 `---` 가 front-matter
파서나 `<hr>` 로 새지 않는 것**을 확인했다 (파서가 문자열 선두 앵커라 첫 블록만 먹는다).

`landing/index.html` 은 `/wiki` 허브만 링크하므로 딥링크 수정 불필요.

## 메모

배포는 안 했다 — 랜딩은 git 연동이 없어 `cd landing && vercel --prod` 로만 나가고, 공개
사이트에 반영되는 일이라 사용자 확인을 받는 게 맞다.

문서 내용은 전부 코드에서 확인하고 적었다: 화면 목록·⌘번호는 `src/lib/navRegistry.ts`,
라벨은 `src/i18n/ko.ts`, 어댑터 10종은 `src-tauri/src/oculpm/agents/mod.rs`,
일지·플래너 규격은 `AGENTS.md`, 회고 카드는 `retro.*` 사전 키. 확신이 없는 항목은 적지 않았다.

남은 공백: 설정·테마, 터미널 도크 상세, 코드 에디터 화면, 멀티 창·탭 운용은 아직 문서가 없다.
