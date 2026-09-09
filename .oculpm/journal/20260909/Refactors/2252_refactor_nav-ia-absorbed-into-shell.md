---
schema_version: 1
type: refactor
slug: "nav-ia-absorbed-into-shell"
status: done
difficulty: low
created_at: "2026-09-09T22:52:34+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/nav-ia.css"
    op: delete
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/index.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
related: []
tags:
  - "design"
  - "css"
  - "sidebar"
  - "cascade"
  - "mcp-tool"
---
[x] 파일이 자기 머리에 적어 둔 유효기간이 지나 있었다 — nav-ia.css 흡수

## 동기

`nav-ia.css` 는 머리 주석에 **자기가 왜 임시인지**를 적어 두고 있었다 — "`shell.css` 가 아니라 별도 파일인 이유는 하나뿐이다: 같은 라운드에서 방언 수렴 레인이 `shell.css` 를 통째로 손보고 있어서, 같은 파일을 두 방향에서 고치면 둘 다 잃는다. 규칙 자체는 `shell.css` 의 nav 블록에 속하므로 다음 정리 때 그리로 접어 넣어도 좋다." 그 레인은 2026-09-06 에 끝났다.

**착수 전 실측이 항목 설명의 절반을 무효화했다.** 플랜의 `{#fix-nav-ia}` 는 근거로 셋을 들었다 — `--r-1`/`--r-2`/`--bg` 가 정의되지 않았고, `var(--fs-2, 12px)` 인데 실제 10.5px 이라 fallback 이 거짓말을 한다는 것. 파일을 열어 보니 **셋 다 이미 없었다**: 앞선 커밋 `488b6fc` 가 거짓 fallback 3곳을 `var(--fs-3)` 로 고쳤고, 정의되지 않은 변수들은 `--radius-s`·`--radius-xs`·`--bg-inset`·`--bg-card` 로 바뀌어 있었다(`undefined-var` 게이트가 이미 통과 중이었으니 당연하다). 남은 것은 **흡수 하나**뿐이었다.

## 변경 요약

**옮기기 전에 캐스케이드를 확인했다.** `nav-ia.css` 는 `index.css` 의 **마지막** import(6번째)였고 `shell.css` 는 2번째다 — 규칙을 앞으로 당기는 것이라, 같은 특정도의 경쟁 선언이 뒤 파일(`screens.css`·`agent.css`·`empty.css`)에 하나라도 있으면 승자가 바뀐다. 12개 선택자 전부를 네 레이어에서 grep 했고 **경쟁 선언은 0개**였다. `.subnav-item` 만 `primitives.css` 에 겹치는데, 거기는 `background`/`color`/`font-weight` 를 정하고 여기는 `gap`/`padding` 을 정해 프로퍼티가 안 겹친다.

세 덩이를 nav 블록 안 **의미가 맞는 자리**에 넣었다 — 껍데기(`.nav-group`)는 내용물(`.nav-item`) 바로 앞, 갈래(`.nav-branches` 6줄)는 행 규칙이 다 끝난 `.nav-kbd` 다음, 안내 줄(`.nav-remap` 5줄)은 블록 맨 끝. 값은 **한 자도 안 바꿨다** — `gap: 7px`·`margin … 22px`·`padding: 3px …` 은 여백 램프 밖이지만 `{#ramp-space}` 가 램프 밖 480곳을 래칫으로 동결해 둔 상태라, 이사와 값 변경을 같은 커밋에서 하지 않는다.

곁다리 둘. `index.css` 의 머리 주석은 "Bundles the 5 token/layer files" 라 적어 놓고 여섯을 import 하고 있었다 — 흡수로 숫자가 도로 맞았다. `check-design-discipline.mjs` 의 규칙 10 주석은 실측 증거로 `nav-ia.css` 를 이름으로 들고 있어서, 증거는 남기고 그 파일의 행방만 한 줄 덧붙였다(지우면 "17곳" 의 근거가 사라진다).

## 검증

`pnpm lint` 6게이트 exit 0(경고 9 — 기준선 그대로) · `pnpm test` 195파일 2,551 통과 · `pnpm build` exit 0(창 엔트리 CSS 핵심 선택자 12개 확인 포함) · `pnpm typecheck` exit 0. 코드 검증만으로는 캐스케이드 이동이 시각적으로 무해한지 못 잡으므로, 빌드 산출물에서 옮긴 12개 규칙의 출현 횟수를 직접 셌다 — `.nav-group` 1 · `.nav-branches` 5 · `.nav-remap-acts` 3 · `.nav-remap-title` 1 로 원본과 일치. **실기기 육안 확인은 이 라운드의 다른 14개 커밋과 함께 아직 남아 있다.**