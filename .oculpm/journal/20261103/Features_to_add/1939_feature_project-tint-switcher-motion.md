---
schema_version: 1
type: feature
slug: "project-tint-switcher-motion"
status: done
difficulty: medium
created_at: "2026-11-03T19:39:59+09:00"
session_id: "20261103-008"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/theme/projectTint.ts"
    op: create
  - path: "src/styles/motion.css"
    op: create
  - path: "src/styles/index.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/terminal/termTheme.ts"
    op: update
  - path: "src/__tests__/project_color.test.tsx"
    op: update
related:
  - ref: "20261103/Features_to_add/1920_feature_tile-windows-project-accent-vscode.md"
    kind: "followup"
tags:
  - "창"
  - "window"
  - "project-color"
  - "design"
  - "mcp-tool"
---
[x] 창: 프로젝트 색을 바탕까지 입히고 목록을 다듬는다

## 추가 기능
사용자 요청(11-03 저녁): 「테마도 전체에 적용」, 「프로젝트 선택하는 곳 디자인 더 심플하고 고급스럽게」, 「앱 전반에 고급스러운 모션과 심플함」.

- **바탕까지 프로젝트 색** — `features/theme/projectTint.ts`. 바탕 다섯 단(`--bg-window · sidebar · content · card · inset`)에 프로젝트 색을 밝게 4.5% · 어둡게 7% 섞어 `<html>` 인라인 속성으로 얹는다. CSS `color-mix()` 대신 JS 로 hex 를 섞은 이유: 터미널(xterm)은 `--term-bg`(= `--bg-content`)를 계산값 문자열로 읽어 `color-mix(…)` 를 못 읽는다. 터미널은 `data-tint` 변화를 보고 팔레트를 다시 읽는다.
- **프로젝트 목록 다듬기** — 테 없는 찾기 한 줄 · 목록 · 아래 묶음(색 · 동작) 세 칸. 「현재」 칩 → ✓ 하나, 「열림」 칩 → 옅은 글자, ⌥⌘n 은 옅게(줄에 올리면 진하게), 동작에 아이콘(나란히 · VS Code · 폴더).
- **결함 하나 고침** — 윗줄(`.topbar[data-pc]`)의 `--pc` 를 목록의 색 없는 프로젝트 점이 물려받아 남의 색 점이 섰다. 색 없는 점은 빈 고리.
- **모션 한 벌** — `styles/motion.css`. 화면 바꿀 때 4px 떠오름, 프로젝트 목록 · 「⋯」 메뉴 등장, 바탕색이 바뀔 때 320ms 스밈. 전부 keyframe 이 아니라 전환 + `@starting-style`(창이 뒤에 있을 때 애니메이션을 멈추는 `data-app-inactive` 에 첫 프레임으로 걸리지 않게). 모션 최소화 설정이면 0.

## 검증
pnpm test 1042 passed · typecheck/lint/build 0. Vite 컴포넌트 하네스 + 헤드리스 Chrome 으로 밝게(파랑 · 노랑) · 어둡게(보라) 목록을 찍어 확인 — `--term-bg` 가 섞은 hex 로 풀리는 것도 확인. 설치본 눈 확인은 아직.