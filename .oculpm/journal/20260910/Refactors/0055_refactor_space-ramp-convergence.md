---
schema_version: 1
type: refactor
slug: "space-ramp-convergence"
status: done
difficulty: medium
created_at: "2026-09-10T00:55:13+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/features/code/code.css"
    op: update
related: []
tags:
  - "design"
  - "tokens"
  - "ramp"
  - "mcp-tool"
---
[x] 여백은 올림, 높이는 내림 — 중첩되는 것과 안 되는 것의 차이

## 동기

`{#ramp-space}` 는 2026-09-09 부터 결정 대기로 열려 있었다 — 램프에 5·7·9 를 **더할지**, 6·8·10 으로 **수렴**시킬지. 사용자가 2026-09-10 에 수렴을 골랐다.

램프를 넓히는 쪽을 버린 이유는 램프의 목적이다: 저단(4·6·8·10)에 5·7·9 를 끼우면 4~12 구간이 2px 격자 연속값이 되어, 다음 사람이 "7px 인가 8px 인가" 를 다시 고르게 된다. 그건 램프가 없는 것과 같다.

## 변경 요약

실측 469곳(앞 라운드의 480 에서 그동안 줄었다) 중 최상위 셋을 옮겼다 — **5(105) → 6 · 7(87) → 8 · 9(87) → 10**, 실제 변환 **267곳**(제외분 뺀 수). 리터럴을 남기지 않고 `var(--space-2|3|4)` 토큰으로 바꿨다 — 앞 라운드가 램프에 정확히 맞는 892곳을 이미 토큰화해서 온-램프 리터럴이 0 이었고, 여기서 리터럴로 되돌리면 그 규약이 깨진다.

## 올림인 이유 — 높이와 반대다

같은 날 `{#ramp-height}` 는 동점을 **내림**으로 풀었는데 여기서는 **올림**이다. 임의로 갈린 게 아니다.

**여백은 중첩되며 누적된다.** 카드 padding 안의 행 gap 안의 항목 padding — 세 겹에서 각각 1px 을 빼면 3px 이 사라지고 눈에 띄게 조인다. 게다가 램프의 바닥이 4px 이라 5→4 는 가장 작은 틈을 최소값에 붙여 버린다.

**컨트롤 높이는 중첩되지 않는다.** 버튼 하나의 높이는 옆 버튼의 높이에 더해지지 않고, 이 앱은 밀도 도구다. 그래서 거기선 내림이 맞다.

## 여백이 선택이 아니라 계산인 자리는 안 옮겼다

11곳을 뺐다.

- **`calc()` 나 음수 여백과 결합된 10곳** — `.pln-hover` · `.term-agent-pill` · `.term-block-sticky` · `.today-ring-tip` · `.plan-title-btn` · `.term-screen` · `.settings-menu` · `.code-jrnl-pop` · `.disc-seg-btn` · `.tp-picker-menu`. 여기서 여백은 다른 치수를 상쇄하는 값이라 혼자 움직이면 짝이 어긋난다.
- **`.code-tree-row` 의 `gap: 5px`** — 규칙 안에는 신호가 없어서 자동으로는 안 잡혔다. `.code-tree-guide`(width 14px · margin-right −5px)와 **다른 규칙에 걸쳐** 묶여 있어서, 들여쓰기 한 칸이 정확히 14px 이 되도록 gap 이 상쇄를 맡는다. 6px 이 되면 칸이 15px 이 된다.

마지막 하나가 이 작업의 교훈이다 — 결합 신호를 **같은 규칙 안에서만** 찾으면 규칙을 넘는 결합을 놓친다.

## 남긴 것

202곳. 11·13·14·17·18·21·22(152곳)는 이번 결정이 명시한 대상(5·7·9)이 아니어서 손대지 않았고, 24 초과 38곳은 페이지 여백·섹션 간격이라 이 램프의 구간(4~24) 밖이다. 래칫을 480 → **202** 로 내려 적었다.

## 곁다리로 고친 주석 드리프트 둘

- `code.css:107` — "24px 행에 7px 둥글기는" 이 같은 날 `{#ramp-height}` 커밋 이후 거짓이 됐다(행이 22px). **내가 만든 드리프트라 내가 고친다.**
- `agent.css:2083` — "32px 썸네일" 인데 `.user-file-thumb` 는 28px. 이건 이전부터 틀려 있었다.

## 검증

래칫을 201 로 한 칸 내려 실패시키고 되돌렸다 — 202 가 정확한 잔액임을 확인. 4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 196파일/2570 · build.

**눈으로 볼 것:** 267곳의 여백이 1px 씩 늘었다. 중첩이 깊은 자리(카드 안 목록 행, 툴바 안 버튼 그룹, 칩 줄)를 먼저 볼 것 — 누적이 거기서 제일 잘 보인다.