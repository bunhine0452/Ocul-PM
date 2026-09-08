---
schema_version: 1
type: refactor
slug: "design-ramp-round"
status: done
created_at: "2026-09-08T19:08:11+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 디자인 램프 라운드 — 곡률·무게·자간·아이콘·포커스를 한 벌로

## 무엇을 왜

"AI 스럽거나 아마추어 같은 디자인" 전수 조사. de-AI 라운드(2026-09-02)가 관용구(스파클·유리·팔레트색·광택)를 걷어낸 뒤에도 남아 있던 것은 **값의 난립**이었다: 둥글기 17종 · 무게 17종 · 자간 18종 · 아이콘 크기 16종. 나란히 선 물건들이 저마다 1px 씩 다른 곡률과 무게를 갖고 있었다.

## 조사에서 확정된 결함

1. **둥글기 램프 부재** — 이름은 s·m·l·xl 넷인데 리터럴이 17종. 토큰을 쓰는 자리보다 리터럴이 많았다 (.chip 7px 옆의 .tbadge 6px, .kbd 5px, .imd-code 4px — 같은 크기의 라벨 넷이 곡률 넷).
2. **무게 램프 부재** — Pretendard Variable 이 45~930 을 다 그려 주는 탓에 620·640·650·660·680 이 각각 규칙이 됐다. 화면에서 구분되지 않는 값들이고, .chip(600) 옆 .tbadge(650) 처럼 같은 위계의 배지 둘이 다른 무게였다.
3. **자간 잡음** — -0.005em · -0.008em · -0.012em 처럼 눈에 보이지 않는 차이 18종.
4. **아이콘 크기 16종** — 10~30px 사이 아무 값. 인접한 아이콘끼리 광학 정렬이 어긋난다.
5. **포커스 링이 흐렸다** — base.css 는 `2px solid var(--accent)` 인데, 화면별 재정의 8곳이 `--accent-ring`(알파 0.32)을 outline 색으로 썼다. 밝은 표면에서 사실상 안 보이는 링이라 a11y 결함이다. 전역 선택자도 `[role="option"]` 같은 비버튼 상호작용 요소를 하나도 못 잡았다.
6. **스크롤바가 테마를 무시했다** — 손잡이가 `rgba(120,120,128,…)` 고정 회색. 다크·프리셋 5종에서 혼자 중성 회색이었다. `.scrollbar-thin` 은 또 다른 하드코딩 두 벌(light/dark)로 같은 일을 했다.
7. **그림자에 순수 검정** — 토큰은 잉크 계열(24,20,12)인데 11곳이 `rgba(0,0,0,…)`. 토글 노브 둘이 0.3 과 0.25 로 서로 달랐다.
8. **상태 글리프 4중 사본** — `planMeta.ts` 의 STATUS_META 를 Today(`PlanUpdates`)·트레이(`TrayPopover`)·모바일(`PlannerTab`)이 각자 베껴 갖고 있었다. 트레이는 아예 **다른 어휘**(✓ ◐ ○ ! › ×)라, 딥링크로 같은 항목을 열면 상단바에선 ○ 인데 앱에선 ☐ 였다. Today 사본의 blocked 는 U+FE0E 가 빠진 맨 `⚠` 라 OS 컬러 이모지로 그려지고 color 를 무시했다.
9. **남은 맨 글리프** — 대화 목록의 `📋`(라벨 없는 유일한 채색 요소), 활동 링의 `⚠`, 트레이 경고의 `⚠`, 시작 화면 초안 행의 `✎`(바로 아래 형제 행은 lucide 선화), 코드 액션의 `★`.
10. **lint 의 CSS 탈출구가 죽어 있었다** — `check-design-discipline.mjs` 머리 주석이 `design-ignore` 를 CSS 에서도 쓸 수 있다고 문서화했지만, `stripComments` 가 주석을 지운 **뒤** 지운 줄에서 표시를 찾고 있었다. CSS 에서는 한 번도 동작한 적이 없다.

## 한 일

- **tokens.css** — 램프 넷 신설: `--radius-2xs|xs|s|m|l|xl|pill` · `--fw-body|label|strong|bold` · `--track-snug|tight|wide|caps|caps-lg` · 포커스 3종(`--focus-w|color|offset`, `--focus-offset-inset`, `--ring-soft`) · `--shadow-knob`. 값은 **실측 최빈값** 기준으로 접는 방향으로만 골랐다 — 210곳은 그대로고 76곳만 50 단위 이하로 움직인다.
- **접기 663곳** — 둥글기 261 · 무게 322 · 자간 74 · outline 색 8 · 소프트 링 11 · offset 31 · 아이콘 크기 225 · 인라인 타이포 66.
- **의미를 지킨 예외** — `.seg` 는 동심원이라 `calc(var(--radius-s) + 2px)`, 높이 8px 이하 막대·트랙 8곳은 램프가 아니라 알약(`--radius-pill`), 부트스플래시 키프레임과 `.think-dots` 는 자간이 **동작**이라 `design-ignore`.
- **Tailwind 를 램프에 묶었다** — `@theme inline` 에 `--font-weight-*` · `--tracking-*` 추가. 같은 위계의 제목이 유틸리티냐 CSS 냐에 따라 무게가 갈리던 것을 없앴다.
- **글리프 → 아이콘** 5곳, **STATUS_META 단일화** 3곳(사본 전부 제거).
- **lint:design 에 규칙 5개** 추가(둥글기·무게·자간·아이콘 크기·검정 그림자) + CSS `design-ignore` 탈출구 수리.

## 검증

typecheck / test(2487) / lint(6 게이트) / build 전부 exit 0. `today_ring` 테스트가 맨 글리프 텍스트(`⚠2`)를 단언하고 있어, 아이콘+숫자 구조를 보게 고쳤다 — 텍스트로 단언하면 아이콘을 글자로 되돌리는 순간 통과해 버린다.

## 사고 — 병렬 세션이 작업을 한 번 날렸다

라운드 중반에 워킹트리가 통째로 되돌아가 미커밋 변경이 전부 사라졌다. `git reflog` 에 `reset: moving to HEAD` 두 건 — 같은 워킹트리를 쓰는 병렬 세션이 낸 것이다. 전량 재작업했고, 이번엔 완료 즉시 `refs/backup/design-ramp-round` (side ref, 브랜치 아님) 로 스냅샷을 떠 두었다. 공유 인덱스를 건드리지 않으려고 임시 `GIT_INDEX_FILE` + `commit-tree` 를 썼다.

## 남은 것

- 실기기 육안 확인 — 프리셋 5종(Solarized·Sepia·Nord·Dracula·고대비) × 라이트/다크에서 스크롤바·포커스 링·노브 그림자.
- 커밋은 아직. 워킹트리를 병렬 세션과 공유하고 있어 명시 경로 stage 가 필요하다.