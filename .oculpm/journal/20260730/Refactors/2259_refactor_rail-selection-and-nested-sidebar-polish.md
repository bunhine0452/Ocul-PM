---
schema_version: 1
type: refactor
slug: "rail-selection-and-nested-sidebar-polish"
status: done
difficulty: medium
created_at: "2026-07-30T22:59:20+09:00"
session_id: "mcp-20260730-225920"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/features/docs/docs.css"
    op: update
related: []
tags:
  - "ui_v2"
  - "design"
  - "planner"
  - "settings"
  - "dogfooding-finding"
  - "mcp-tool"
---
[x] 2차 사이드바 인상 제거 + 선택 표시를 면으로 + 이모지 제거

## 동기

계획 레일을 넣고 나서 받은 사용자 지적 3건. 전부 타당했고, 셋 다 레일 하나가
아니라 **앱 전반의 규격 문제** 였다.

## 변경 요약

### 1. 선택 표시 — 왼쪽 세로 막대 → 면(面)

`.pln-row.on` 의 `border-left: 2px solid var(--accent)` 제거. 얇은 색 막대는 행마다
시선을 끌어 목록의 리듬을 끊고, 무엇보다 **같은 앱의 다른 2-pane 목록과 어긋났다** —
`.disc-item.on` 과 `.docs-tree-file.on` 은 둘 다 채움(`--accent-soft`)만 쓴다. 내가
넣은 막대가 유일한 예외였다. 부드러운 채움 + 제목 색·무게 승격으로 통일.

진행 바도 3px 액센트 그라디언트에서 **2px 중성색 헤어라인** 으로 낮췄다. 계획이
열 몇 개씩 쌓이면 초록 막대가 밭을 이뤄 정작 선택된 행이 안 보였다. 선택된 행에서만
액센트로 채운다.

### 2. 이모지 제거

- `Lock` SVG 아이콘 신설 → 레일 행 / 계획 헤더 잠금 pill / 결정 블록의 🔒 3곳 교체.
  이모지는 OS 컬러 폰트로 그려져 크기·색·광학 무게가 주변 선 아이콘과 따로 놀고
  `color` 를 무시한다(테마도 안 따른다).
- 레일 '멈춤' 배지의 ⚠ → `TriangleAlert` SVG.
- 남은 ⚠ 2곳(플래너 `blocked` 글리프, Discussion 파싱 경고)은 문자열 글리프 집합
  (`☐ ▣ ☑ → ✗`)의 일부라 SVG 로 바꾸면 타입이 바뀐다. **U+FE0E**(text presentation
  selector)를 붙여 텍스트 표현으로 고정 — 한 글자 변경으로 색·무게가 주변과 맞는다.

### 3. '사이드바 속 사이드바'

두 갈래 문제였다.

**(a) 2-pane 목록이 캔버스 색을 쓰고 있었다.** `.pln-rail`·`.disc-list`·`.sk-list`·
docs 좌측 열이 전부 `--bg-sidebar` — 앱 사이드바와 **같은 색** 이라, 시트 안에 있는데도
사이드바 옆에 기둥이 하나 더 선 것처럼 읽혔다(사이드바 248px + 레일 240px ≈ 500px
슬래브). 넷 다 `transparent` 로 바꿔 콘텐츠 시트와 표면을 공유하고 구분선만 남겼다.
이제 시트 하나에 목차가 붙은 모양이 된다.

**(b) 설정이 프로젝트 안에서 세로 탭 열을 하나 더 세웠다.** `w-48`(192px) 세로 nav —
앱 사이드바가 이미 있는 자리에서 두 번째 열. `embedded` 일 때만 **가로 스트립** 으로
눕혔다. 좁은 창에서는 압착 대신 가로 스크롤(툴바 액션과 같은 방어책 — 없으면 flex
압착이 CJK 라벨을 한 글자씩 세로로 꺾는다). 프로젝트 선택 화면(비-embedded)은
사이드바가 없는 모달이라 세로 목록이 여전히 맞아 그대로 뒀다.

## 검증

- `pnpm test` 305 통과(36파일) — 레일 6개·a11y·설정 3개 스위트 포함. axe 무위반
  유지(아이콘에 `aria-label`, 탭에 `aria-current`).
- `pnpm typecheck` / `pnpm lint` / `pnpm build` exit 0.
- `IconWrapper` 가 `className` 을 실제로 전달하는지 확인함(`lucide-icon ${className}`)
  — 아니었다면 `.pln-row-lock` 스타일이 조용히 안 먹었을 것.

## 메모

시각 확인은 아직 사용자 몫이다. 특히 (a) 는 라이트/다크 + 프리셋 테마 5종에서
`--sep` 구분선만으로 레일과 본문이 충분히 갈리는지 눈으로 봐야 한다.