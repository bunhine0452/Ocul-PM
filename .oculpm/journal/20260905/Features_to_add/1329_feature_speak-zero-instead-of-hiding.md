---
schema_version: 1
type: feature
slug: "speak-zero-instead-of-hiding"
status: done
difficulty: medium
created_at: "2026-09-05T13:29:02+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/JournalMissingCard.tsx"
    op: update
  - path: "src/features/retro/MissingSessions.tsx"
    op: create
  - path: "src/features/retro/SignalsPanel.tsx"
    op: create
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/__tests__/retro_missing_line.test.tsx"
    op: create
  - path: "src/__tests__/today_journal_missing.test.tsx"
    op: update
related: []
tags:
  - "정직성"
  - "회고"
  - "today"
  - "v3"
  - "mcp-tool"
---
[x] 0건일 때 숨는 대신 0을 말한다 — 깨끗함과 가려짐은 다르다

## 추가 기능

일지 없이 끝난 세션 카드는 신호가 0건이면 통째로 숨었다(`if (loading || signals.length === 0) return null`). 깨끗한 날에 소음을 안 내려는 의도였는데, 이 카드의 판정이 근사라는 것이 문제였다 — 백엔드가 "프로젝트 전역 최신 일지보다 오래된 신호"를 해소로 보고 걷어내고, 훅이 없는 에이전트의 세션은 애초에 신호를 남기지 않는다.

그래서 자기은닉은 화면에서 **정말 깨끗함과 가려짐을 똑같이 보이게** 만들었다. 기록 누락을 말해 주는 것이 존재 이유인 카드에서 가장 나쁜 실패다.

## 동작 흐름

0건에 초록 체크를 그리면 그건 거짓말이다. 대신 0건 상태는 숫자와 **판정의 한계**만 조용히 적는다 — 경고 테두리를 `--border-card` 로, 카운트 색을 `--warn` 에서 `--text-3` 로 낮추고 행 목록·설정 버튼을 뺀다.

문구는 두 사각을 이름으로 부른다: *"훅이 남긴 세션 종료 신호만 셉니다 — 훅이 없는 에이전트의 세션, 그리고 뒤이어 일지가 쓰이면서 해소로 걷힌 신호는 여기 나타나지 않아요. 0건은 「확인된 누락 없음」이지 「기록이 완전함」은 아닙니다."* 이 두 문장은 판정이 세션 귀속으로 바뀌어도 여전히 참이라 다시 쓸 필요가 없다.

**분모는 지어내지 않았다.** 이 커맨드는 미기록 신호만 돌려주므로 "몇 세션을 봤는지"는 알 수 없다. 없는 숫자를 만드느니 관측 창(최근 N일)과 판정 재료(훅이 남긴 세션 종료 신호)를 밝혔다.

회고에는 상시 한 줄(`기록 정직성`)을 넣었다. **loading·오류·빈 기간 분기보다 위**에 둬서 어떤 화면 상태에서도 사라지지 않는다 — 안에 두면 이 작업이 고치려는 자기은닉을 그대로 재현한다. 기간은 화면이 고른 창을 따른다(30일 회고에 "이번 주" 한 줄이 뜨면 두 숫자가 서로를 반박한다). 조회 실패는 0건과 다르게 말한다("지금은 몇 건인지 알 수 없어요" + 다시 시도).

응답에서 `.length` 만 읽는다 — 백엔드 판정이 세션 귀속으로 갈아엎어져도 프런트가 그대로 살도록 일부러 얇게 붙였다.

`RetroScreenV2` 가 크기 래칫에 닿아 `SignalsPanel`·`Stat`·`Card` 를 별도 파일로 뺐다(820→626줄). `retro/` 의 다른 패널 넷은 이미 별도 파일이었으니 원래 쪼개졌어야 할 자리다.

## 검증

신규 테스트에 한글 리터럴을 쓰지 않고 단언을 전부 `t()` 로 구성했다 — i18n 게이트의 예외 목록을 건드리지 않으면서 숫자 보간까지 실제로 검증된다. 0건 렌더 · 0→N 전이 · 빈 기간 · 조회 실패 4케이스. `typecheck`·`lint:design`·`lint:i18n` 통과.

## 메모

**`HonestyAudit`(`today/HonestyAudit.tsx:97`)에 같은 결함이 남아 있다.** 가르는 선은 이렇다 — **주장하는 카드는 0을 말해야 하고, 제안하는 카드는 숨어도 된다.** `TodaySuggestions`·`EvalTrend`·`DeferLedger`·`RuleCandidates` 는 숨어도 되지만 `HonestyAudit` 은 "누락 없음"을 주장하므로 앞쪽이다. 이번 플랜 항목 밖이라 손대지 않았다.

훅이 아예 없는 프로젝트의 0건은 여전히 애매하다. "관측 자체가 없음"과 "관측했고 0건"은 다른 상태인데 지금은 한계 문구로만 덮는다. `claudeHooksStatus` 로 구별하는 것을 검토했다가 뺐다 — 그 커맨드는 프로젝트 `.claude/settings.json` 을 보는데 신호를 남기는 건 사용자 전역 플러그인 훅일 수 있어 잘못된 "미설치" 주장을 만들 위험이 있다.