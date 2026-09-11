---
schema_version: 1
type: feature
slug: "entry-detail-reading-column"
status: done
difficulty: medium
created_at: "2026-09-11T00:54:44+09:00"
session_id: "20260911-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "92ce8d00-a4db-415f-bf32-9aadc51394a3"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/entry.css"
    op: create
  - path: "src/features/oculpm/EntryMasthead.tsx"
    op: create
  - path: "src/features/oculpm/EntryFileList.tsx"
    op: create
  - path: "src/features/oculpm/EntryFileBar.tsx"
    op: create
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related:
  - ref: "20260911/Features_to_add/0021_feature_journal-ledger-redesign.md"
    kind: "followup"
tags:
  - "journal"
  - "design"
  - "ui_v2"
  - "mcp-tool"
---
[x] 작업 일지 열람 — 사이드바 신세였던 본문을 읽는 칸으로

## 추가 기능

사용자 요청 「작업일지에서 클릭하면 보이는 화면을 공격적으로 수정해서 업그레이드해줘. 본문의 가독성이 별로야」. 스크린샷 진단: 왼쪽 320~440px 칸에 메타·파일 목록·서술이 위에서부터 쌓여 **일지의 본문이 사이드바 신세**였다 — 파일 목록이 칸의 절반을 먹어 서술은 접힌 곳에서 시작했고, 13px 회색 글자에 테두리 친 코드 칩이 `word-break: break-all` 때문에 칸이 남아도 `toLocaleDa|teString` 처럼 낱말 가운데서 꺾였다. 툴바 sub 에는 종류·출처·날짜·작성자 칩이 다섯 개였고 본문 위에는 태그만 떠 있어 문서가 머리 없이 시작했다.

왼쪽을 **읽는 칸**으로 다시 짰다 — 원장(journal-ledger-redesign)에서 누른 행이 그대로 펼쳐진 모양이다.

- **마스트헤드** (`EntryMasthead.tsx`) — 원장 행의 척추(종류색 `--c` 토막)가 그대로 문서의 척추가 된다. 종류 · 미완료/중단 표시 · 날짜/시각(mono) · 작성자 · 큰 제목(`--fs-9`, `plainTitle` 로 마크다운 표식 제거) · 발치에 태그·관련 일지(`.chip sm`)·「변경된 파일 N」 링크. 메타 승격 규칙은 원장과 같다: 에이전트 출처는 배지를 달지 않는다. 툴바 sub 에는 파싱 경고만 남는다.
- **본문** — 14px · 1.7 · `--text`(회색 아님) · h2 는 절 사이 실선 · 인라인 코드는 테두리 없이 바탕 한 장에 `word-break: normal; overflow-wrap: anywhere` (통째로 다음 줄, 안 들어갈 때만 끊음) · 불릿은 중립색 점 · 표는 가로 스크롤.
- **부록** (`EntryFileList.tsx`) — 변경된 파일 목록은 본문 **뒤**로. 머리에 M/A/D 건수 요약과 필터(8건부터). j/k 로 활성 행을 따라가되 **부록이 화면에 보일 때만** 스크롤한다 — 읽는 중에 아래로 끌려가면 안 된다.
- **파일 바** (`EntryFileBar.tsx`) — 경로 자체가 버튼이고 누르면 목록이 `role=listbox` 메뉴로 떨어진다(부록까지 안 내려가고 아무 파일이나 연다). Esc 는 **document 캡처 단계**에서 삼켜 메뉴만 닫고, 부모의 Esc=목록으로 는 먹지 않는다. 다른 파일로 옮기면 자동으로 닫힌다.
- **경계 리사이저** — 플래너 레일과 같은 규격(`.pln-rail-resizer`). 380~860px, 더블클릭 기본 520, ←/→ 16px, diff 칸은 320 아래로 안 좁아진다. 값은 워크스페이스 `entryReadWidth` 에 남는다.
- **좁은 칸** — `@container entry (max-width: 720px)` 에서 위아래로 쌓인다. 컨테이너는 자기 쿼리로 자기를 못 고치므로 `flex-direction` 대신 자식 둘을 `flex: 0 0 100%` 로 만들어 `flex-wrap` 으로 감았다(하네스에서 안 접히는 걸 보고 잡았다).
- CSS 는 `features/oculpm/entry.css` 로 분리 — screens.css 의 `.entry-detail*`/`.efb-*`/`.entry-narrative` 세 블록 143줄 제거, `.entry-date-chip` 은 primitives 칩 가족·디자인 게이트 목록에서 퇴역. 부록 클래스는 수동 일지 모달이 이미 쓰는 `.entry-files` 를 피해 `.entry-appendix` — 하네스에서 부록이 회색 상자로 찍혀 잡은 충돌.

## 동작 흐름

데이터·훅·키 계약은 무변경(getJournalEntry/getEntryDiffs · 라이브 재로딩 · j/k · `/` · Esc · 확인/파일로 열기/규칙 승격). 759줄 한 파일을 넷으로 갈랐고 `files` 의 exhaustive-deps 경고 하나를 useMemo 로 걷었다. 기존 테스트 셀렉터(`.entry-filelist .dfile` · `.efb-dir` · `.efb-count` · 「파일 찾기」 · 「이전 파일」)는 그대로 맞는다.

## 검증

- typecheck(제 변경분) · vitest 2647 · vite build · lint:design · lint:filesize · lint:js(9/9) 초록. lint:bindings·lint:i18n·tsc 는 병렬 세션의 미커밋 `gitDecor.ts`·`terminal_scrollback_replay.test.ts`·`CodeScreenV2.tsx` 에서만 붉고 제 변경분은 0.
- 새 테스트 4: 마스트헤드(종류·날짜·작성자·표식 벗긴 제목·태그·부록이 본문 뒤) · 미완료 표시 · 파일 메뉴(열기·고르기·Esc 는 메뉴만) · 리사이저 키보드.
- DOM 덤프 + 실제 CSS 하네스로 라이트/다크/640px 확인 — 위 두 결함(`.entry-files` 충돌 · 컨테이너 자기 쿼리)을 여기서 잡았다. WKWebView 실기기는 v3-release `{#eyes-journal-ledger}` 에 덧붙여 이월.