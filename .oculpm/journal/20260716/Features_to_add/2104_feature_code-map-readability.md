---
schema_version: 1
type: feature
slug: code-map-readability
status: done
difficulty: medium
created_at: "2026-07-16T21:04:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/graph/graph.css
    op: create
  - path: src/features/graph/FileNode.tsx
    op: update
  - path: src/features/graph/GraphScreenV2.tsx
    op: update
  - path: src/features/graph/types.ts
    op: update
related:
  - journal/20260716/Features_to_add/2043_feature_boot-splash-and-reskin.md
tags: ["graph", "code-map", "readability", "large-repo", "design"]
---

[x] 코드 맵 재작업 — Atelier 토큰 디자인 + 대규모 저장소 가독성 (상위 N·호버·엣지 감쇠·드릴다운)

## 추가 기능

**대규모 가독성** (사용자 불만: "대규모 프로젝트를 불러오면 가독성이 나쁨"):
- **핵심 상위 N 추림(기본)** — 연결 차수 상위 파일 160 / 폴더 240개만 첫 화면에
  그린다. 툴바 칩 "핵심 N / 전체 M" 클릭으로 전체 보기 토글 (전체는 fit 플로어를
  낮춰 조망). 큰 저장소가 "핵심 지도"로 열리는 게 이번 라운드의 본질.
- **호버 하이라이트** — 클릭 없이 노드에 올리면 이웃만 남기고 soft 감쇠 (선택 시엔
  기존 hard 감쇠). 400 노드 초과 표시 중엔 리렌더 비용 때문에 자동 비활성.
- **엣지 잉크 감쇠** — 줌 아웃(LOD far)일수록 엣지 불투명도를 낮춰(0.72→0.3) 라벨이
  주인공이 되게. 1,400개 초과 시 가중치 상위만 상시 표시(선택/호버 인접은 항상).
- **폴더 더블클릭 드릴다운** — 폴더 노드 더블클릭 → 파일 모드 + 그 폴더 경로 필터.
- **검색 Enter 점프** — 경로 필터에서 Enter 시 최적 매치(이름 시작 > 중심성)를
  선택+프레이밍.

**디자인** (사용자 불만: "보여지는 디자인 별로"):
- graph.css 신설 — React Flow 기본 크롬(컨트롤·미니맵·마스크)을 Atelier 토큰으로
  재도장, 캔버스 앰비언트, 노드 카드(.gn: 호버 raise·선택 링·허브 액센트 보더·
  far 필), 툴바 컨트롤(.gr-seg/.gr-chip/.gr-search) 통일. Tailwind 유틸 혼용 제거.
- 폴더 노드에 **언어 구성 미니 바**(상위 3+기타, near LOD) — 폴더 성격이 한눈에.
- dim 2단계(soft/hover, hard/선택)로 감쇠 위계 도입.

**감사 fix** — 백엔드 에러를 "표시할 관계가 없어요" 빈 상태로 삼키던 것을 분리:
loadError 상태 + 에러 전용 문구/재시도 (전 기능 감사 발견 #6).

## 동작 흐름

laidOut 메모(무거운 단계)에서 고립 필터 → **차수 상위 N 캡** → 레이아웃. 검색 필터는
기존처럼 경량 다운스트림. showAll 은 모드 전환/프로젝트 로드 시 리셋되고 ReactFlow
key 에 포함돼 토글 시 재-fit 된다. 호버 세트는 선택 중이거나 HOVER_LIMIT(400) 초과면
null (비용 가드).

## 검증

- typecheck / test(146) / lint / build 전부 exit 0.
- 번들 grep: GraphScreenV2 청크 CSS 에 gr-wrap/gn-mix 생성 확인.
- 실기기 대규모 저장소 체감 확인은 미수행 — 플래너 {#reskin-verify} 에서 함께 확인.

## 메모

- 캡 상수(160/240)·EDGE_CAP(1400)·HOVER_LIMIT(400) 은 경험적 초기값 — 실사용 체감
  후 조정 여지. 인스펙터(GraphInspector)는 이번 범위에서 제외(기능 이상 없음).
