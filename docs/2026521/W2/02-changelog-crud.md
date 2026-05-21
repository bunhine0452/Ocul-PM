# 02. Changelog CRUD 메서드 — DB 레이어

> **작업 ID**: W2 / G1 커맨드  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §4.1 (G1. 자동 Changelog)

---

## 변경 요약

`db.rs`에 changelog 테이블에 대한 CRUD 메서드 8개와 `changelog_entry_from_row` 행 매퍼를 추가.

## 변경 파일

### `src-tauri/src/db.rs`

**새 메서드** (impl Db 블록 내):

| 메서드 | 역할 |
|---|---|
| `insert_changelog_entry()` | 새 엔트리 생성, 생성된 행 반환 |
| `insert_changelog_file()` | 엔트리에 파일 변경 기록 추가 |
| `list_changelog_entries(project_id, since, limit)` | 일별 목록 조회 (pinned 우선, 최신순) |
| `get_changelog_entry(entry_id)` | 단일 엔트리 조회 |
| `list_changelog_files(entry_id)` | 엔트리 내 파일 목록 |
| `update_changelog_entry(entry_id, title, category, ai_summary)` | 필드별 부분 수정 |
| `delete_changelog_entry(entry_id)` | 삭제 (CASCADE로 changelog_files도 삭제) |
| `pin_changelog_entry(entry_id)` | pinned 토글 (0↔1) |

**새 행 매퍼**:
```rust
fn changelog_entry_from_row(r: &rusqlite::Row) -> rusqlite::Result<ChangelogEntry>
```

**설계 결정**:
- `list_changelog_entries`는 `since` 파라미터가 None이면 전체 조회, Some이면 해당 시점 이후만 필터
- pinned 엔트리가 항상 먼저 나오도록 `ORDER BY pinned DESC, created_at DESC`
- `update_changelog_entry`는 None인 필드는 건너뛰는 부분 업데이트 패턴 (기존 goal_update와 동일)
