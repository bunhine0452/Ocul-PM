---
schema_version: 1
type: feature
slug: "i18n-graph-screen"
status: done
difficulty: medium
created_at: "2026-08-12T04:49:17+09:00"
session_id: "mcp-20260812-044917"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/graph/GraphScreenV2.tsx"
    op: update
  - path: "src/features/graph/GraphInspector.tsx"
    op: update
  - path: "src/features/graph/FileNode.tsx"
    op: update
  - path: "src/features/graph/types.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "그래프"
  - "mcp-tool"
---
[x] 코드 맵 화면 영어화 (70건) — t 섀도잉이 두 번 더

## 추가 기능

GraphScreenV2(28) · GraphInspector(37) · FileNode(2) · types(3) 영어화. 사전 키 75개. allowlist 79 → 75.

레이아웃 3종·엣지 유형 토글·노드 역할 판정(허브/핵심/진입점/기반/고립)·변경 영향·심볼 목록·코드 미리보기까지.

## `t` 섀도잉이 두 번 더 — 같은 관용구

`presentTypes.map((t) => …)` (GraphScreenV2) · `r.types.map((t) => …)` (GraphInspector).
둘 다 **엣지 타입**을 `t` 로 받고 있었다 — 누적 열 번째·열한 번째다.

이번엔 정규식 일괄 치환이 그 안에서 오작동해 `t(t(EDGE_META[t].labelKey)Key)` 같은 깨진 코드를 만들었고, typecheck 가 즉시 잡았다. 콜백 인자를 `et`(edge type) 로 개명하고 근거 주석을 달았다.

기계적 치환은 **섀도잉된 스코프 안에서 특히 위험하다** — 같은 이름이 두 가지를 가리키니 정규식이 구분할 수 없다. 남은 파일에서도 `.map((t) =>` 를 먼저 개명한 뒤 치환하는 순서로 가야 한다.

## 자동 삽입에 PascalCase 판별 적용

직전 회차에서 순수 함수에 훅을 심던 문제를 겪었으므로, 이번 변환부터 `^function [A-Z]` 만 대상으로 삼았다. `roleFor()` 같은 헬퍼에는 훅이 들어가지 않았다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 진척

12개 ui_v2 화면 중 **11.5개** — 남은 건 터미널(29) · AI 패널(92) 둘뿐이다.

allowlist 75. AiPanelScreenV2 50 · TrayPopover 70 · GreenfieldWizard 56 · ProjectManager 39 · aiActions 28 · TerminalScreenV2 29 등 + 테스트 20여 개 + Rust 에러 ~130곳.