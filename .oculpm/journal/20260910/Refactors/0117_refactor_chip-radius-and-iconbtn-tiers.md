---
schema_version: 1
type: refactor
slug: "chip-radius-and-iconbtn-tiers"
status: done
difficulty: medium
created_at: "2026-09-10T01:17:38+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/features/graph/graph.css"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
related: []
tags:
  - "design"
  - "primitives"
  - "gate"
  - "mcp-tool"
---
[x] 같은 26px 높이에 곡률이 넷이었고, 아이콘 버튼의 네 단 중 둘은 아무도 안 쓰던 칸이었다

## 동기

`{#unify-chips}` — 칩 11벌을 2단으로, 아이콘 버튼 `--iconbtn-size` 네 단도 함께.

## 높이는 이미 정리돼 있었다

항목은 "높이 18·22·23·25·28px" 이라 했는데, 같은 날 `{#ramp-height}` 가 이미 접었다 — 지금은 18·22·26 셋이고 전부 `--ctl` 램프 위다. 남아 있던 진짜 문제는 **곡률**이었다.

## 진짜 결함 — 같은 높이에 곡률이 넷

칩 무리 열넷이 `xs`·`s`·`m`·`pill` 을 나눠 갖고 있었고, 결정적으로 **26px 짜리 넷이 곡률 넷**이었다:

| 칩 | 높이 | 곡률 |
|---|---|---|
| `.gr-chip` | 26 | pill |
| `.agent-chip` | 26 | m |
| `.scope-chip` | 26 | m |
| `.file-pill` | 26 | s |

항목이 "한 줄에 서면 광학 중심이 어긋난다" 고 한 게 이것이다. `{#radius-ramp}`(3.0) 가 이미 **똑같은 문장**을 적어 뒀었다 — "같은 크기의 라벨 넷이 곡률 넷". 그때는 리터럴을 이름으로 접었고(7px → `--radius-s`), 이름끼리 갈린 것은 남았다.

## 규칙 — 곡률은 칩이 **어떻게 크는지**를 따른다

정본은 또 프리미티브에 있었다. `.chip` 은 `--radius-s`, `.chip.sm` 은 `--radius-pill` — 두 단이 이미 선언돼 있었고 나머지가 안 따랐을 뿐이다.

- **높이가 정해진 칩 → `--radius-s`** (상자다)
- **패딩으로 글자를 감싸는 칩 → `--radius-pill`** (글자를 감싼다)

실측이 이 규칙을 지지했다: 22px 무리는 이미 100% `s`, 패딩형 무리는 7 중 5 가 `pill`. 어긋난 건 26px 무리 셋과 스트래글러 둘뿐이었다.

옮긴 것 다섯 — `.gr-chip` pill→s · `.agent-chip` m→s · `.scope-chip` m→s · `.queue-chip` m→pill · `.hg-lead-chip` xs→pill. 결과는 고정 높이 8/8 이 `s`, 패딩형 7/7 이 `pill`.

**예외 하나**를 사유와 함께 남겼다: `.chip.sm`(18px)은 고정 높이인데 알약이다. 18px 에서 `--radius-s`(7px)는 이미 반원(9px)에 가까워, 상자로 두면 "덜 된 알약" 으로 보인다.

## 아이콘 버튼 — 네 단 중 둘은 아무도 안 쓰던 칸

`--iconbtn-size` 는 26·28·30·32 네 단이었다. TSX 를 세어 보니 **`.iconbtn.sm`·`.md`·`.lg` 는 한 번도 안 쓰였다** — 스무 곳이 전부 맨 `iconbtn` 이고, 네 단은 옛 이름 일곱 벌(`.pln-iconbtn`·`.pm-iconbtn`…)을 붙여 두려고 만든 칸이었지 누가 고른 크기가 아니었다.

`--ctl` 램프로 접으면 28→26 · 32→30 이라 네 단이 **그대로** 두 단이 된다. `.md`·`.lg` 는 지웠다 — 남겨 두면 `.sm`·기본과 픽셀이 같은 이름이 둘 더 생겨 다음 사람이 넷 중에서 고르게 된다. 옛 이름 일곱은 그대로 두 단 중 하나에 속한다(TSX 무변경).

`.iconbtn, .code-tool-btn, .sk-iconbtn { --iconbtn-size: var(--ctl-4) }` 줄은 쓰다가 지웠다 — 공용 규칙이 이미 `--ctl-4` 를 주고 있어 중복 선언이었다. 중복 선언이야말로 이 라운드가 지우려는 "여러 손" 신호다.

## 게이트와 계약

- **규칙 20** (`checkChipRadius`) — 칩 클래스의 곡률은 두 값 중 하나여야 한다. 칩 **안의** 물건(`.gr-chip .sw` · `.tbadge .dot` · `.sk-path-chip button`)은 칩이 담은 것이라 자기 곡률을 갖는 게 맞아서, 후손 선택자는 마지막 조각으로 걸러 뺀다.
- **계약 테스트** — 게이트는 "허용된 둘 중 하나인가" 만 본다. 계약은 더 강하게 **어느 쪽인지가 크는 방식과 맞는가**를 본다(게이트만 있으면 고정 높이 칩이 전부 알약이 되어도 통과한다). 아이콘 버튼 계약도 "두 단만, 램프에서" 로 갱신했다.

## 검증

probe 네 형태(한 줄 위반 · 여러 줄 위반 · 리터럴 곡률 · 비위반 넷)로 게이트를 음성 테스트했고, 계약은 `.gr-chip` 을 알약으로 되돌려 실패시켰다.

**되돌리다 다른 규칙을 건드렸다.** probe 복구 스크립트가 문자열 첫 일치를 바꾸는 바람에 `.gn.far`(FAR LOD 라벨 필)의 곡률이 pill→s 로 딸려 갔다. `git diff` 를 봐서 잡았고 둘 다 정확히 되돌렸다 — 스크립트 되돌리기를 믿지 말고 diff 를 볼 것.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 197파일/2578 · build.

**눈으로 볼 것:** 칩 다섯의 곡률과 아이콘 버튼 여덟 자리의 크기(`.pm-iconbtn`·`.gr-iconbtn`·`.home-iconbtn`·`.side-collapse-btn` 28→26, `.sk-iconbtn` 32→30).