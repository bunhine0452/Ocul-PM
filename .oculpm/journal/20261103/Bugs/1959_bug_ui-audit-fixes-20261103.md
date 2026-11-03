---
schema_version: 1
type: bug
slug: "ui-audit-fixes-20261103"
status: done
difficulty: medium
created_at: "2026-11-03T19:59:51+09:00"
session_id: "20261103-008"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/__tests__/idle_motion.test.ts"
    op: update
  - path: "src/features/theme/projectTint.ts"
    op: update
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/manual_entry_slug.test.ts"
    op: create
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
related:
  - ref: "20261103/Features_to_add/1939_feature_project-tint-switcher-motion.md"
    kind: "followup"
tags:
  - "화면-검사"
  - "design"
  - "ui-audit"
  - "mcp-tool"
---
[x] 화면 검사: 뒤 창 빈 화면과 일지 대화창을 고친다

## 발생 원인
사용자 요청(11-03 저녁): 「UI 완성도가 수준급인가」 → 「진행해」. 앱 통째 하네스(실제 `main.tsx` + mockIPC, 이 저장소의 실제 일지 59건 · 계획 4개)로 다섯 화면 × 밝게 · 어둡게 · 좁은 창(560) · 빈 프로젝트 · 색 없는 프로젝트 · 시작 창 · ⌘K · 새 일지 대화창 · 프로젝트 목록을 찍어 봤다. 나온 것:

1. **뒤에 있는 창의 새 화면이 투명하게 멈춘다 (높음).** `data-app-inactive` 가 창이 뒤에 있으면 *모든* 애니메이션을 멈추는데, `.fade-in` · `animate-in`(대화창 · 토스트) · 업데이트 배너는 opacity 0 에서 시작한다. 그래서 포커스 없는 창에서 변경 화면의 빈 상태가 빈 화면으로 보였다. 오늘 넣은 「창 나란히」로 창 여럿을 보며 하나만 포커스하는 쓰임에서 바로 걸린다.
2. **프로젝트 색이 카드까지 물들여 카드 테가 사라진다 (높음).** 바탕 다섯 단을 다 섞었더니 카드와 바탕이 같은 색조로 붙고, 따뜻한 회색 입력칸에 푸른 기가 섞여 탁해졌다. 색 없는 창과 나란히 찍으니 확연했다.
3. **「새 일지」 대화창 (중간).** 머리 아이콘이 제목 위에 따로 서고, `bug · feature`, `medium · planned`, `session_id`, `slug * kebab-case · ASCII`, `workday 20261103` 같은 내부 값이 날것으로 보였다. 입력칸은 베이지 면 다섯 개. 상태 기본값이 「planned」(직접 쓰는 일지는 대개 끝낸 일).
4. **시작 창에만 프로젝트 색 점이 없다 (낮음).**

## 해결 방법
1. 멈춤 규칙에서 한 번 끝나는 등장 애니메이션을 뺐다(`:not(.fade-in, [class*="animate-in"], .update-banner)`). 회귀 테스트 `idle_motion.test.ts`.
2. `projectTint.ts` — 창 · 목록 칸 · 본문 셋만 물들이고 카드 · 입력칸은 그대로. 예전에 얹힌 값도 걷는다.
3. 대화창: 제목 「일지 직접 쓰기」 · 설명 한 줄, 종류는 「버그 수정 · 기능 추가 …」, 난이도 · 상태 한국어, 상태 기본 「끝남」, slug → 「파일 이름」 이고 제목에서 자동으로 짓는다(`slugFromTitle`, 한글뿐이면 `note`), 사람이 읽는 칸(제목 · 태그)은 본문 서체, 입력칸 바탕은 `--bg-window`.
4. 시작 창 줄에 색 점(색 없으면 빈 고리).

그대로 둔 것: 「먼저 볼 것」의 고정폭 판정 줄(`VerdictLine`, 일부러 넣은 영수증 표식). 일지 목록의 「검증 없음」 칩 — 하네스에선 거의 모든 줄에 섰는데, 오늘 일지들이 검증을 명령 블록이 아니라 산문으로 적어서다. 기록 쪽 문제다.

## 검증
pnpm test 1046 passed · typecheck/lint/build 0. 하네스로 고친 화면(계획 · 빈 변경 · 대화창 밝게/어둡게 · 시작 창)을 다시 찍어 확인.