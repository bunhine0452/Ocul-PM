---
schema_version: 1
type: bug
slug: "real-css-screenshot-sweep-polish-3"
status: done
created_at: "2026-09-20T02:15:31+09:00"
session_id: "20260920-002"
agent:
  id: "claude-code"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 실제 CSS 스크린샷 순회가 낸 완성도 결함 3건 — Today 조사 공백 · 브랜치 비-git 오류카드 · 검색 빈 상태

## 요약

"더 매력적이고 완성도 있게" 라는 요청을 눈으로 검증 가능한 것으로 좁혔다. 설치본이 돌고 있어 dev 빌드를 못 띄우므로, vitest 로 화면 DOM 을 덤프하고 `dist/` 의 빌드 CSS 를 입혀 브라우저에서 17개 화면(시작 탭 빈/풍부·Today·일지·영어 14화면)을 라이트/다크로 찍었다. 대부분은 이미 완성도가 높았고, 코드로 확정된 결함 3건만 고쳤다. 커밋 `6b07bf1b`.

## 원인

- **Today 히어로 조사 공백.** JSX 가 `{prefix}{" "}<span>{count}</span>{" "}{suffix}` 로 언어와 무관하게 공백을 끼워 한국어에서 "오늘 4건 의 작업이 기록됐어요" 로 조사가 떨어졌다. 가장 많이 보는 헤드라인이다.
- **브랜치 화면의 오류 카드.** `useBranchStory` 가 목록과 이야기를 `Promise.all` 로 함께 물어, git 저장소가 아니거나 첫 커밋 전이면 백엔드의 "Not a git repository." / "This repository has no local branch yet." 거절이 재시도 버튼 달린 **오류 카드**가 됐다. 정상 상태를 실패처럼 보였다. (mock 이 빈 목록을 주는 영어 순회에서는 아예 빈 화면이었다.)
- **검색 빈 상태.** 검색어 전 상태가 `plain` 한 줄 문장뿐이라 플래너·diff·코드맵·스킬의 아이콘+제목+본문 규약과 어긋나 '덜 만든 화면' 으로 읽혔다.

## 변경

- Today: 이음 공백을 문자열로 옮겼다 — ko `today.headlineSuffix` 는 "의 작업이…", en 은 " pieces of work today"(앞 공백). JSX 는 count 뒤 `{" "}` 제거.
- 브랜치: 목록을 먼저 묻고 비어 있으면 이야기를 묻지 않는다. `Not a git repository` 거절은 빈 목록과 같은 갈래. 화면은 `!loading && !story && !error` 에 `EmptyState(rich, GitBranchIcon, branch.noRepoTitle/noRepo)`. 다른 오류는 그대로 ErrorCard.
- 검색: `EmptyState density="rich" icon={스코프 아이콘} title={search.emptyTitle}` + 스코프별 힌트. `SCOPES.icon` 타입을 `IconComponent` 로.
- i18n 키 3개 ko/en 동시 추가 (`search.emptyTitle`, `branch.noRepoTitle`, `branch.noRepo`).

## 검증

- `pnpm typecheck` / `test`(218 파일 2740 통과) / `lint` / `build` 각 exit 0.
- 하네스 재촬영으로 세 화면 육안 확인: "오늘 4건의 작업이 기록됐어요", 브랜치 빈 상태(아이콘+제목+본문), 검색 빈 상태(나침반 아이콘+"What are you looking for?").
- 하네스 파일(`zz_shot_*.test.tsx`)은 한글 게이트에 걸리므로 지웠고, `dist/shots` 도 지웠다.

## 남은 것

- 스크린샷에서 보였지만 손대지 않은 것: 일지 툴바가 1360px 창에서 부제("6건의 자동 기록")를 자른다 — 액션 묶음이 폭을 다 써서, 문자열이 아니라 툴바 밀도의 문제. 영어 순회에서 사이드바 AI/REFERENCE 그룹이 비어 보인 건 테스트 mock 의 산물(실제 앱 아님).
- 설치본 실기기 확인은 `{#eyes-round-0914}` 원장에 얹힌다.