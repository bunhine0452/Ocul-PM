# 02. 백엔드 추출 스펙 (tree-sitter 확장)

> 참조: [`00`](./00-master-plan.md) §2 불변식, [`01`](./01-data-model-and-schema.md) §3 빌더.
> 기존 코드: `src-tauri/src/ast.rs`(심볼·import 추출), `src-tauri/src/indexer.rs`(`resolve_import` ~331-512), `Cargo.toml`(tree-sitter 0.23 + rust/js/ts/python/go 바인딩).

---

## §1. 현재 추출 (있는 것)

`ast::analyze_file()` 가 파일당 반환: `Vec<Symbol>`(name/kind/line·byte range) + `Vec<Import>`(원시 import 문자열). tree-sitter 풀 AST = Rust/Python/JS(JSX)/TS(TSX)/Go. 나머지(Java/Kotlin/C/C++/C#/Ruby/PHP/Swift)는 라인 기반 regex.

`indexer::resolve_import()` 는 import 문자열 → 프로젝트 내 대상 파일 경로로 해석(tsconfig alias, 상대경로, Rust `crate::`, suffix 매칭, barrel 파일). 결과가 `file_dependencies`.

→ **imports/contains 는 추가 파싱 0.** 본 문서는 **calls/inherits/implements** 추출만 다룬다(PR-GR2).

---

## §2. 신규 추출: 관계 (relations)

`analyze_file` 의 반환을 확장:

```rust
pub struct Analysis {
    pub symbols: Vec<Symbol>,       // 기존
    pub imports: Vec<Import>,       // 기존
    pub relations: Vec<RawRelation>,// 신규
}
pub struct RawRelation {
    pub kind: RelationKind,         // Call | Inherits | Implements
    pub from_byte: usize,           // 출현 위치(소속 심볼 역산용)
    pub name: String,               // 호출/부모 식별자(미해석 텍스트)
    pub qualifier: Option<String>,  // 'foo.bar()' 의 'foo', 'a::b' 의 'a'
}
```

### 2.1 소속 심볼 역산
`from_byte` 를 `symbols` 의 byte range 와 대조해 **어느 심볼 안에서 일어났는지** 찾는다(가장 안쪽 포함 심볼). 톱레벨이면 file 노드를 src 로.

### 2.2 tree-sitter 쿼리 (`.scm`, 언어별)
풀-AST 5개 언어부터. `ast.rs` 인라인 쿼리를 `src-tauri/queries/<lang>/relations.scm` 로 분리(언어 레지스트리, §3).

| 관계 | 노드(예: TS/JS) | 노드(Rust) | 노드(Python) |
|---|---|---|---|
| `calls` | `call_expression` → `function`/`member_expression` | `call_expression` | `call` → `attribute`/`identifier` |
| `inherits` | `class_heritage` `extends` | — (trait bound) | `class_definition` `superclasses` |
| `implements` | `implements_clause` | `impl_item` `trait`+`type` | (덕타이핑 — 생략) |

regex 언어(Java/Kotlin/…)는 PR-GR2 범위에서 **선택**: `extends`/`implements`/`: Base` 줄 패턴으로 inherits/implements 만(저비용), calls 는 보류(regex 호출 추출은 오탐 큼 → 비목표).

### 2.3 이름 해석 (resolution) — 정직한 정밀도 (불변식 §3.5)
호출/부모 `name` → 대상 심볼 노드:
1. **동일 파일 우선** — 같은 파일의 동명 심볼.
2. **import 따라가기** — `qualifier`/import 로 들어온 심볼이면 그 파일의 동명 심볼.
3. **프로젝트 전역 동명** — 후보 1개면 연결(weight 0.8), 다수면 *모두 추정 엣지*(`estimated=1`, weight 0.5) 또는 상위 N 컷.
4. **미해석** — 외부/내장 추정 → **엣지 생성 안 함**(외부 노드 비목표).

> UA 도 `addCallEdge` 가 이름매칭 0.8 고정이다. 우리는 거기에 `estimated` 플래그를 더해 UI 가 추정/확정을 구분한다.

---

## §3. 언어 레지스트리 (UA `LanguageRegistry` 패턴)

`ast.rs` 의 언어별 분기를 표 기반 레지스트리로:

```rust
// src-tauri/src/lang.rs (신규 또는 ast.rs 내)
pub struct LangConfig {
    pub id: &'static str,             // 'typescript'
    pub extensions: &'static [&'static str],
    pub ts_language: Option<fn() -> tree_sitter::Language>,
    pub symbol_query: Option<&'static str>,   // 기존 인라인 → 상수/파일
    pub relation_query: Option<&'static str>, // 신규
    pub regex_fallback: Option<RegexExtractor>,
}
pub static REGISTRY: &[LangConfig] = &[ /* … */ ];
// 조회: by_extension(path) -> &LangConfig
```

새 언어 추가 = 레지스트리 1행 + `.scm` 1~2개. (UA 의 byId/byExtension/byFilename 3-인덱스를 단순화: 우리는 확장자 우선 + 파일명 특례(Dockerfile 등은 비목표).)

---

## §4. 증분 (불변식 §3.3)

기존 hash-skip 유지. 한 파일이 바뀌면:
1. 그 파일의 symbols/imports/relations 재추출(기존 흐름).
2. `graph::rebuild_project(project_id, &[changed_file_id])`:
   - 그 파일이 **src 인** graph_edges(contains/calls/imports/inherits) delete → 재삽입.
   - 그 파일이 **tgt 인** 엣지는 다른 파일 소유 → 건드리지 않음(단, 그 파일의 심볼이 사라지면 dangling tgt 는 FK CASCADE 로 정리).
3. `similar_to` 는 임베딩 갱신 시에만(선택, 배치).

전체 rebuild 는 "그래프 재생성" 명시 액션 또는 빈 그래프 최초 1회.

---

## §5. 테스트 (DoD 연계, [`04`](./04-implementation-checklist.md))

- 픽스처 프로젝트(작은 TS+Rust)로 **결정론** 검증: 2회 분석 → 동일 엣지 집합(불변식 §3.1).
- `contains`: 심볼 수 == contains 엣지 수.
- `calls`: 알려진 호출 N개 중 동일파일/직접import 호출은 `estimated=0`, 전역동명은 `estimated=1`.
- 증분: 한 파일 수정 → 그 파일 src 엣지만 변동, 타 파일 엣지 불변.
- 하위호환: `get_dependency_graph` 출력이 업그레이드 전후 동일(imports file-level).
