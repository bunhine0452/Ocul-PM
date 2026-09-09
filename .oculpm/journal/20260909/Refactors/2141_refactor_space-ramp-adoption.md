---
schema_version: 1
type: refactor
slug: "space-ramp-adoption"
status: done
difficulty: medium
created_at: "2026-09-09T21:41:35+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "design"
  - "tokens"
  - "spacing"
  - "mcp-tool"
---
[x] 여백 토큰 채택률 11% → 램프에 딱 맞는 892곳을 옮긴다

## 동기

`--space-1..8`(4·6·8·10·12·16·20·24px) 램프가 있는데 padding/margin/gap 선언에서 토큰을 쓰는 건 **129건, px 리터럴이 1,007건**이었다. 채택률 11%. `agent.css`·`code.css`·`skills.css` 는 채택 0 이었다.

한 툴바 안에서 항목 간격이 5·6·7·8px 로 섞이면 리듬이 안 잡히고, 눈에는 "정렬이 안 맞는다" 로만 읽힌다.

## 변경 요약

**램프에 정확히 맞는 값만 옮겼다 — 892곳.** 이건 시각 변화가 **0**인 순수 개명이다(`padding: 0 12px` → `padding: 0 var(--space-5)`). 채택 129 → 850.

음수(`margin: -4px`)는 `var()` 로 바꿀 수 없어(calc 이 필요) 건너뛰었고, `calc()` 안쪽은 그대로 치환해도 유효하다.

## 램프 밖은 남겼다 — 이건 눈으로 볼 일이다

480곳이 남았고 최상위가 **5px(108) · 7px(88) · 9px(88)** 이다. 이 셋은 우연이 아니다 — `--space` 의 저단(4·6·8·10)이 2px 격자인데 그 **사이에 낀 값**들이다.

옮기면 1~2px 씩 움직인다. 개별로는 안 보이지만 480곳이면 화면의 밀도가 실제로 바뀐다. **램프에 5·7·9 를 더할지, 6·8·10 으로 수렴시킬지는 실기기에서 보고 정할 일**이라 이번 라운드에서 결정하지 않는다.

1~3px(267곳)은 아예 대상이 아니다. 그건 헤어라인 보정이지 여백 스케일이 아니고, 램프가 4px 에서 시작한다.

## 검증

**게이트 대신 래칫**을 걸었다 — 지금 480곳을 상한으로 두고 "새로 늘지는 않는다" 만 지킨다. 저장소가 이미 쓰는 관용구다(`design_tokens.test.ts` 의 AA 미달 목록 래칫과 같은 손). 줄이면 숫자를 내려 적는다.

바꾼 값이 의미적으로 동일한지 표본 diff 로 확인했고, 음수·`var(--space-N)px` 같은 깨진 값이 없는지 grep 으로 훑었다.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,546개) · `pnpm build` 각 exit 0.