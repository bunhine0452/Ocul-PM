# 02. ProjectOverview 구조체 + DB CRUD

> **작업 ID**: W3 / G2 데이터 모델
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.2

---

## 변경 요약

`db.rs` 에 `ProjectOverview` struct 와 2 개의 CRUD 메서드, 1 개의 row 매퍼를
추가. 전체 면적은 작지만 모든 G2 커맨드의 토대.

## 변경 파일

### `src-tauri/src/db.rs`

**새 struct**:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ProjectOverview {
    pub project_id: u32,
    pub identity: Option<String>,
    pub stack_json: Option<String>,
    pub overview_md: Option<String>,
    pub source_signature: Option<String>,
    pub generated_at: Option<u32>,
    pub generated_by_model: Option<String>,
}
```

`Deserialize` 도 derive — 후속 export/import 시나리오에 대비.

**새 메서드 2개** (`impl Db`):

| 메서드 | 시그니처 | 역할 |
|---|---|---|
| `get_project_overview` | `(&self, project_id: u32) -> Result<Option<ProjectOverview>>` | 캐시 조회. 행 없으면 `None`. |
| `upsert_project_overview` | `(&self, project_id, identity, stack_json, overview_md, source_signature, generated_at, generated_by_model)` | INSERT … ON CONFLICT(project_id) DO UPDATE. |

`upsert` 가 7 개 파라미터를 갖는 건 의도적 — 호출 측이 항상 7 개를 명시하게
해 누락된 필드가 사고로 `NULL` 로 덮어쓰이는 일을 막는다. 빌더 패턴은
2-개 호출 (LLM 생성 vs 수동 편집) 만 있으므로 과한 추상화.

**새 row 매퍼**:

```rust
fn project_overview_from_row(r: &rusqlite::Row) -> rusqlite::Result<ProjectOverview> {
    Ok(ProjectOverview {
        project_id: r.get::<_, i64>(0)? as u32,
        identity: r.get(1)?,
        stack_json: r.get(2)?,
        overview_md: r.get(3)?,
        source_signature: r.get(4)?,
        generated_at: r.get::<_, Option<i64>>(5)?.map(|v| v as u32),
        generated_by_model: r.get(6)?,
    })
}
```

`SELECT` 컬럼 순서와 1:1 대응. 다른 매퍼들과 일관된 패턴.

## 설계 결정

- **`Option<String>` 으로 모든 텍스트 컬럼 표현**: 빈 문자열 ≠ "없음" 을 구분
  하는 게 의미 있다 (예: identity 가 의도적으로 빈 문자열로 LLM 이 반환했다면
  보존). NULL 만 "정말 비어 있음".
- **`upsert` 가 비동기 `.await` 한 번에 끝나도록**: `INSERT ... ON CONFLICT`
  는 SQLite 의 atomic UPSERT 라 트랜잭션 불필요. 호출 측이 단순해진다.
- **메서드를 changelog 영역 바로 뒤에 배치**: 의미적으로 인접한 PM 데이터
  (changelog / overview / daily brief) 가 같이 모이게 했다. 알파벳 정렬이나
  CRUD 종류별 분리보다 *기능 그룹화* 가 읽기 좋다.

## 검증

`cargo check` 통과 (구조 변경만, 호출자 없음).
