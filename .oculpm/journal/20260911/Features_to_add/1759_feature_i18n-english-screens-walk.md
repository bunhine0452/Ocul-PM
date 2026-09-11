---
schema_version: 1
type: feature
slug: "i18n-english-screens-walk"
status: done
difficulty: medium
created_at: "2026-09-11T17:59:41+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/i18n_english_screens.test.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/graph/GraphScreenV2.tsx"
    op: update
  - path: "src/features/graph/types.ts"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "english"
  - "overflow"
  - "harness"
  - "release-3.0"
  - "mcp-tool"
---
[x] 영어 모드 전 화면 순회 — 15화면+사이드바 렌더 스위트, 그리고 Chrome 으로 본 오버플로 넷

v3-release `{#i18n-rest}` — 플랜 문구의 "잔여 ~500줄" 은 이미 갚혀 있었다(`lint:i18n` 미번역 0, PENDING 비어 있음). 남은 것은 three-features-round 의 `i18n-overflow` 가 말한 **영어 모드 전 화면 순회 + 248px 사이드바/툴바 오버플로**였다. 두 겹으로 했다: 구조는 테스트로, 겹침은 눈으로.

## 추가 기능

**1. `i18n_english_screens.test.tsx` — 사이드바 + 15화면.** 기존 `i18n_english_render` 는 모달·패널 일곱만 본다. 새 스위트는 Today·일지·diff·플래너·검색·논의·스킬·세션·브랜치·코드 맵·편집기·Claude Code·Codex·AI 대화(+터미널은 기존 스위트)를 영어로 실제로 그려 **한글 0 · 오류 경계 폴백 0** 을 단언한다. 두 번째 단언이 중요했다: 목이 `null` 을 돌려주면 화면이 영어 폴백("This part failed to render")으로 떨어져 한글 검사는 통과하지만 빈 상태는 검사에서 빠진다 — 그래서 `oculpmApi`·`commands` 목을 메서드별 **빈 모양**(`A2aOverview`·`SkillsOverview`·`RulesOverview`·`CodeTree`·`CodeGraph`·`WorkdayBrief`·`GitRepoStatus`…)으로 맞췄다. 결과: 15/15, 한글 0.

**2. 하네스 — 그 DOM 을 Chrome 에서.** 스위트를 일회용 덤퍼로 변형해 화면별 `innerHTML` 을 쓰고, `vite build` 의 CSS 13벌을 `.app > 사이드바 + main.content` 껍데기에 입혀 `http.server` 로 띄운 뒤 Chrome 으로 1280 폭과 **최소 창 960 폭**(`.app` 폭을 JS 로 고정)에서 봤다. 라이트만 — 다크는 언어와 무관하다. 하네스는 커밋하지 않았다(재현 절차는 이 일지).

**3. 눈으로 잡은 것 넷 + 문구 하나.**
- Today 「Agents involved — **files**」: `today.unit.files` 를 돌려 썼다. 한국어 「개」는 만능 조수사라 티가 안 났던 것. `today.unit.agents` 신설.
- 코드 맵 「**0 folder** · 0 relations」: 토글 라벨(단수)과 세는 자리(복수)가 같은 키였다. `graph.unitDirs/Files` + `unitKey(mode, n)`(`types.ts` — `GraphScreenV2` 가 래칫 919 에 딱 붙어 있어 import 한 줄도 못 늘렸다).
- 스킬 「What's attached · 0 · most fired first」 머리가 960 에서 **네 줄로 낱말 접힘**, "Would it fire?" 도 세그 안에서 접힘 → `.ctx-zone-head` `flex-wrap` + 제목·부제·세그 항목 `nowrap`. 제어 묶음이 통째로 다음 줄로 내려간다.
- 검색 툴바의 검색칸이 영어 스코프 버튼 넷(Semantic/Symbols/Exact match/Include docs)에 밀려 **글자 하나 폭**으로 짜부라졌다. 2026-09-10 의 `.search-box`(기본 200·바닥 0)는 다른 자리에선 맞으니 그대로 두고, `.toolbar-actions > .search-box { min-width: 120px }` 만 — 그 아래로는 묶음이 가로 스크롤로 도망간다(2026-07-20 방어).
- 일지 부제 "0 recorded automatically" 가 1280 에서도 "0 recorded aut…" 로 잘려 "auto-recorded" 로.

나머지(툴바 sub 말줄임·액션 묶음 가로 스크롤)는 2026-07-20 좁은 창 방어가 설계한 대로 동작했고 사이드바 248px 은 영어에서도 넘치는 항목이 없었다.

## 검증

- 새 스위트 15건 통과, 수정 후 하네스 재촬영으로 넷 다 눈으로 확인(줄바꿈 정리·검색칸 바닥·"0 agents"·"0 folders"·Today 진짜 빈 상태).
- main(`522100f`) 워크트리에 10파일만 얹어 `typecheck` · `test` 212파일 2697건 · `lint` 6게이트(새 테스트를 `TESTS`·localStorage 허용목록에, `GraphScreenV2` 래칫은 헬퍼를 `types.ts` 로 옮겨 919 유지) · `build` 전부 exit 0. 커밋 `f390ee4`.
- 남는 것: 실기기(WKWebView) 영어 모드는 v3-release 의 육안 격자에서 함께 본다 — 이 하네스는 Chrome 렌더라 폰트 폭이 조금 다를 수 있다.