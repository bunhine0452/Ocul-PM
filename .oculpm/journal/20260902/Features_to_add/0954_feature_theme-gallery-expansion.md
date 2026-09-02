---
schema_version: 1
type: feature
slug: theme-gallery-expansion
status: done
created_at: 2026-09-02T09:54:00+09:00
session_id: "manual-20260902-095400"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: landing/themes/tokyo-night.json
    op: create
  - path: landing/themes/gruvbox-dark.json
    op: create
  - path: landing/themes/catppuccin-mocha.json
    op: create
  - path: landing/themes/rose-pine.json
    op: create
  - path: landing/themes/everforest-dark.json
    op: create
  - path: landing/themes/kanagawa.json
    op: create
  - path: landing/themes/graphite.json
    op: create
  - path: landing/themes/catppuccin-latte.json
    op: create
  - path: landing/themes/gruvbox-light.json
    op: create
  - path: landing/themes/rose-pine-dawn.json
    op: create
  - path: landing/themes/everforest-light.json
    op: create
  - path: landing/themes/kanagawa-lotus.json
    op: create
  - path: landing/themes/ember.json
    op: update
  - path: landing/themes/ink.json
    op: update
  - path: landing/wiki-src/pages.mjs
    op: update
  - path: landing/page.css
    op: update
  - path: landing/themes.html
    op: update
related:
  - .oculpm/journal/20260902/Features_to_add/0550_feature_landing-phase8.md
tags:
  - landing
  - theme
  - design
difficulty: low
---

[x] 테마 갤러리 확장 — 배포 테마 2 → 14, 카드를 색 견본에서 앱 축소판으로

## 추가 기능

- **배포 테마 12종 추가** — Tokyo Night · Gruvbox Dark/Light · Catppuccin Mocha/Latte · Rosé Pine/Dawn · Everforest Dark/Light · Kanagawa/Lotus · Graphite. 다크 6 · 라이트 6 이라 `/themes` 는 이제 다크 8 · 라이트 6.
- **31색 지정으로 통일** — 기존 Ink·Ember 는 표면·글자·강조·선 19색만 적어 상태색(`--ok`/`--warn`/`--danger`/`--info` × base·text·soft)이 기본 팔레트(초록/주황/빨강)로 남았다. 팔레트에 맞는 상태색을 12개씩 채워 14종 전부 31색이 됐다 — 그래야 diff 줄과 토스트까지 그 테마의 색이 된다.
- **카드 = 앱 축소판** — 창틀(신호등 3점 = danger/warn/ok)·사이드바(활성 항목 = accent)·일지 카드(`--bg-card` + `--border-card`)·diff 두 줄(`--ok`/`--danger` 20% 바탕 + 좌측 바)·강조 버튼(`--accent` 위 `--text-on-accent`)까지, 실제 화면이 그 색을 쓰는 자리에 그대로 얹는다. 색은 인라인 `--th-*` 변수 한 줄로만 들어가고 구조는 CSS 가 소유한다.
- **본문 대비를 카드에 노출** — `--text`/`--bg-content` 의 WCAG 대비율(`본문 대비 11.3:1`)을 저자·색 개수 옆에 적는다. 게이트(4.5:1)는 테스트가 이미 막지만, 숫자를 보여 주면 고르는 쪽이 판단할 수 있다.
- **라이트/다크 필터** — 14장이 되면 갤러리는 목록이 아니라 고르는 자리다. 섹션별로 독립된 필터 바(전체/다크/라이트 + 개수)를 붙였고, `shell()` 에 페이지 전용 `script` 슬롯을 새로 뚫어 그 JS 를 실었다.

## 동작 흐름

1. `landing/themes/*.json` 이 정본. `node landing/wiki-src/build.mjs` 가 내장 5종(`src/features/theme/builtin/`)과 함께 읽어 `themes.html` 을 굽는다 — 부분 지정 테마의 나머지 색은 `tokens.css` 의 가족 기본값을 물려받고, 카드도 **그 물려받은 값으로** 그린다.
2. 「앱에서 가져오기」는 `oculpm://theme/install?url=https://oculpm.com/themes/<file>.json` → 앱이 확인 창을 띄우고 승인해야 받는다. 앱이 없으면 `.json` 을 내려받아 설정 → 모양 → 가져오기.
3. 팔레트는 일회성 생성기(스크래치패드)로 만들었다 — 배경/글자/강조/상태색만 적으면 `-strong`(어둡게 12~14%) · `-text`(다크는 밝게 20%, 라이트는 어둡게 8%) · `-soft`/`-ring`(같은 색 알파) · 상태 `-text`(다크 +22% 밝게 / 라이트 −24% 어둡게)를 규칙으로 파생한다. 손으로 31색을 적으면 테마마다 규칙이 달라진다.

## 검증

- `pnpm vitest run src/__tests__/landing_themes.test.ts` — 43 passed (14종 × 스키마·색 값·본문 대비 4.5:1·갤러리 등재·딥링크 인코딩).
- `pnpm typecheck` · `pnpm test`(146 files / 1844) · `pnpm lint` · `pnpm build` 전부 exit 0.
- 로컬 정적 서버로 `/themes` 를 열어 14장 렌더·필터(라이트 6장만 남는지)·내장 5장 섹션을 눈으로 확인.

## 메모

- 라이트 테마의 강조색은 **파스텔이 못 들어간다** — `--text-on-accent` 와 4.5:1 이 안 나온다. Gruvbox Light 는 canonical yellow(#b57614, 3.3:1) 대신 faded orange(#af3a03), Rosé Pine Dawn 은 rose(#d7827e, 2.6:1) 대신 pine(#286983)을 강조로 썼다. 라이트 팔레트를 더 실을 때 같은 벽을 만난다.
- 대비 규칙은 생성기가 아니라 저장소 테스트가 소유한다 — PR 로 들어오는 테마는 생성기를 안 거치기 때문이다.
