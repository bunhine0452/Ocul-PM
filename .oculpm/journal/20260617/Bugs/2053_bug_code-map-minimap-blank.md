---
schema_version: 1
type: bug
slug: code-map-minimap-blank
status: done
difficulty: medium
created_at: "2026-06-17T20:53:12+09:00"
updated_at: "2026-06-17T20:53:12+09:00"
session_id: "20260617-001"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/graph/FileNode.tsx
    op: update
    bytes_added: 1800
    bytes_removed: 1100
  - path: src/features/graph/layout.ts
    op: update
    bytes_added: 520
    bytes_removed: 300
  - path: src/features/graph/GraphScreenV2.tsx
    op: update
    bytes_added: 700
    bytes_removed: 150
related:
  - journal/20260617/Features_to_add/2012_feature_code-map-readability-redesign.md
  - journal/20260617/Bugs/2041_bug_code-map-initial-zoom-and-lag.md
tags: ["graph", "code-map", "minimap", "react-flow", "ui_v2", "dogfooding-finding"]
---

[x] 코드 맵 우측 하단 미니맵이 하얗게만 보이는(렌더 안 됨) 문제 수정

## 발생 원인

React Flow `MiniMap` 은 노드 사각형을 `nodeHasDimensions(node)` 가 참일 때만 그리고, viewBox 경계도 `getInternalNodesBounds` 로 노드 치수에서 계산한다. 치수 우선순위는 `measured?.width ?? node.width ?? node.initialWidth ?? 0`.

우리는 `onlyRenderVisibleElements` 를 켜 둬서 **뷰포트 밖 노드는 DOM 렌더/측정이 안 됨 → `measured` 없음.** 게다가 노드 객체에 명시적 `width`/`height` 를 주지 않아 fallback 도 없음 → 화면 밖 노드 = 치수 0 = 미니맵에서 제외. 진입 줌 하한([[code-map-initial-zoom-and-lag]])으로 화면에 적은 수만 보이게 되자, 미니맵이 경계를 못 잡고 노드 사각형도 거의 못 그려 **사실상 백지**로 보였다.

(부차 원인) 미니맵 `nodeColor` 가 미지원 언어 노드에 대해 `var(--text-3)` 같은 CSS 변수를 반환 — SVG `<rect fill>` 는 CSS 변수를 신뢰성 있게 못 풀어 사각형이 투명해질 수 있음.

## 해결 방법

1. **노드에 명시적 치수** — `displayNodes` 의 각 노드 객체에 `width: size.w, height: size.h` 부여. 이제 측정 여부·`onlyRenderVisibleElements` 와 무관하게 모든 노드가 치수를 가져 미니맵이 **전체 그래프 경계 + 모든 노드 사각형**을 그린다(원래 미니맵이 해야 할 동작).
2. **강제 wrapper 높이에 맞춘 노드 렌더** — React Flow 는 `node.height` 를 wrapper 인라인 스타일로 강제하므로(`getNodeInlineStyleDimensions`), `FileNode` 를 박스 채움(`height:100%`)+`overflow-hidden`+세로 중앙정렬로 바꿔 클리핑/삐져나옴 방지. `sizeForDegree` 높이를 near 카드(제목+서브+카운트)에 맞게 상향, tier≥2 에서만 ←in/out→ 카운트 행 표시.
3. **미니맵 색 구체화** — `nodeColor` 가 `#` 으로 시작하면 그대로, 아니면 회색 `#94a3b8` 로 폴백(SVG 안전).

## 검증

- `pnpm typecheck` exit 0.
- `pnpm test` 114 passed / 3 todo.
- `pnpm build` 성공.
- 실제 앱에서 미니맵이 채워져 보이는지는 사용자 확인 대기 — `verified_by_user: false`.

## 메모

- 명시적 치수는 측정(`measured`)이 있으면 그게 우선이라 온캔버스 렌더는 영향 없음(폴백 전용). 곁다리로 측정 reflow 의존이 줄어 약간의 렌더 비용 절감.
- 근본 진단 경로: `@xyflow/react` MiniMap `NodeComponentWrapperInner`(`nodeHasDimensions` 가드) + `@xyflow/system` `getNodeDimensions`/`getInternalNodesBounds`(`measured ?? width ?? initialWidth`).
