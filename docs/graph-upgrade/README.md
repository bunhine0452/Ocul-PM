# Dependency Graph Upgrade — Multi-relation Code Map

> 위상: 현재 *파일 단위 import 그래프(legacy, ui_v2 미노출)* 를 **심볼 단위·멀티관계의 살아있는 코드 맵**으로 끌어올리는 라운드의 문서 세트.
> 작성일 2026-06-15. attribution: claude-code (Opus 4.8).
> 벤치마크: [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (59k★, MIT). 형식 선례: [`../planner-upgrade/`](../planner-upgrade/).

## 한 줄 요약

그래프를 **2층으로 분리**한다. **구조층**(tree-sitter, 결정론적, LLM 없음 — imports/contains/calls/inherits)은 SQLite SSOT 이고 완전 오프라인으로 동작한다. **의미층**(LLM, 선택적 — 요약/레이어/투어)은 그 위에 얹는 캐시 오버레이다. 렌더는 이미 설치돼 있으나 미사용인 **React Flow**로 ui_v2 에 신규 화면을 신설한다.

## 왜 (현재 문제)

1. **접근 불가** — 그래프는 `src/legacy/code/Graph/DependencyGraphView.tsx` 에만 있고 `UiV2View`(today/journal/diff/planner/search/terminal/ai/settings)에 **graph 항목이 없다**. 현재 앱에서 못 본다.
2. **파일 단위뿐** — `file_dependencies` 는 `imports` 파일→파일만. 호출/상속/심볼 관계가 없다.
3. **렌더 빈약** — 커스텀 칸반 컬럼. 줌/팬/포스/클러스터링 없음, 1000+ 파일에서 렉.

## 확정 방향 (사용자 결정 2026-06-15)

- **시작점 = 설계 문서 우선**(본 세트), 잠금 후 구현. → 본 문서가 산출물.
- 구현 순서는 §04 의 PR-GR0~4. **PR-GR0(화면 신설)이 가장 큰 즉시 체감**, 단독 출시 가능.

## 벤치마크에서 가져올 것 / 버릴 것

| 가져옴 | 출처 | 비고 |
|---|---|---|
| 구조/의미 2층 분리, **LLM-free 그래프 빌더** | UA `graph-builder.ts` | 1순위. 재현성·캐시·오프라인 |
| 멀티관계 엣지 taxonomy (imports/contains/calls/inherits/implements/similar_to) | UA 35 edge types | 결정론적 부분집합부터 |
| React Flow + dagre + d3-force + graphology-louvain | UA dashboard | 거의 드롭인 |
| diff 영향분석(역엣지 BFS) | UA `change-classifier.ts` | 기존 "변경 diff"·entry-diff 시너지 |
| **버림**: 휴대용 JSON 을 SSOT 로 | — | 우리는 SQLite SSOT, JSON 은 *내보내기* 파생물 |
| **버림**: 호스트 LLM 의존 멀티에이전트 | — | 우리는 로컬 우선. LLM 없이도 구조 그래프 완전 동작 |

> **우리 강점**: UA 는 임베딩 모델이 없어 의미검색을 호스트에 위임한다. 우리는 이미 **fastembed + sqlite-vec** 로컬 임베딩이 있어 `similar_to` 엣지까지 오프라인으로 만든다. 이게 차별점이고, 본 라운드가 지켜야 할 불변식이다.

## 문서

| # | 문서 | 내용 |
|---|---|---|
| 00 | [`00-master-plan.md`](./00-master-plan.md) | SSOT. 2층 아키텍처, 불변식, 현재 vs 목표, scope/non-goals, 잠금 결정 §0 |
| 01 | [`01-data-model-and-schema.md`](./01-data-model-and-schema.md) | `graph_nodes`/`graph_edges` 스키마, edge taxonomy, 마이그레이션, Rust 구조체, 커맨드 시그니처 |
| 02 | [`02-backend-extraction-spec.md`](./02-backend-extraction-spec.md) | `ast.rs` tree-sitter 쿼리 확장(calls/inherits), 심볼 해석, 언어 레지스트리, 증분 |
| 03 | [`03-ui-screen-spec.md`](./03-ui-screen-spec.md) | `GraphScreenV2` — React Flow, dagre/d3-force 레이아웃, Louvain 클러스터, 필터·심볼펼침·순환·LOD |
| 04 | [`04-implementation-checklist.md`](./04-implementation-checklist.md) | 살아있는 진척표 (PR-GR0~4 DoD + 결정 로그 + 상태표) |

## 비목표 (이 라운드 아님)

- LSP 통합(정밀 호출 해석). 본 라운드는 tree-sitter + 이름매칭(정밀도 한계 명시).
- 외부 패키지(npm/crates/maven) 노드. 프로젝트 내부 파일·심볼만.
- 멀티유저/실시간 협업, 그래프 버전 히스토리.
- 일지/Planner 파이프라인 변경 — 그래프는 *참조/연계* 만.
