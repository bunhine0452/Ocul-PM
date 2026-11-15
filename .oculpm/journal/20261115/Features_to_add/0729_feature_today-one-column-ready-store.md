---
schema_version: 1
type: feature
slug: "today-one-column-ready-store"
status: done
difficulty: high
created_at: "2026-11-15T07:29:37+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/local_only.rs"
    op: update
  - path: "src-tauri/src/git/local_only_tests.rs"
    op: update
  - path: "src/__tests__/todayFixture.ts"
    op: create
  - path: "src/__tests__/todayRender.tsx"
    op: create
  - path: "src/__tests__/today_actions.test.tsx"
    op: create
  - path: "src/__tests__/today_keyboard.test.tsx"
    op: create
  - path: "src/__tests__/today_local_only.test.tsx"
    op: update
  - path: "src/__tests__/today_narrow_empty.test.tsx"
    op: create
  - path: "src/__tests__/today_num.test.tsx"
    op: update
  - path: "src/__tests__/today_one_column.test.tsx"
    op: create
  - path: "src/__tests__/today_question.test.tsx"
    op: create
  - path: "src/__tests__/today_receipt_rules.test.ts"
    op: create
  - path: "src/__tests__/today_store.test.tsx"
    op: create
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/components/VerdictLine.tsx"
    op: update
  - path: "src/components/verdictLine.css"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayWork.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/today/todayFormat.tsx"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
related: []
tags:
  - "오늘"
  - "today"
  - "quality-round"
  - "mcp-tool"
---
[x] 오늘: 한 기둥으로 접고 열면 바로 서게 했다

## 추가 기능

업그레이드 라운드 레인 「오늘」(계획 quality-round-20261115). 사용자가 앱을 열면 처음 보는 화면 — 「심플하다 · 달라졌다」가 여기서 갈린다.

- **한 기둥 · 숫자 한 줄(TD-01)**: 「먼저 볼 것」 밖에 쌓이던 한 줄 넷(내 차례 · 닫을 계획 · 받아 온 일지 · 이 기기에만)을 날짜 줄 오른쪽 숫자 한 줄로(0 은 안 그림, 숫자마다 링크). 「다음」 은 「먼저 볼 것」 의 마지막 행. 「검증 없이 끝난 일지」 는 왼쪽 기둥으로 올라와 5행 + 「N건 더」. 같은 수를 두 번 말하던 「기록 N건」 걷음.
- **열면 이미 서 있다(TD-02)**: 셸 배지와 화면이 프로젝트별 모듈 저장소 하나를 같이 구독 — 탭에 올 때마다 뼈대가 다시 서고 820 → 1180px 로 옆으로 옮기던 것이 없다. 다시 읽다 실패하면 앞 값을 지키고 「14:12 이후 못 읽음 · 다시 시도」 한 줄(오류 카드는 한 번도 못 읽었을 때만). 늦게 온 옛 응답은 버린다. 창 포커스마다 git 세 번이던 것을 10초 스로틀.
- **키보드(TD-03)**: j/k · ↑↓ · Home/End · ↩ · v(읽음) · r(실행) · Esc, 행이 빠져도 포커스가 body 로 안 떨어진다.
- **질문은 편지처럼(TD-04)**: Claude 의 질문이 화면에서 가장 가벼운 글자로 보이던 것 — 질문 행이 두 칸을 다 쓰고 줄바꿈되며, 보내기는 보통 단추(채운 단추는 「다음」 하나). 굵기 세 단계.
- **색과 기계 글씨(TD-05)**: 초록 점 · 강조색 링크 걷음(색은 예외에만), 시각은 mono.
- **예외마다 다음 한 걸음(TD-06)**, **좁은 창 · 빈 상태 · 낱말(TD-07)**: 640 에서 예외 행이 두 줄로 접힌다. 칩은 4자 이하.

## 동작 흐름

`useTodayExceptions.ts` 안 `createStore` 저장소가 프로젝트마다 마지막 값 · 요청 번호 · 못 읽은 시각을 들고, 셸(배지)과 화면 인스턴스가 같은 값을 본다(반환 모양은 그대로라 ShellV2 는 안 고침).

## 검증

- 레인 게이트: vitest 116 files passed · typecheck · lint · build exit 0. 리뷰 둘(major 8, 수용 기준 부분 미달 넷) 반영 — 커밋했지만 안 올린 일지도 「이 기기에만」 에 센다.
- 합류 뒤: `pnpm test` 1652 passed · `cargo test` 1202 passed 0 failed(local_only.rs 포함). 설치본에서 눈으로 보지는 않았다.

## 메모

- 「N건 더」 를 일지 화면 「검증 없는 것만」 으로 여는 것은 그 거르기가 일지 화면 지역 상태라 이음 레인이 잇는다.
- 일지 없이 끝난 대화의 칩은 「일지 없음」 — 「일지 없는 변경」 과 같은 상태 · 같은 칩(영수증 규칙 4).