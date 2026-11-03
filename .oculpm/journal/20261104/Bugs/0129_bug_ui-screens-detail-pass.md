---
schema_version: 1
type: bug
slug: "ui-screens-detail-pass"
status: done
difficulty: medium
created_at: "2026-11-04T01:29:38+09:00"
session_id: "mcp-20261104-012938"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/theme/projectTint.ts"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: update
  - path: "src/features/terminal/send.css"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
related:
  - ref: "20261103/Bugs/1959_bug_ui-audit-fixes-20261103.md"
    kind: "followup"
tags:
  - "디자인"
  - "ui-audit"
  - "design"
  - "mcp-tool"
---
[x] 디자인: 화면마다 세부를 다듬는다

사용자 요청(11-04): 「세심하게 꼼꼼히 메인화면부터 설정화면까지 전부 손봐줘」. 영수증 철학(PR #163) 다음 단계로, 하네스에서 2배 해상도로 찍어 화면마다 사분면을 확대해 봤다.

## 발생 원인
- 프로젝트 색은 바탕 셋(창 · 목록 칸 · 본문)만 물들이고 `--bg-inset` 은 11-03 에 뺐다. 그래서 푸른 바탕 위에 따뜻한 베이지 검색칸 · 코드 · 변경 머리줄 · 줄 번호가 서서 한 화면에 온도가 둘이었다.
- 계획 항목 줄이 `align-items: baseline` 이라 글자 없는 상태 상자의 바닥이 기준선에 앉아, 상자가 글보다 4px 위에 떴다. 빈 상자 테두리(`--sep-strong`)는 밝은 테마에서 거의 안 보였다. 칩은 제목 옆 별도 칸이라 제목이 꺾이면 첫 줄 오른쪽에 떴다.
- 변경 목록의 폴더는 끝에서 말줄임돼 `src/features/she…` 가 됐다.
- 일지 본문의 인라인 코드가 어디선가 굵기 600 을 물려받았다(계산값으로 확인).
- 대화창의 `<select>` 는 브라우저 기본 굵은 화살표, 본문 칸은 고정폭이라 한글 낱말 사이가 벌어졌다. `.kbd` 는 고정폭이라 `⌘O` 가 `⌘0` 으로 읽혔다.

## 해결 방법
- `TINTED` 에 `--bg-inset` 을 되돌렸다(카드만 그대로). 주석에 11-03 → 11-04 이유를 남겼다.
- `.plv-anchor` 를 `align-self: flex-start; height: 1lh; align-items: center` 로, 빈 상자 테두리는 `color-mix(text-2 55%)`, 칩은 `.plv-item-t` 안으로.
- `.chg-dir` 는 `direction: rtl` + `<bdi>` 로 앞쪽 말줄임.
- `.jd-prose :not(pre) > code` 에 `font-weight: var(--fw-body)`.
- 공용 `.select-wrap`(가는 꺾쇠 ::after) — 새 일지 대화창 둘, 터미널 보내기 하나. 체크 칸 `accent-color`. 대화창 본문 칸은 본문 서체, 홀로 선 안내는 라벨 선에. `.kbd` 는 본문 서체 + tabular-nums.
- 오늘의 단축키 줄을 위 줄과 같은 왼쪽 선에(`padding: 0 2px`).

## 검증
밝게 · 어둡게 · 파랑 · 장미 · 호박 · 색 없음으로 다시 찍어 봤다.
```
impeccable detect --json <바꾼 CSS> → []
pnpm test → Tests 1049 passed (1049)
pnpm typecheck / pnpm lint / pnpm build → exit 0
```
PR #164.