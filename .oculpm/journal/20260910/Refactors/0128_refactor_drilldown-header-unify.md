---
schema_version: 1
type: refactor
slug: "drilldown-header-unify"
status: done
difficulty: low
created_at: "2026-09-10T01:28:51+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
related: []
tags:
  - "design"
  - "layout"
  - "mcp-tool"
---
[x] 일지 드릴다운은 처음부터 옳았고, 스킬만 자기 머리를 갖고 있었다

## 동기

`{#unify-drilldown}` — 문서형 드릴다운 통일. 항목은 "논의 규격(2-pane)으로 접거나, **최소한** `.sk-head` 를 `<Toolbar>` 로" 라며 두 선택지를 뒀다.

## 큰 쪽을 고르지 않은 이유

2-pane 으로 전면 통일하는 것은 일관성 수정이 아니라 **정보구조 변경**이다 — 일지·스킬 드릴다운에서 목록을 상시 노출하려면 읽기 폭이 절반이 되고, 그건 이 라운드가 아니라 눈으로 보고 정할 일이다. 항목이 준 최소안을 골랐다.

## 정본은 또 이미 있었다

`EntryDetailView`(일지 드릴다운)는 **처음부터 `<Toolbar>`** 를 쓰고 있었다 — `leading` 에 뒤로가기, `title` 에 제목, `sub` 에 배지들. 스킬 드릴다운(`ContextEditor`)만 `.sk-head` 라는 자기 머리를 갖고 있어서 크롬이 52→60px 로 튀었다.

이 라운드에서 **다섯 번째**로 나온 형태다: 규칙이 없어서 흩어진 게 아니라, 규칙이 한 자리에만 적혀 있어서 하나가 어긋난 것.

`.sk-head` 는 `<Toolbar>` 에 거의 1:1 로 대응했다 — 뒤로가기는 `leading`, 이름은 `title`, 경로·칩은 `sub`, `.sk-actions` 는 children. 배지를 `sub` 에 두는 것도 `EntryDetailView` 에서 온 규격이다.

## 화살표도 어휘가 하나였다

뒤로가기 `ArrowLeft` 는 앱에 일곱 자리가 있고 **여섯이 15**(트레이 셋 · 두 마법사 · 스킬), 일지 하나만 18 이었다. 항목은 "일지 18 · 스킬 15" 를 나란히 적어 둘 다 후보인 것처럼 보이게 했는데, 세어 보면 18 이 명백한 외톨이다.

## 변경 요약

- `ContextEditor` 의 `<header className="sk-head">` → `<Toolbar leading title sub>`. 경로는 두 번째 줄에서 `sub` 안의 한 조각이 됐으므로 `margin-top: 3px` 를 뺐다 — 배지들과 기준선이 어긋난다.
- `.sk-head` / `.sk-head-name` CSS 삭제, `.sk-head-meta` 는 `sub` 안의 인라인 묶음으로 남겼다.
- `EntryDetailView` 의 `ArrowLeft size={18}` → `15`.

## 계약

게이트는 안 세웠다 — "드릴다운이 자기 머리를 만들었다" 를 정적으로 알려면 그 헤더가 화면 머리 자리인지를 판단해야 하는데, 그건 못 잡는 쪽이다(§못 잡을 게이트는 세우지 않는다). 대신 계약 둘을 뒀다:

1. `.sk-head {` 규칙이 다시 생기지 않는다 — `<Toolbar>` 자리를 차지하던 그 이름이 정확히 돌아오면 걸린다.
2. 뒤로가기 화살표는 한 크기다 — 앱 전체 `<ArrowLeft size={N}>` 의 집합이 `{15}` 여야 한다.

## 검증

두 번째 계약을 18 로 되돌려 실패시켰고(`뒤로가기 화살표 크기: 18 · 15`), 되돌리니 통과했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 197파일/2580 · build.

**눈으로 볼 것:** 스킬·규칙 드릴다운의 머리 — 이름이 `--fs-6` 굵은 두 줄에서 툴바 제목 한 줄이 되고, 경로·칩이 `sub` 로 내려간다. 크롬이 8px 낮아진다.