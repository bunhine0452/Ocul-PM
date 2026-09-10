---
schema_version: 1
type: feature
slug: "journal-ledger-redesign"
status: done
difficulty: medium
created_at: "2026-09-11T00:21:48+09:00"
session_id: "20260911-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "ce6e3504-bf40-48a3-95c2-7760471489a8"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/journal.css"
    op: create
  - path: "src/features/oculpm/JournalRow.tsx"
    op: create
  - path: "src/features/oculpm/JournalDay.tsx"
    op: create
  - path: "src/features/oculpm/JournalCardV2.tsx"
    op: delete
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/provenance_rows.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "journal"
  - "design"
  - "ui_v2"
  - "mcp-tool"
---
[x] 작업 일지 화면 — 카드 더미를 원장(ledger)으로

## 추가 기능

사용자 요청 「이 작업일지 화면을 공격적으로 개편해서 디자인을 업그레이드 해줘」. 스크린샷 진단: 카드마다 「에이전트 · Claude Code · Fable 5.1」 이 되풀이되고, 종류 아이콘이 타임라인 점과 배지에 두 번 찍히고, 툴바에 칩이 아홉이고, 한 화면에 다섯 장. 일지는 하루치가 수십 건 쌓이는 기록부인데 화면은 카드 갤러리였다.

- **원장 행** (`JournalRow.tsx`, `JournalCardV2` 대체) — `[시각 | 척추 | 제목+메타]` 격자. 상자·그림자·아이콘 배지 없이 구분선만. 척추 한 토막이 그 항목의 종류색(`--t-*`)이라 내려 읽으면 하루가 막대그래프로 보인다. 행 전체가 버튼. 제목은 2줄 클램프 + 인라인 마크다운 표식(`**`·`` ` ``) 제거(`plainTitle`).
- **날짜 머리글** (`JournalDay.tsx`) — 큰 날짜·요일(`toLocaleDateString`, 사전 키 없음)·건수, **하루의 모양**(항목마다 한 조각인 색띠, 왼쪽이 아침), 종류별 건수 범례, 작성자 명단. 스크롤 중 sticky.
- **메타 승격 규칙** — 그날 안에서 값이 하나뿐인 작성자·출처는 머리글이 한 번 말하고, 행에는 달라지는 것만 남는다. 에이전트 출처는 기본값이라 섞인 날에도 배지를 달지 않는다(작성자 이름이 그 말을 한다).
- **툴바** — 종류 칩 6개 → `.seg` 세그먼트 하나, 칸마다 종류색 점(본문 척추·범례와 같은 색). 미완료·확인됨·새 일지는 그대로.
- **날짜 레일** — 눈금마다 건수 막대(분모 = 최다).
- CSS 는 `features/oculpm/journal.css` 로 분리(`home.css` 관용구). screens.css 의 `.tl`/`.jcard`/`.day-head`/`.date-rail` 블록 87줄 제거.

## 동작 흐름

데이터·훅·핸들러 계약은 무변경(`useJournalDays`, `openByPath`, focus 링, 25건 페이지, 출처 레일). 테스트 셀렉터(`getByText("버그")`, `aria-expanded`, radio 「MCP」)도 그대로 맞는다. `provenance_rows.test` 의 카드 케이스는 날짜 절 기준으로 다시 썼다(에이전트만 → 출처 없음 / 자동화만 → 머리글 1회 / 섞임 → 행마다 / 작성자 하나·둘).

## 검증

- typecheck · vitest 2622 · build 초록. lint 는 다른 세션의 미추적 `code-frame.css` 1건만 붉고 제 변경분은 0.
- DOM 덤프 + 실제 CSS 하네스로 라이트/다크/620px 확인: 세그먼트 점 인라인 크기 죽음 → `display:inline-block`, 좁은 폭 시각 줄바꿈 → `white-space:nowrap` 두 건을 잡아 고쳤다. 실기기 확인은 v3-release 육안 격자로 이월.