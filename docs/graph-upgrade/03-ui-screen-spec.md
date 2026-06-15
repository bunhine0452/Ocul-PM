# 03. UI 화면 스펙 — GraphScreenV2

> 참조: [`00`](./00-master-plan.md) D-C/D-D/D-G, [`01`](./01-data-model-and-schema.md) §4 커맨드/§5 타입.
> 신규: `src/features/graph/`. 렌더: `@xyflow/react`(이미 설치). legacy(`src/legacy/code/Graph/*`) 비참조.

---

## §1. 노출 (PR-GR0)

1. `WorkspaceContext` `UiV2View` 에 `"graph"` 추가 (현재: today/journal/diff/planner/search/terminal/ai/settings).
2. `Sidebar.tsx` 도구 그룹에 항목 추가: `{ id:"graph", label:"코드 맵", icon: <Network/Workflow 아이콘> }` (검색·터미널과 같은 "도구" 섹션).
3. ShellV2 라우팅에 `case "graph": <GraphScreenV2/>` 추가.

> 라벨은 "의존성 그래프"보다 **"코드 맵"** — 멀티관계로 확장되므로 import 만 연상시키지 않게.

---

## §2. 레이아웃 (화면 구성)

```
┌ Toolbar: "코드 맵"  [레이아웃▾ 계층|유기형]  [엣지: ☑imports ☑contains ☐calls ☐상속]  [심볼펼침⌃] [🔍검색] [재생성] ┐
├───────────────────────────────────────────────────────────────┬───────────────────────────┤
│                                                               │  Inspector (노드 선택 시)   │
│   React Flow 캔버스                                            │   - 파일/심볼 헤더 + 언어   │
│   - 노드: 파일 카드 / 심볼 칩                                   │   - Imported by / Imports   │
│   - 엣지: 타입별 색·점선(추정)                                  │   - Calls / Called by       │
│   - 클러스터(Louvain) 접기 가능한 묶음                          │   - 심볼 목록(펼침)         │
│   - 미니맵 + 줌/팬 컨트롤 + 순환참조 토글                       │   - (선택) AI 요약 생성 버튼 │
└───────────────────────────────────────────────────────────────┴───────────────────────────┘
```

빈 상태: "인덱싱되지 않음 / 그래프 비어있음 → [그래프 재생성]" (인덱싱 트리거).

---

## §3. 렌더 매핑

`get_code_graph` 응답 → React Flow:
- **노드**: `file` = 카드(파일명 + 경로 breadcrumb + 언어 배지 + ←N →N 엣지카운트). `symbol` = 작은 칩(아이콘=sub_kind: ƒ/◇/▢…). 색 = 언어 또는 레이어(의미층 있으면).
- **엣지**: 타입별 색. `estimated` = 점선 + "추정" 툴팁. `direction=backward` 화살표 반전. 가중치 = 굵기.
- 커스텀 노드 컴포넌트(`FileNode.tsx`, `SymbolNode.tsx`), 커스텀 엣지(색/점선).

---

## §4. 레이아웃 엔진 (D-C)

| 모드 | 라이브러리 | 용도 |
|---|---|---|
| **계층(기본)** | `@dagrejs/dagre` | import 위상/레이어. 현재 칸반의 "깊이" 직관 계승 |
| **유기형** | React Flow + `d3-force`(또는 내장) | 클러스터·이웃 탐색 |
| **클러스터** | `graphology` + `graphology-communities-louvain` | 커뮤니티 감지 → 접을 수 있는 묶음(디렉토리 임계값 그룹핑 대체) |

레이아웃 계산은 **워커/메모이즈**(노드 수 많을 때 메인스레드 블록 방지). 토글 시 위치 재계산 + 애니메이션.

---

## §5. 인터랙션

- **줌/팬/미니맵** — React Flow 기본(현재 없음, 즉시 갭 해소).
- **엣지 타입 필터** — 툴바 체크박스. calls/상속 기본 off(가독성), 켜면 추가 fetch(`opts.include`).
- **심볼 펼침(D-D)** — 파일 노드 클릭/줌인 → 그 파일의 symbol 노드 + contains 엣지 표시. 줌아웃/접기 시 다시 파일로(LOD).
- **포커스 모드** — 노드 선택 → 1~2 hop 이웃만 강조/필터.
- **순환참조** — `stats.cycles` + 토글 "순환만". 순환 엣지 빨강 강조.
- **검색** — 경로/심볼명 필터(기존 동작 계승). 매치 노드 포커스.
- **클릭 → Inspector**, 심볼 더블클릭 → 기존 코드 미리보기 모달(`read_file_range`) 재사용.
- **설정 연계** — `graphShowIsolated`(고립노드) → `opts.include_isolated`. `graphGroupThreshold` 는 Louvain 최소묶음크기로 재해석.

---

## §6. 성능 (D-D, 위험완화)

- 파일 노드 기본 → 노드 수 = 파일 수(심볼 펼침 전).
- Louvain 묶음 접기 → 화면 노드 수 추가 절감.
- React Flow `onlyRenderVisibleElements` + 뷰포트 컬링.
- 레이아웃 워커. 1000+ 파일에서 초기 계층 레이아웃 < 1s 목표.

---

## §7. 의미층 표면 (PR-GR3, 선택)

- 노드 Inspector 에 **"AI 설명 생성"** 버튼 → `enrich_graph_node`(LLM 1회, 캐시). 생성되면 노드에 요약 툴팁 + 레이어 색.
- 키 없거나 `includeOculpmContext` off → 버튼 비활성/숨김, 구조 그래프만(D-F).
- **가이드 투어**(선택, 후순위): 위상순 walkthrough → AI 패널/Planner 연계.

---

## §8. diff 영향분석 표면 (PR-GR4)

- "변경 diff" 화면/Today 에 **"영향 받는 파일·심볼"** 패널: `get_change_impact(changed_paths)` 역엣지 BFS 결과.
- 그래프에서 변경 노드 + 영향 서브그래프 하이라이트("이 변경의 파급").
