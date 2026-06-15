# 01. 데이터 모델 & 스키마

> 참조: [`00-master-plan.md`](./00-master-plan.md) §2, §3. 잠금: D-B(SQLite SSOT), D-E(graph_edges supersede).
> 기존 스키마: `src-tauri/migrations/005_ast_dependencies.sql` (`symbol_definitions`, `file_dependencies`).

---

## §1. 현재 스키마 (있는 것)

```sql
-- 001_initial.sql
files(id, project_id, path, hash, size, mtime, language, indexed_at)

-- 005_ast_dependencies.sql
symbol_definitions(id, file_id→files, name, kind, start_line, end_line, start_byte, end_byte)
file_dependencies(id, project_id, source_file_id→files, target_file_id→files, UNIQUE(src,tgt))

-- chunks: 임베딩(sqlite-vec). 심볼 정렬 청킹. → similar_to 의 소스
chunks(id, file_id, kind, start_line, end_line, embedding, ...)
```

→ `symbol_definitions` 가 이미 **심볼 노드의 원천**이고, `file_dependencies` 가 `imports` 엣지의 원천, `chunks` 임베딩이 `similar_to` 의 원천이다. **새 추출 없이도 contains·similar_to 를 만들 수 있다.**

---

## §2. 신규 스키마 (마이그레이션 `006_code_graph.sql`)

새 마이그레이션 파일 하나. `graph_nodes` 는 `files`+`symbol_definitions` 의 **통합 뷰가 아니라 물리 테이블**로 둔다(렌더 쿼리 단순화 + 의미층 컬럼 부착 위치). 인덱싱 끝에 빌더가 채운다.

```sql
-- 006_code_graph.sql

-- 통합 노드 테이블. file 노드 + symbol 노드.
CREATE TABLE graph_nodes (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL,
  kind        TEXT NOT NULL,          -- 'file' | 'symbol'
  -- file 노드: file_id 채움, symbol_id NULL. symbol 노드: 둘 다 채움.
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id   INTEGER REFERENCES symbol_definitions(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,          -- 파일명 또는 심볼명
  sub_kind    TEXT,                   -- symbol: 'function'|'class'|'struct'|'trait'|'interface'|'method'|'enum'|'type'
  language    TEXT,
  start_line  INTEGER,
  end_line    INTEGER,
  -- 의미층(선택, PR-GR3 에서 채움; NULL = 미생성). 캐시.
  summary     TEXT,
  layer       TEXT,                   -- 아키텍처 레이어 라벨
  enriched_at INTEGER,
  UNIQUE(project_id, kind, file_id, symbol_id)
);
CREATE INDEX idx_graph_nodes_project ON graph_nodes(project_id);
CREATE INDEX idx_graph_nodes_file    ON graph_nodes(file_id);

-- 타입·가중치 엣지. src/dst 는 graph_nodes.id (파일·심볼 무관 통일).
CREATE TABLE graph_edges (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL,
  edge_type   TEXT NOT NULL,          -- 'imports'|'contains'|'calls'|'inherits'|'implements'|'similar_to'
  source_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  weight      REAL NOT NULL DEFAULT 1.0,
  direction   TEXT NOT NULL DEFAULT 'forward',  -- 'forward'|'backward'|'bidirectional'
  estimated   INTEGER NOT NULL DEFAULT 0,       -- 1 = 이름매칭 추정(calls). UI 배지.
  UNIQUE(project_id, edge_type, source_id, target_id)
);
CREATE INDEX idx_graph_edges_project ON graph_edges(project_id);
CREATE INDEX idx_graph_edges_source  ON graph_edges(source_id);
CREATE INDEX idx_graph_edges_target  ON graph_edges(target_id);  -- 역방향 BFS(diff 영향)용
```

> **백필 (D-E):** 마이그레이션은 기존 `file_dependencies` 를 `graph_nodes`(file)+`graph_edges`(imports)로 옮기지 않고, **빌더가 인덱싱 후 재생성**한다(증분과 일관). 다음 인덱싱 1회로 채워짐. 빈 그래프 시 빌더 강제 1회 트리거.

---

## §3. 그래프 빌더 (Rust, LLM-free — D-A)

`indexer` 가 한 파일 분석을 끝낼 때가 아니라, **인덱싱 트랜잭션 끝(또는 변경분 반영 후)** 에 `graph::rebuild_project(project_id, changed_file_ids)` 를 호출. 순수 SQL 변환:

```rust
// src-tauri/src/graph.rs (신규)
pub fn rebuild_project(db: &Db, project_id: u32, changed: &[u32]) -> Result<()> {
    // 1) file 노드 upsert (files 기준)
    // 2) symbol 노드 upsert (symbol_definitions 기준)
    // 3) contains 엣지: 각 symbol 노드 → 소속 file 노드 (무비용 조인)
    // 4) imports 엣지: file_dependencies → graph_edges (source/target file 노드 id 로 매핑)
    // 5) calls/inherits/implements: ast 추출 결과(§02) → 이름해석 → symbol 노드 엣지
    // 6) similar_to (선택): sqlite-vec top-k, cosine ≥ τ, 동일파일 제외
    // changed 가 비면 전체, 아니면 해당 파일이 src 인 엣지만 delete→재삽입
}
```

빌더는 **트랜잭션 1개**. 빌더 안에서 LLM·임베딩 *생성* 호출 금지(임베딩은 이미 chunks 에 있음, 읽기만).

---

## §4. 커맨드 시그니처 (Tauri)

```rust
// src-tauri/src/commands/graph.rs (신규)

#[derive(Deserialize)] pub struct GraphOpts {
    pub include: Vec<String>,     // edge_type 화이트리스트. 빈 = imports+contains 기본
    pub symbol_level: bool,       // false = file 노드만(기본), true = symbol 펼침
    pub include_isolated: bool,   // 기존 graphShowIsolated 설정 연계
    pub min_similarity: Option<f32>, // similar_to τ
}

#[derive(Serialize)] pub struct CodeGraph {
    pub nodes: Vec<GraphNodeDto>, // id, kind, label, sub_kind, language, file_path, start_line, end_line, summary?, layer?
    pub edges: Vec<GraphEdgeDto>, // id, edge_type, source, target, weight, direction, estimated
    pub stats: GraphStats,        // node/edge 카운트(타입별), 언어 분포, 순환 수
}

// 신규 — 멀티관계
get_code_graph(project_id: u32, opts: GraphOpts) -> CodeGraph

// 유지(하위호환, D-E) — get_dependency_graph 는 내부적으로
//   get_code_graph(.., include=['imports'], symbol_level=false) 의 file-only 투영
get_dependency_graph(project_id: u32) -> DependencyGraph   // 변경 없음

// 선택(PR-GR3/4)
enrich_graph_node(project_id, node_id) -> GraphNodeDto      // LLM 요약/레이어, 캐시
get_change_impact(project_id, changed_paths: Vec<String>) -> ImpactReport  // 역엣지 BFS
export_code_graph(project_id) -> String                     // code-graph.json
```

`bindings.ts` 는 `tauri-specta` 가 자동 생성(기존 패턴). 프론트는 `commands.getCodeGraph(...)`.

---

## §5. 프론트 타입 (요약)

```ts
type EdgeType = "imports" | "contains" | "calls" | "inherits" | "implements" | "similar_to";
interface GraphNodeDto { id: number; kind: "file" | "symbol"; label: string;
  subKind?: string; language?: string; filePath: string; startLine?: number; endLine?: number;
  summary?: string; layer?: string; }
interface GraphEdgeDto { id: number; edgeType: EdgeType; source: number; target: number;
  weight: number; direction: "forward" | "backward" | "bidirectional"; estimated: boolean; }
```

React Flow 노드/엣지로의 매핑·레이아웃은 [`03-ui-screen-spec.md`](./03-ui-screen-spec.md).
