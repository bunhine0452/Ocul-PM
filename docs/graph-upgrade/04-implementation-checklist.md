# 04. 구현 체크리스트 (살아있는 진척표)

> 본 문서는 *도그푸딩 대상* — 작업이 진행되면 그 작업을 한 주체가 상태를 갱신한다.
> 상태 글리프: ☐ 미착수 · ▣ 진행중 · ☑ 완료 · ⚠ 막힘/보류 · → 이월.
> 참조: [`00`](./00-master-plan.md) §0 잠금결정, [`01`](./01-data-model-and-schema.md), [`02`](./02-backend-extraction-spec.md), [`03`](./03-ui-screen-spec.md).
> 게이트 규율: 각 PR 은 typecheck/test/lint/build exit 0 + (백엔드 변경 시) `cargo build`/`cargo test` 확인 후 커밋.

---

## 상태표

| PR | 제목 | 의존 | 상태 | 갱신 |
|---|---|---|---|---|
| GR0 | ui_v2 그래프 화면 신설 (React Flow, file-level) | — | ☑ | 2026-06-15 claude-code |
| GR1 | 멀티관계 스키마 + 빌더 + `get_code_graph` (imports/contains) | GR0 | ☑ | 2026-06-15 claude-code |
| GR2 | tree-sitter 관계 추출 (calls/inherits/implements) | GR1 | ☐ | — |
| GR3 | 그래프 UX (d3-force/Louvain/필터/심볼펼침/순환/LOD) + similar_to | GR1 | ☐ | — |
| GR4 | 의미층(LLM enrichment) + diff 영향분석 + JSON export | GR2,GR3 | ☐ | — |

> GR0 는 단독 출시 가능(가장 큰 즉시 체감). GR3 는 GR2 와 독립적으로 GR1 위에서 진행 가능.

---

## PR-GR0 — 화면 신설 + React Flow 이식  ☑ (2026-06-15)

**목표:** 기존 file-level 그래프를 ui_v2 에 React Flow 로 노출. 백엔드 무변경(`get_dependency_graph` 사용).

- ☑ `UiV2View` 에 `"graph"` 추가 (`WorkspaceContext.tsx`)
- ☑ `Sidebar.tsx` 도구 그룹에 "코드 맵" 항목(`Network` 아이콘, 코드 검색 뒤) + CommandPalette `view-graph` 항목
- ☑ ShellV2 라우팅 `case "graph"` — **React.lazy + Suspense**(React Flow 226kB 를 별도 청크로 분리, ShellV2 청크 비대화 방지)
- ☑ `src/features/graph/GraphScreenV2.tsx` — `commands.getDependencyGraph` → React Flow 노드/엣지
- ☑ `@dagrejs/dagre@3` 추가 → `layout.ts` LR 계층 레이아웃, 줌/팬/미니맵/배경
- ☑ `FileNode.tsx` 커스텀 노드(파일명·dir·언어 배지·←in/out→ 카운트), 클릭 → Inspector(imports/imported-by/symbols, 심볼 lazy fetch)
- ☑ 빈 상태(인덱싱 안 됨/필터 무매치) + 경로 검색 필터 + `graphShowIsolated` 설정 연계 + 선택 시 이웃 강조/딤
- ☑ `sidebar_a11y.test` 10 slots 로 갱신

**DoD:** 사이드바 "코드 맵" 진입 → 파일 그래프 줌/팬/미니맵. typecheck/test(115)/lint/build ✓. 그래프 청크 분리(225kB), ShellV2 청크 776→551kB 복귀.

---

## PR-GR1 — 멀티관계 스키마 + 빌더 (imports/contains)  ☑ (2026-06-15)

**목표:** SQLite 멀티관계 골격. calls 추출 전, 무비용 엣지(contains)부터.

- ☑ `migrations/018_code_graph.sql` — `graph_nodes`/`graph_edges` (번호 보정: 005가 아닌 다음 번호 018. 미래 enrichment 컬럼 summary/layer 포함)
- ☑ `rebuild_code_graph()` — **db.rs 의 Db 메서드**로 구현(별도 graph.rs 대신; 빌더가 순수 SQL-in-tx 라 Db 에 자연스러움). file/symbol 노드 + contains + imports, **LLM-free**, 단일 트랜잭션 전체 재빌드
- ☑ 인덱싱 끝(`project.rs` 의존성 해석 후)에 `rebuild_code_graph` 훅 (best-effort)
- ☑ `commands/graph.rs` — `get_code_graph(project_id, opts{symbol_level})` + DTO(CodeGraph/GraphNodeDto/GraphEdgeDto/GraphOpts). lib.rs + commands/mod.rs 등록, specta 바인딩 재생성
- ☑ `get_dependency_graph` **무변경** 유지 → 출력 완전 동일(하위호환, D-E 보다 강함)
- ☑ GR0 화면을 `getCodeGraph`(symbol_level:false)로 전환 — 기존 file_id 모양으로 투영, 폴더/파일 렌더 무변경
- → **이월(GR2)**: 심볼 노드 렌더링/펼침 UX (전역 symbol 모드는 대형 프로젝트에서 가독성 나쁨 → GR2 에서 포커스 기반 펼침으로 설계). 결정론 Rust 테스트 미추가(cargo check/test 컴파일 통과로 갈음).

**DoD(달성):** `graph_edges` 에 imports+contains 채워짐(인덱싱 시 자동). cargo check ✓ / 바인딩 export ✓ / get_dependency_graph 회귀 무변경 ✓ / JS 게이트 ✓.

---

## PR-GR2 — 관계 추출 (calls/inherits/implements)

**목표:** tree-sitter 로 호출·상속 엣지. 정직한 정밀도(estimated 플래그).

- ☐ `ast::analyze_file` → `relations: Vec<RawRelation>` ([`02`](./02-backend-extraction-spec.md) §2)
- ☐ `queries/<lang>/relations.scm` (TS/JS/Rust/Python/Go) + 언어 레지스트리(`lang.rs`)
- ☐ 소속 심볼 역산(byte range) + 이름해석(동일파일→import→전역동명, estimated 분류)
- ☐ `rebuild_project` 에 calls/inherits/implements 삽입(weight/estimated)
- ☐ 프론트: 엣지 타입 필터(calls/상속 토글), 추정 엣지 점선·배지
- ☐ Inspector 에 Calls / Called by 섹션

**DoD:** TS+Rust 픽스처에서 호출/상속 엣지 생성, 추정/확정 구분. 증분 시 변경파일 src 엣지만 변동. `cargo test`(§02 §5) ✓.

---

## PR-GR3 — 그래프 UX + similar_to

**목표:** 탐색 가능한 시각화. (GR2 와 병행 가능, GR1 의존.)

- ☐ 레이아웃 토글: dagre 계층 ↔ d3-force 유기형 (워커/메모이즈)
- ☐ `graphology-communities-louvain` 클러스터 → 접을 수 있는 묶음(graphGroupThreshold 재해석)
- ☐ 심볼 펼침 LOD(줌 레벨 연동), 포커스 모드(1~2 hop)
- ☐ 순환참조 감지(stats.cycles) + "순환만" 토글 + 빨강 강조
- ☐ 언어/심볼종류 필터, 고립노드(graphShowIsolated 연계)
- ☐ `similar_to` 엣지: sqlite-vec top-k cosine ≥τ (빌더 §01 §3-6), 토글
- ☐ 성능: onlyRenderVisibleElements + 뷰포트 컬링, 1000+ 파일 < 1s 목표

**DoD:** 레이아웃 2종 전환, 클러스터 접기, 순환 강조, similar_to 토글 동작. 대형 픽스처에서 끊김 없음.

---

## PR-GR4 — 의미층 + diff 영향분석 + export

**목표:** 선택적 LLM 가치 + 기존 기능 연계. 로컬 우선 유지(D-F).

- ☐ `enrich_graph_node` — 기존 provider 플러밍(aiContext/OpenRouter/failover) 재사용, 요약/레이어 SQLite 캐시
- ☐ Inspector "AI 설명 생성" 버튼(키 없으면 숨김), 레이어 색 매핑
- ☐ (선택) 가이드 투어 생성 → AI 패널/Planner 연계
- ☐ `get_change_impact(changed_paths)` — 역엣지 BFS, ImpactReport
- ☐ "변경 diff"/Today 에 영향 패널 + 그래프 파급 하이라이트
- ☐ `export_code_graph` → `code-graph.json`(파생물, D-B)

**DoD:** 키 있을 때만 enrichment 동작·캐시, 없으면 구조 그래프 무손상. diff → 영향 노드 BFS 표시. JSON 내보내기 round-trip.

---

## 결정 로그 (Decisions)

| # | 결정 | 사유 | 날짜/주체 |
|---|---|---|---|
| D-A | 2층(구조/의미), LLM-free 빌더 | 재현성·캐시·오프라인. UA 패턴 | 2026-06-15 claude-code |
| D-B | SQLite SSOT, JSON 은 export 파생물 | 이미 인덱스 DB 보유 | 2026-06-15 claude-code |
| D-C | React Flow + dagre + d3-force + louvain | 이미 설치, 거의 드롭인 | 2026-06-15 claude-code |
| D-D | 파일노드 기본 + 심볼 펼침(LOD) | 1000+ 파일 성능 | 2026-06-15 claude-code |
| D-E | `graph_edges` supersede `file_dependencies` | 멀티관계 + 하위호환 투영 | 2026-06-15 claude-code |
| D-F | LLM 없이 구조+similar_to 완전동작 | 로컬 우선 = 우리 차별점 | 2026-06-15 claude-code |
| D-G | legacy 비참조, `features/graph/` 신설 | 회귀 위험 격리 | 2026-06-15 claude-code |

## 신규 의존성

- 프론트: `@dagrejs/dagre`, `graphology`, `graphology-communities-louvain` (+ d3-force 또는 RF 내장). React Flow(`@xyflow/react`) 기존.
- 백엔드: tree-sitter 기존. 마이그레이션 1개 + `graph.rs`/`lang.rs`/`commands/graph.rs` 신규.
