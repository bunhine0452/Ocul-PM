---
schema_version: 1
type: refactor
slug: "leading-and-dim-ramps"
status: done
difficulty: low
created_at: "2026-09-09T21:10:47+09:00"
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
  - "typography"
  - "mcp-tool"
---
[x] 줄간격 12종과 비활성 흐림 6단을 램프로 접는다

## 동기

글자 **크기**는 13단 램프에 접혀 있다 — 선언 648개 중 640개가 토큰이다. 그런데 **줄간격**만 자유라 12종이었다. 두 줄 이상 흐르는 한국어 블록마다 조판 밀도가 달라 보이는 이유다.

비활성 흐림은 여섯 단(0.32 · 0.35 · 0.4 · 0.45 · 0.5 · 0.55)이었고, 같은 툴바에서 `.btn:disabled`(0.5)와 `.iconbtn:disabled`(0.32)가 눈에 띄게 달랐다 — "이건 못 쓰는 것" 이라는 한 가지 뜻이 두 가지 세기로 표현됐다.

## 변경 요약

**`--lh-tight|snug|body|prose` 4단** — 1.35 / 1.45 / 1.55 / 1.7. 75곳을 접었다(body 51 · prose 9 · snug 8 · tight 7).

한국어는 라틴보다 글자가 크고 빽빽해서 **제목도 1.3 아래로 내리지 않는다**. 그래서 `--lh-tight` 를 1.35 로 잡았다 — 기존 1.25·1.3 을 조이는 대신 살짝 푸는 방향이다.

**`line-height: 1` 과 px 값(7곳)은 건드리지 않았다.** 그건 조판이 아니라 고정 높이 배지 안에서 글자를 수직 중앙에 두는 **도형**이다 — 비율로 바꾸면 중앙 정렬이 깨진다. 게이트도 소수만 본다.

**`--dim-disabled: 0.45`** — 24곳. 알파는 테마와 무관하므로 다크·프리셋에서 다시 정의하지 않는다.

`.iconbtn:disabled` 의 `color: var(--text-3)` 는 **그대로 뒀다**. 0.32 라는 낮은 값을 고른 이유가 그 색 때문일 수 있는데, 흐림과 색을 동시에 바꾸면 결과를 눈으로 확인하지 않고 두 변수를 움직이는 게 된다. 측정된 불일치(0.32 대 0.5)만 없앴다.

## 남긴 것

`screens.css` 의 `.entry-narrative h1~h6` 은 크기와 무관하게 전부 `--lh-tight` 다. 감사는 "h1(fs-9)과 h6(fs-6)이 같은 배수라 작은 제목이 상대적으로 벌어진다" 고 지적했는데, 크기별로 가르는 건 조판 설계 결정이라 이번 라운드에서는 값만 램프에 얹고 관계는 그대로 뒀다.

## 검증

게이트 둘 추가 — `leading-literal`(`check-design-discipline.mjs` 규칙 14, 소수만; `1`·px 은 통과) · `:disabled` 규칙의 opacity 리터럴 금지(`design_tokens.test.ts`).

**음성 테스트**: probe CSS 로 `line-height: 1.62` 는 잡히고 `1`·`17px` 은 통과하는 것을 확인한 뒤 제거.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,545개) · `pnpm build` 각 exit 0.