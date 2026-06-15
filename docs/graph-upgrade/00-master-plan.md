# 00. Dependency Graph Upgrade — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-06-15. attribution: claude-code (Opus 4.8).

---

## §0. 잠금 결정 (Locked Decisions)

후속 문서·코드·리뷰는 이를 위반하면 안 된다. 변경하려면 여기를 먼저 고치고 사유를 남긴다.

- **D-A — 2층 아키텍처.** 그래프 = **구조층(결정론적) + 의미층(LLM, 선택)**. 그래프 빌더는 LLM 을 호출하지 않는다(UA `graph-builder.ts` 패턴). 구조층만으로 화면이 완전 동작한다.
- **D-B — SQLite 가 SSOT.** 그래프는 SQLite 테이블(`graph_nodes`/`graph_edges`)에 산다. 휴대용 `code-graph.json` 은 *내보내기 파생물*(PR-GR4), SSOT 아님. (UA 의 JSON-SSOT 모델 기각: 우리는 이미 인덱스 DB 가 있다.)
- **D-C — 렌더 = React Flow.** `@xyflow/react`(이미 `package.json` 에 있음, 미사용)로 ui_v2 신규 화면. 계층=dagre, 유기형=d3-force, 클러스터=graphology-louvain. (커스텀 칸반 폐기.)
- **D-D — 파일 노드 기본, 심볼 펼침.** 기본 표시는 파일 노드. 클릭/줌인 시 그 파일의 심볼 노드로 펼침(LOD). 1000+ 파일 성능 가드.
- **D-E — `graph_edges` 가 `file_dependencies` 를 대체(superset).** 타입·가중치·심볼단위 src/dst 보유. `get_dependency_graph` 는 `WHERE edge_type='imports'` 투영으로 하위호환 유지. 마이그레이션이 기존 edge 를 백필.
- **D-F — 로컬 우선 불변식.** LLM 키가 없어도 구조 그래프 + `similar_to`(로컬 임베딩) 까지 완전 동작. LLM 은 *추가* 가치만.
- **D-G — legacy 비참조.** `src/legacy/code/Graph/*` 는 건드리지 않고 신규 `src/features/graph/` 로 신설. 백엔드만 공유.

---

## §1. Executive Summary (한 페이지)

ocul-pm 은 이미 **tree-sitter 인덱싱**(Rust/Py/JS/TS/Go AST + 9개 언어 regex)으로 `symbol_definitions`(파일별 함수·클래스·trait…)와 `file_dependencies`(파일→파일 import edge)를 추출하고, **fastembed + sqlite-vec** 로 의미검색을 한다. 그러나 의존성 그래프는 (1) **legacy 폴더에만 있어 현재 앱에서 안 보이고**, (2) **파일 단위 import 만** 알며, (3) 커스텀 칸반이라 줌·포스·클러스터가 없다.

벤치마크 **Understand-Anything** 의 핵심은 *그래프를 구조층(tree-sitter, 결정론적)과 의미층(LLM)으로 분리*하고, 그래프 빌더를 *LLM-free 순수 소비자*로 둔 것이다. 이 분리가 재현성·캐시·비용 통제를 준다.

이 라운드는 셋을 한다:
1. **노출** — ui_v2 에 `graph` 뷰 + 사이드바 "코드 맵" + `GraphScreenV2`(React Flow).
2. **풍부화** — `imports` 단일 관계 → **imports/contains/calls/inherits/implements + similar_to** 멀티관계, 파일+심볼 노드.
3. **연계** — diff 영향분석(역엣지 BFS)으로 "변경 diff"·Today 와 묶고, 선택적 LLM 요약/레이어/투어를 얹는다.

핵심 통찰: **우리는 이미 그래프의 어려운 절반(tree-sitter 파싱·심볼·로컬 임베딩)을 갖고 있다.** 빠진 건 (a) 더 풍부한 엣지 추출, (b) 제대로 된 시각화, (c) ui_v2 노출이다. UA 가 LLM 으로 메우는 부분의 상당수를 우리는 *결정론적으로* 메울 수 있고, 못 메우는 부분만 선택적 LLM 으로 둔다.

---

## §2. 노드·엣지 모델 (목표)

UA 의 21 node / 35 edge taxonomy 중 **결정론적으로 뽑을 수 있는 부분집합**으로 시작한다.

**노드 종류 (`graph_nodes.kind`)**
| kind | 출처 | 단계 |
|---|---|---|
| `file` | `files` 테이블 | PR-GR0 |
| `symbol` (function/class/struct/trait/interface/method/enum/type) | `symbol_definitions` | PR-GR1 |
| `module` (디렉토리/패키지 묶음, 가상) | 경로 파생 | PR-GR2(클러스터) |

**엣지 종류 (`graph_edges.edge_type`)**
| edge_type | 의미 | 추출 | 단계 |
|---|---|---|---|
| `imports` | 파일 A 가 B 를 import | 기존 `file_dependencies` 백필 | PR-GR1 |
| `contains` | 파일 → 그 안의 심볼 | `symbol_definitions` 조인(무비용) | PR-GR1 |
| `calls` | 심볼 A 가 B 를 호출 | tree-sitter call 쿼리 + 이름해석 | PR-GR2 |
| `inherits` / `implements` | 클래스 상속·인터페이스 구현 | tree-sitter extends/impl 쿼리 | PR-GR2 |
| `similar_to` | 의미 유사(임베딩 cosine ≥τ) | sqlite-vec(기존) | PR-GR3 |

엣지는 `weight`(calls=0.8 등 UA 관례) + `direction`(forward/back/bi)을 보유. 자세한 스키마는 [`01`](./01-data-model-and-schema.md).

---

## §3. 불변식 (Invariants)

1. **결정론.** 구조 엣지(imports/contains/calls/inherits)는 동일 입력 → 동일 출력. LLM·난수 개입 금지.
2. **로컬 우선.** 네트워크/키 없이 구조 그래프 + similar_to 완전 동작 (D-F).
3. **증분.** 변경된 파일만 재분석(기존 hash-skip 재사용). 그래프 rebuild 는 변경 파일의 엣지만 갱신.
4. **하위호환.** 기존 `get_dependency_graph`(legacy 가 사용)는 계속 동작 (D-E 투영).
5. **정직한 정밀도.** `calls` 는 *이름 매칭* 이라 오버로드/동적 디스패치/별칭에서 부정확할 수 있음 — UI 가 이를 명시(추정 엣지 표시).

> 한 줄 테스트: *"이 엣지를 LLM 없이, 같은 코드에서 항상 똑같이 뽑을 수 있나?"* → 구조층. 아니면 → 의미층(선택).

---

## §4. 시스템 개요 (데이터 흐름)

```
   소스 파일 ──(watcher/수동 인덱싱, 변경분만)──► indexer::chunk_file ──► ast::analyze_file (tree-sitter)
                                                                              │
                          ┌───────────────────────────────────────────────────┤
                          ▼ symbols                         ▼ imports          ▼ calls/inherits (PR-GR2 신규)
                  symbol_definitions             file_dependencies      (이름해석)
                          │                              │                     │
                          └──────────────► graph_nodes / graph_edges ◄─────────┘   ← 구조층 SSOT (SQLite)
                                                    │
                          (선택) sqlite-vec cosine ─┤ similar_to
                          (선택) LLM enrichment ────┤ node.summary / layer / domain   ← 의미층(캐시 오버레이)
                                                    ▼
                        commands.get_code_graph(project_id, opts) ──► GraphScreenV2 (React Flow)
                                                                       dagre/d3-force + louvain + 필터/LOD
```

---

## §5. Scope / Non-goals

**In scope (이 라운드):** ui_v2 그래프 화면, 멀티관계 구조 그래프(파일+심볼), React Flow 렌더, 레이아웃/클러스터/필터, diff 영향분석, 선택적 LLM enrichment(요약/레이어/투어), JSON 내보내기.

**Out (README 비목표 재확인):** LSP 정밀 해석, 외부 패키지 노드, 그래프 버전 히스토리, 멀티유저.

---

## §6. 위험 / 완화

| 위험 | 완화 |
|---|---|
| 대형 그래프 렌더 렉(1000+ 노드) | D-D 파일노드 기본 + LOD + Louvain 클러스터 접기 + 뷰포트 컬링 |
| `calls` 이름매칭 오탐 | weight↓ + UI "추정" 배지 + 토글로 calls 숨김 가능 |
| LLM enrichment 비용/지연 | 캐시(노드별 1회), 명시적 "AI 설명 생성" 액션, 키 없으면 비표시 |
| tree-sitter 쿼리 언어별 누락 | 언어 레지스트리 + `.scm` 분리([`02`](./02-backend-extraction-spec.md)), 미지원 언어는 imports/contains 까지만 |
| 마이그레이션 중 기존 그래프 깨짐 | `graph_edges` 백필 + `get_dependency_graph` 투영 유지(D-E), legacy 비참조(D-G) |
