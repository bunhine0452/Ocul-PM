---
schema_version: 1
type: refactor
slug: "control-height-ramp"
status: done
difficulty: medium
created_at: "2026-09-10T00:49:26+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
related: []
tags:
  - "design"
  - "tokens"
  - "ramp"
  - "gate"
  - "mcp-tool"
---
[x] 2px 어긋난 두 벌이 겹쳐 있었다 — 이름 붙은 컨트롤은 이미 한쪽만 말하고 있었다

## 동기

`{#ramp-height}` — 컨트롤 높이 램프 신설. 항목은 "`height:` 리터럴 42종, 18~40px 구간에만 15종" 이라 했고, 실측은 40종 / 구간(18~34) 16종이었다. 숫자는 대체로 맞았다.

## 실측이 답을 이미 갖고 있었다

구간 안의 열여섯 가지는 무작위가 아니라 **2px 어긋난 두 벌이 겹친 것**이었다.

- 홀수 18·22·26·30·34 — **58곳**
- 짝수 20·24·28·32 — **48곳**
- 나머지 19·21·23·25·27 — 13곳

거의 반반이라 세는 것만으로는 못 고른다. 갈랐던 건 **이름이었다**: `.btn` 30 / `.btn.sm` 26 · `.chip` 22 / `.chip.sm` 18 · `.search-box` 30 / `.sm` 26 · `.seg-item` 22 · `.subnav-item` 30 — 이름 붙은 프리미티브는 하나도 빠짐없이 홀수 벌만 말하고 있었다. 짝수 벌은 이름이 없는 자리에서만 생긴 값이다(`{#design-consistency-round}` 가 앞서 배운 "리터럴은 램프에 이름 없는 자리에 생긴다" 와 같은 형태).

그래서 `--ctl-1..5 = 18·22·26·30·34`.

## 수렴 규칙

**가장 가까운 단, 동점이면 낮은 쪽.** 짝수 넷은 양쪽에서 정확히 2px 이라 전부 동점이고, 이 앱은 밀도 도구라 낮은 쪽으로 간다(tokens.css 의 여백 램프 주석이 이미 세운 원칙).

44곳을 옮겼다 — 20→18 ×10 · 21→22 ×2 · 24→22 ×13 · 25→26 ×2 · 27→26 ×1 · 28→26 ×8 · 32→30 ×8.

## 높이가 선택이 아니라 계산인 자리는 안 옮겼다

12곳을 뺐고, 각 자리에 `design-ignore` 로 사유를 적었다.

- **스위치 트랙·노브** — `.toggle` 23 = 노브 19 + 여백 2·2, `.cfg-switch` 20 = 노브 16 + 2·2. 트랙만 램프에 맞추면 노브가 트랙을 뚫는다. 이건 디자인 값이 아니라 산술 결과다.
- **마크·스와치·썸네일** — `.hg-mark` · `.home-mark` · `.mob-brand` · `.wz-accent` · `.tl-dot` · `.tsm-swatch` · `.user-file-thumb` · `.mob-tab-icon`. 컨트롤이 아니라 글리프·면이라 아이콘 램프(11·13·15·18·22·30)의 몫이다.
- **`.sub-check` 19** — 짝인 `.next-check` 가 17 로 램프 구간 밖이라, 혼자 옮기면 두 체크박스가 어긋난다.

게이트를 세운 뒤 돌려 보니 **정확히 그 12곳**을 짚었다 — 손으로 만든 제외 목록과 게이트가 독립적으로 같은 답을 냈다.

## 프리미티브가 램프를 입는다

토큰을 만들어 놓고 안 쓰면 이 Phase 이름("세워 놓고 안 쓴 것들")을 반복하는 것이다. 이름 붙은 컨트롤 8곳(`.btn` · `.btn.sm` · `.chip` · `.chip.sm` · `.search-box` · `.search-box.sm` · `.tbadge` · `.seg-item` · `.subnav-item`)이 `var(--ctl-N)` 을 입어 primitives.css 에 남은 `height` 리터럴은 둘뿐이다(1px 구분선, 6px 점).

**전면 토큰화는 안 했다.** 구간 안 리터럴에는 스파크라인·진행 트랙처럼 컨트롤이 아닌 것이 섞여 있어서, 전부 `--ctl-*` 로 부르면 이름이 거짓말을 한다. 값이 램프에 있는지는 게이트가 리터럴 그대로 본다.

`--iconbtn-size` 의 네 단(26/28/30/32)은 손대지 않았다 — `{#unify-chips}` 가 갖는 항목이고, 그때 이 램프를 쓰면 28·32 가 사라져 두 단이 된다.

## 게이트

**규칙 19** (`checkControlHeights`) — 18~34px 구간의 `height` 리터럴이 다섯 단 밖이면 위반. 구간 밖(점·막대·글리프 / 면)은 안 본다. 예외는 `design-ignore` 에 사유를 적는 것 하나뿐.

## 검증

probe: 한 줄 위반 · 여러 줄 규칙 위반 둘 다 정확한 줄로 잡혔고, 램프 위 값 둘 · 구간 밖 둘 · `design-ignore` 하나는 통과했다. 4게이트 각각 exit 0 — typecheck · lint(경고 9, 기준선) · test 196파일/2570 · build.

**눈으로 볼 것:** 44곳이 2px 씩 움직였다. 특히 탭 스트립(`.tabstrip-tab` 32→30, 38px 스트립 안), ACP 탭(28→26), 컴포저 전송 버튼(32→30), 프로젝트 관리자 버튼(32→30)처럼 짝을 이루는 자리를 함께 볼 것.