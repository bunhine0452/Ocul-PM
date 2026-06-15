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
| GR2 | tree-sitter 관계 추출 (calls/inherits/implements) | GR1 | ☑ | 2026-06-15 claude-code |
| GR3 | 그래프 UX (force/Louvain) + 심볼단위 호출 | GR1 | ▣ | 2026-06-15 (force/Louvain·심볼단위 호출 ☑; 순환/LOD/similar_to/심볼노드 이월) |
| GR4 | 의미층(LLM enrichment) + diff 영향분석 + JSON export | GR2,GR3 | ▣ | 2026-06-15 claude-code (diff 영향분석 ☑, LLM/export 이월) |

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

## PR-GR2 — 관계 추출 (calls/inherits/implements)  ☑ (2026-06-15)

**목표:** tree-sitter 로 호출·상속 엣지. 정직한 정밀도(estimated 플래그).

- ☑ `ast::analyze_file` → `relations: Vec<RawRelation>` — **별도·실패격리 관계 쿼리**(인라인 const, `.scm` 파일 대신). 잘못된 노드명이 심볼 추출을 안 깸
- ☑ Rust/Python/JS/TS(TSX)/Go 관계 쿼리(calls + inherits/implements). **부수효과: 기존 깨져있던 Go 심볼 쿼리 버그 수정**(`string_literal`→`interpreted_string_literal` — Go AST 분석이 그동안 전부 None 이었음)
- ☑ `ast` cargo 테스트 5종 — 쿼리 컴파일+캡처 검증(노드명 드리프트 조기 발견)
- ☑ `symbol_relations` 테이블(migration 019) + `replace_symbol_relations` 영속화(인덱싱 시, 변경파일 replace)
- ☑ `rebuild_code_graph` 해석 → **파일단위** calls/inherits/implements 엣지. 신뢰(estimated=0)=src 가 import 하는 정의파일 / 추정(estimated=1)=전역 유일 정의 / 모호=skip
- ☑ 프론트: 엣지 타입 필터 칩(import/호출/상속/구현, 색상), 추정=점선, 폴더모드 타입별 집계, Inspector 나가는/들어오는 관계
- → **이월(GR3)**: 심볼단위(symbol→symbol) 정밀 엣지 + 소속 심볼 역산. 본 PR 은 가독성·저위험 위해 **파일단위 해석**으로 단순화(02-spec 의 byte-range 역산 미적용)

**DoD(달성):** Rust/Py/JS/TS/Go 픽스처에서 calls + inherits/implements 추출·추정 구분(cargo test 5/5). 파일단위 엣지가 graph_edges 에 채워지고 프론트에서 타입별 토글/색/점선. cargo check ✓ / JS 게이트 ✓. (바인딩 무변경 — GR1 DTO 가 이미 edge_type/estimated 포함.)

---

## PR-GR3 — 그래프 UX + 심볼단위 호출  ▣ (2026-06-15)

**목표:** 탐색 가능한 시각화 + 심볼단위 호출 가시화.

- ☑ 레이아웃 3분기: 계층(dagre) / 유기형(d3-force) / 묶음(force + Louvain 클러스터 응집) — 가독성 도그푸딩 라운드에서
- ☑ 언어/엣지타입 필터, 고립노드(graphShowIsolated 연계), 언어색 범례
- ☑ **심볼단위 호출 (어느 함수가 어느 함수를)** — `ast` 소속심볼 역산(byte range, `from_symbol`), migration 020(symbol_relations.from_symbol), `get_file_calls(file_id)` 해석(동일파일→import→전역유일 estimated). 코드 맵 Inspector(파일선택)에 **호출 관계** 섹션(caller별 그룹 → callee·대상파일·추정). cargo 테스트 from_symbol 검증
- → **이월**: 심볼 노드 그래프 렌더링/펼침 LOD·포커스, 순환참조 감지, `similar_to`(sqlite-vec) 엣지, onlyRenderVisibleElements 외 추가 성능

**DoD(부분):** 레이아웃 3종 ☑ / 심볼단위 호출 Inspector ☑ (cargo+ast 테스트, JS 게이트 ✓). 심볼 노드 그래프 렌더링·순환·similar_to 미구현.

---

## PR-GR4 — 의미층 + diff 영향분석 + export

**목표:** 선택적 LLM 가치 + 기존 기능 연계. 로컬 우선 유지(D-F).

- ☑ `get_change_impact(project_id, changed_paths)` — **역방향 의존성 BFS**(file_dependencies, target→source). ImpactReport{changed, affected[{file_id,path,depth}]}. 커맨드 등록+바인딩 재생성
- ☑ "변경 diff" 화면에 **영향 받는 파일** 접이식 섹션(depth 배지: 1홉=직접 importer 강조), 클릭→외부 에디터. 변경 파일 전체를 시드로 union BFS
- → **이월**: `enrich_graph_node`(LLM 요약/레이어 캐시) + Inspector "AI 설명 생성" + 가이드 투어 + 그래프 파급 하이라이트 + `export_code_graph` JSON

**DoD(부분 달성):** diff → 영향 파일 역BFS 표시 ☑ (cargo check ✓ / JS 게이트 ✓). LLM enrichment·JSON export 미구현.

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
