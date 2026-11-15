---
schema_version: 1
type: bug
slug: "glue-cross-lane-gaps"
status: done
difficulty: medium
created_at: "2026-11-15T08:26:07+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/css_one_home.test.ts"
    op: create
  - path: "src/__tests__/primitives_v2.test.ts"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
  - path: "src/__tests__/helpers/diffFx.ts"
    op: update
  - path: "src/__tests__/ime_cases.test.ts"
    op: update
  - path: "src/__tests__/send_terminal_selection.test.ts"
    op: update
  - path: "src/__tests__/term_keys.test.ts"
    op: update
  - path: "src/__tests__/term_keys_agent.test.ts"
    op: create
  - path: "src/__tests__/terminal_cheatsheet_rows.test.tsx"
    op: create
  - path: "src/__tests__/terminal_peek_tracking.test.tsx"
    op: create
  - path: "src/__tests__/terminal_session_names.test.tsx"
    op: create
  - path: "src/__tests__/terminal_store_signals.test.ts"
    op: create
  - path: "src/__tests__/xtermHarness.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/features/terminal/TermImagePeek.tsx"
    op: update
  - path: "src/features/terminal/TermToolbar.tsx"
    op: update
  - path: "src/features/terminal/agentScreen.ts"
    op: create
  - path: "src/features/terminal/attention.ts"
    op: update
  - path: "src/features/terminal/imagePeek.ts"
    op: update
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/termKeys.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/__tests__/journal_day_words.test.tsx"
    op: create
  - path: "src/__tests__/korean_layout_keys.test.tsx"
    op: create
  - path: "src/__tests__/screenMux.ts"
    op: create
  - path: "src/__tests__/today_keyboard.test.tsx"
    op: update
  - path: "src/__tests__/today_more_journal.test.tsx"
    op: create
  - path: "src/__tests__/today_one_column.test.tsx"
    op: update
  - path: "src/features/oculpm/JournalList.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/onlyMissing.ts"
    op: create
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/features/oculpm/useJournalSearch.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/lib/workdayLabel.ts"
    op: update
related:
  - ref: "20261112/Bugs/0326_bug_ime-double-after-alt-v.md"
    kind: "followup"
tags:
  - "합류"
  - "terminal"
  - "ui"
  - "quality-round"
  - "mcp-tool"
---
[x] 합류: 레인 사이에 남은 빈칸 열둘을 이었다

## 발생 원인

레인 여덟이 파일 소유를 지키느라 「레인 밖이라 못 고쳤다」 고 남긴 것들이다(계획 quality-round-20261115). 같은 규칙의 사본, 반쯤 이어진 배선, 화면마다 다른 말이 합류 뒤에 남았다. 하나는 회귀였다 — Shift+Enter 를 대체 화면이면 어떤 프로그램이든 ESC CR 로 바꿔, vim 입력 모드에서 Shift+Enter 가 ESC(입력 모드 나감)가 됐다.

## 해결 방법

- G-01 세그먼트 고른 칸 선택자를 `primitives.css` 한 규칙(`:is([aria-selected], [aria-checked], [aria-pressed])`)으로, 변경 화면 · 오늘의 사본 규칙을 걷었다.
- G-02 터미널 단축키 표에 ⌘L(고른 출력을 Claude 에게) · ⇧↩(Claude 입력에서 줄바꿈).
- G-03 Shift+Enter 는 에이전트 상태 신호(OSC 7501)가 온 화면에서만 ESC CR — `agentScreen.ts` 가 대체 화면에 들어선 뒤 신호를 본 세션만 기억하고, 보통 화면으로 돌아오면 잊는다(뒤이어 같은 셸에서 연 vim 에는 안 간다).
- G-04 보내기 토스트의 「터미널 n」 을 탭 번호로, 알림 제목은 탭 이름(대화 제목).
- G-05 「최근 소식 없음」 다시 세움(termStore 가 출력 · 상태마다 활동 시각을 적는다).
- G-06 마우스를 쓰는 전체 화면 위 그림 미리보기 안내는 수식키를 말한다.
- G-07 아이콘 재수출 · 쓰이지 않는 키 · 「레인」 → 「시도」 · 낡은 주석.
- G-08 좁은 창 변경 바닥줄의 옛 규칙 사본 걷음. G-09 일지 날짜 머리를 앱 공통 말(`workdayLabel`)로. G-10 두벌식 키 시험(일지 · 계획 · 변경). G-11 오늘의 「N건 더」 → 일지 화면 「검증 없는 것만」(`onlyMissing.ts` 로 넘김). G-12 시작 창 설정(합류 이음에서 먼저 고침, 확인만).

## 검증

- 레인 게이트: vitest 185 files · 1686 passed · typecheck · lint · build exit 0. 합류 뒤 `pnpm test` 1745 중 1743 passed(남은 둘은 Claude 테마 표 — 따로 고침) · `cargo test` 1211 passed 0 failed.
- 이 커밋 셋은 워크트리 기준이 어긋나 수정 담당이 다시 만든 워크트리에서 구현했고 독립 리뷰를 거치지 않았다 — 최종 검수가 따로 본다.

## 메모

- 남긴 것: Claude 의 외부 편집기(Ctrl+G)에서 돌아온 직후엔 다음 상태 신호까지 Shift+Enter 가 CR 이다(vim 오탐을 막는 맞바꿈). `screens-overflow.css` 의 죽은 `.diff-entry-foot .btn.ok`(초록 — 영수증 규칙 1 위반)는 최종 검수에서 다룬다. 쓰이지 않게 된 키 today.unread.less · journal.dayYmd.