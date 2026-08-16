---
schema_version: 1
type: feature
slug: "code-map-floating-edge-redesign"
status: done
difficulty: medium
created_at: "2026-08-16T15:20:03+09:00"
session_id: "mcp-20260816-152003"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/graph/FloatingEdge.tsx"
    op: create
  - path: "src/features/graph/floatingEdgeMath.ts"
    op: create
  - path: "src/features/graph/FileNode.tsx"
    op: update
  - path: "src/features/graph/GraphScreenV2.tsx"
    op: update
  - path: "src/features/graph/graph.css"
    op: update
  - path: "src/features/graph/layout.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/graph_floating_edge.test.ts"
    op: create
related: []
tags:
  - "graph"
  - "code-map"
  - "redesign"
  - "react-flow"
  - "ux"
  - "mcp-tool"
---
[x] 코드 맵 리디자인 — 플로팅 엣지·방향 화살표·언어 틴트 카드 + 버그 2건/최적화 3건

## 추가 기능

사용자 도그푸딩 피드백: 코드 맵이 엣지 스파게티(스크린샷 첨부됨)로 읽히지 않음 — "UI·그래프·최적화 버그·디자인을 완전히 새롭게".

- **플로팅 엣지**: 기존 엣지는 모든 노드의 좌(입)/우(출) **고정 핸들**에 붙어, 대상이 소스보다 왼쪽에 있으면 화면을 크게 돌아 나가는 곡선이 됐다 — 스크린샷 헤어볼의 주범. 두 노드 사각형 경계의 교차점을 그때그때 계산해 최단 방향으로 잇는 커스텀 엣지로 교체. 기하는 `floatingEdgeMath.ts` 순수 함수(React Flow 공식 레시피의 다이아몬드 근사를 프레임워크 타입 없이 이식, NaN 가드 포함)로 분리해 단위 테스트 8건.
- **방향 화살표**: 지금까지 의존 **방향이 아예 안 보였다**. 타입 색 ArrowClosed 마커 + 범례에 "화살표 = 사용 방향 (A → B: A 가 B 를 사용)" 힌트.
- **노드 카드 리디자인**: 좌측 3px 스트라이프 → 언어 색(`--gn-tint`)이 배경 그라데이션 워시·틴트 테두리·글리프(폴더=둥근 사각, 파일=원)로 스며드는 카드. tier 타이포를 인라인 px 에서 `.t0~.t4` CSS 클래스로. 허브는 near LOD 에서 틴트 "허브" 태그로 승격(색 링만으론 안 읽혔음). 도트 배경, 범례 2단(언어/읽는 법) 등 캔버스 폴리시.

## 동작 흐름

`GraphScreenV2` 가 엣지에 `type: "floating"` + 마커를 달고 `edgeTypes` 로 `FloatingEdge` 를 연결 → 렌더 시 `useInternalNode` 로 두 노드의 실측 rect 를 읽어 `floatingEdgeGeom` 이 시작/끝 좌표·변(side)을 계산 → `getBezierPath` 로 그린다. 노드 위치가 바뀌면(레이아웃 전환·드래그) 자동 추종.

## 함께 잡은 버그

1. **검색 Enter → 빈 화면**: 후보를 상위 N 컷 이후 목록에서 찾아, 컷된 노드가 최선 매치면 존재하지 않는 id 가 선택돼 포커스 컬링이 전부를 숨겼다. 캡 전 전체(`laidOut.all`)에서 찾고, 컷된 노드면 `showAll` 로 승격 후 선택.
2. **포커스/인스펙터 이웃이 검색 필터에 오염**: 이웃 집합을 검색-필터된 엣지에서 계산해 "혼자 뜬 노드"가 됐다. 인접 사전을 구조적(laidOut) 엣지로 1회 구축해 포커스·호버·인스펙터가 공유.

## 최적화

- 파일 모드 중복 엣지를 (타입,소스,타깃) 키로 weight 합산 dedupe — 겹쳐 그리던 DOM 패스 제거.
- 엣지 id 를 인덱스 기반 → 안정 id(`타입|소스|타깃`)로: 필터 토글 때 인덱스가 밀리며 전체 엣지 DOM 이 재생성되던 것 제거.
- 호버/선택 이웃 계산이 전 엣지 순회 → 인접 사전 O(1) 조회.
- 포커스 모드에선 엣지 애니메이션을 끄고 타입 색 유지(액센트 통일 대신 관계 종류가 읽히게).
- dagre 간격 튜닝: ranksep 96→128, nodesep 30→26, edgesep 16 (화살표 여백).

## 검증

- `pnpm typecheck` / `pnpm test`(940개 — 신규 floatingEdgeMath 기하 8건: 수평/수직/역방향/대각 교차점·변 분류·겹침 NaN 가드) / `pnpm lint` / `pnpm build` 모두 exit 0 직접 확인. Rust 변경 없음(bindings 불변).