---
schema_version: 1
type: bug
slug: code-map-initial-zoom-and-lag
status: done
difficulty: medium
created_at: "2026-06-17T20:41:31+09:00"
updated_at: "2026-06-17T20:41:31+09:00"
session_id: "20260617-001"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/graph/GraphScreenV2.tsx
    op: update
    bytes_added: 2100
    bytes_removed: 1450
related:
  - journal/20260617/Features_to_add/2012_feature_code-map-readability-redesign.md
tags: ["graph", "code-map", "performance", "ui_v2", "dogfooding-finding"]
---

[x] 코드 맵 진입 시 뷰가 너무 멀고(작아서 안 보임) 렉이 심한 문제 수정

## 발생 원인

도그푸딩 실사용에서 발견. 직전 재설계([[code-map-readability-redesign]]) 후 두 결함.

1. **초기 뷰가 너무 멀다** — React Flow `fitViewOptions` 에 `minZoom` 하한이 없어, 노드가 많은 그래프에서 fitView 가 "전부 맞추기"로 줌을 한없이 작게 잡음. LOD 가 핀으로 줄여줘도 줌 자체가 0.1 수준이면 글자도 같이 10% 라 안 읽힘.
2. **렉(입력 지연)** — 레이아웃을 만드는 `built` 메모의 의존성에 `query`(검색 입력)가 들어가 있어, **검색창에 한 글자 칠 때마다 dagre/force 레이아웃 전체가 재계산**됨. 대규모 프로젝트에서 키 입력마다 수백 노드 레이아웃을 다시 도는 게 주 렉 원인. (force 동기 시뮬레이션은 특히 무거움.)

## 해결 방법

1. **초기 줌 하한** — `fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1.2 }}`. 진입 시 0.5 미만으로 줌아웃하지 않아 라벨이 읽히는 스케일로 시작. 전체 개요가 필요하면 사용자가 직접 0.05 까지 줌아웃(그때 LOD 핀) 가능.
2. **레이아웃과 검색 분리(2단 메모)**
   - `laidOut` (무거움, deps: `graph/mode/layout/enabled/graphShowIsolated`) — 노드·엣지 구성 + degree + 중요도 크기 + **레이아웃 1회**. 검색어와 무관.
   - `built` (가벼움, deps: `laidOut/deferredQuery`) — 이미 배치된 그래프에 경로 필터만 적용(레이아웃 X).
   - 입력은 `useDeferredValue(query)` 로 디퍼 → 타이핑 자체도 끊김 없음.
   - `hubThreshold`·`legend` 는 검색에 흔들리지 않게 `laidOut.nodes`(전체) 기준으로 변경.

부수 효과로 패닝/줌 시에도 `built`/`displayNodes` 참조가 안정적이라(임계 LOD 교차 때만 갱신) 재렌더가 줄어 더 부드러움.

## 검증

- `pnpm typecheck` exit 0.
- `pnpm test` 114 passed / 3 todo (회귀 없음).
- `pnpm build` 성공(GraphScreenV2 청크 정상).
- 런타임 시각 검증(실제 대규모 프로젝트에서 진입 줌·검색 타이핑 체감)은 사용자 확인 대기 — `verified_by_user: false`.

## 메모

- 남은 무거움: `laidOut` 의 최초 레이아웃(특히 force/cluster 동기 시뮬레이션)은 여전히 메인스레드 1회 블록. 1000+ 노드면 레이아웃 워커가 정공법(03-ui-screen-spec §4·§6의 미구현 항목). 이번엔 "상호작용 중 반복 재계산" 제거에 집중.
- LOD 의 `lod` 를 노드 data 에 넣어 임계 교차 때 전 노드 data 가 새로 생성됨 → 그 순간만 전체 재렌더. 평상시 패닝엔 영향 없음. 더 줄이려면 컨테이너 CSS 클래스로 LOD 를 내리는 방식이 후보.
