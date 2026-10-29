---
schema_version: 1
type: refactor
slug: "design-type-grey-green"
status: done
difficulty: medium
created_at: "2026-10-29T23:05:42+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/styles/base.css"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
related: []
tags:
  - "design"
  - "ui-audit"
  - "mcp-tool"
---
[x] 글자 · 회색 · 초록 — 12px 아래는 배지 · 단축키만, 보조 회색 한 단, 초록은 주 버튼과 통과에만

## 동기

화면 검사(ui-audit-20261029)의 5단계 「글자 · 회색 · 초록」이다. 기준은 판단 위임(10-29) 때 「12px 아래 글자 0(배지 · 단축키 제외) + 보조 회색 한 단」으로 바꿨다.

## 변경 요약

- **글자 (#type-floor)**
  - 디자인 게이트에 `type-floor` 규칙을 넣었다. `--fs-0 · 1 · 2` 와 `text-fs-0 · 1 · 2` 는 다음 자리에서만 허용한다.
    - `.chip.sm` (한 줄 규칙의 선택자)
    - `<kbd>`
    - 사유 주석이 붙은 여러 줄 규칙 셋: `.kbd`, 종류 배지 `.tbadge`, 탭 수 배지 `.nav-badge`
  - 나머지 보조 글자 30곳(CSS 23 · TSX 7)을 `--fs-3`(12px)로 올렸다. 팔레트 묶음 머리, 계획 넘김 안내, 터미널 줄, 변경 바닥줄, diff 줄 번호 · 헝크 머리, 단축키 표의 묶음 이름, 토스트 단추, 마크다운 복사 단추, 오류 경계 등이다.
- **회색 (#grey-one)**
  - 바탕 다섯 곳에서 대비를 쟀다.
    - `--text-3`(라이트 #797369 · 다크 #858c87): 라이트 사이드바 4.05 · 안쪽 바탕 4.01, 다크 카드 4.35 · 안쪽 바탕 4.02 로 본문 기준(4.5)을 못 넘었다. 라이트에서는 `--text-2`(#6d675c)와 눈으로 거의 같다.
    - `--text-2`: 어느 바탕에서도 4.79 이상(다크 6.10 이상)이다.
  - `var(--text-3)` 32곳을 `--text-2` 로 바꾸고 토큰을 걷었다. 글자색은 본문 · 보조의 두 단이다.
- **초록 (#green-meaning)**
  - 「열림」 · 「내 차례」 · 「일지에 있음」은 상태 이름이라 중립 딱지(`.chip.outline`)로 했다.
  - 「연결됨」 · 「현재 판」 · 「MCP 등록됨」은 통과 딱지(`.chip.ok`)로 했다.
  - 쓰는 곳이 없어진 `.chip.accent` 를 걷었다.
  - 주 버튼 바탕을 `--accent-strong` 으로 바꿨다. 라이트의 흰 글자 대 `--accent` 는 4.35 였고 strong 은 5.28 이다.
  - 테스트를 세우자 액센트 프리셋 주황(3.7) · 청록(4.16)이 걸렸다. 라이트 `--accent-strong` 을 4.5 를 넘는 가장 가까운 짙기(#b05f0a 4.68 · #0a8186 4.67)로 바꿨다.

## 검증

- 토큰 테스트를 바꿨다.
  - 글자색은 두 단이고 `--text-3` 이 없다.
  - 모든 테마에서 `--text-on-accent` 대 `--accent-strong` 이 4.5 이상이다.
  - `.chip.accent` 가 없다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 79개 · 테스트 937개 통과, lint(「design discipline: clean」) · build exit 0.