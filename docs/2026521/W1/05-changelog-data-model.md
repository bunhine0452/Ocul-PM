# 05. Changelog 데이터 모델 — G1 기반

> **작업 ID**: W1 / G1 데이터 모델  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §4.1 (G1. 자동 Changelog 엔트리 생성), GAP-PLAN §3

---

## 변경 요약

사용자가 외부 LLM으로 코드를 수정한 직후 "오늘 무엇이 어떻게 왜 바뀌었는지" 자연어 기록을 남기기 위한 데이터 모델 신설.

## 새 파일

### `src-tauri/migrations/007_changelog.sql`

**새 테이블**:

#### `changelog_entries`
사용자의 한 번의 "수정 세션" = 한 개의 entry.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | 자동 증가 |
| `project_id` | INTEGER FK | projects(id) 참조 |
| `user_intent` | TEXT | 사용자 최초 입력 (한국어) |
| `prompt_text` | TEXT | 영어 프롬프트 원본 (감사 추적) |
| `ai_summary` | TEXT NOT NULL | LLM 자연어 요약 (마크다운) |
| `title` | TEXT | 한 줄 제목 (편집 가능) |
| `category` | TEXT | feature/fix/refactor/docs/test/chore |
| `external_tool` | TEXT | claude-code, cursor, gemini-cli 등 |
| `files_changed` | INTEGER | 변경 파일 수 |
| `lines_added` | INTEGER | 추가 라인 수 |
| `lines_removed` | INTEGER | 삭제 라인 수 |
| `created_at` | INTEGER | Unix epoch |
| `pinned` | INTEGER | 고정 마크 (0/1) |

#### `changelog_files`
엔트리에 속한 개별 파일 변경.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | 자동 증가 |
| `entry_id` | INTEGER FK | changelog_entries(id) 참조 |
| `file_path` | TEXT | 파일 경로 |
| `change_type` | TEXT | created/modified/deleted/renamed |
| `lines_added` | INTEGER | 파일별 추가 라인 |
| `lines_removed` | INTEGER | 파일별 삭제 라인 |
| `diff_patch` | TEXT | unified diff (압축 권장, 64KB cap) |
| `per_file_summary` | TEXT | LLM 마이크로 요약 |
| `old_hash` | TEXT | 변경 전 해시 |
| `new_hash` | TEXT | 변경 후 해시 |

#### `file_changes` ALTER
```sql
ALTER TABLE file_changes ADD COLUMN entry_id INTEGER
  REFERENCES changelog_entries(id) ON DELETE SET NULL;
```

**인덱스**:
- `idx_changelog_project_date` ON `changelog_entries(project_id, created_at)`
- `idx_changelog_files_entry` ON `changelog_files(entry_id)`

## 수정 파일

### `src-tauri/src/db.rs`

**마이그레이션 등록**:
```rust
(7, include_str!("../migrations/007_changelog.sql")),
```

**새 Rust 타입**:
- `ChangelogEntry` — changelog_entries 테이블 매핑
- `ChangelogFileEntry` — changelog_files 테이블 매핑
- `DailyChangelogBucket` — 타임라인 뷰용 일별 버킷 (date, entries, 통계)

## ER 다이어그램 변화

```
projects ─┬─< changelog_entries          (G1, 신규)
          │     └─< changelog_files      (G1, 신규)
          ├─< file_changes  (+entry_id 컬럼, G1)
          ├─< files (기존)
          ├─< goals (기존)
          └─< chunks / ast_* (기존)
```

## 비파괴적 변경 확인
- ✅ CREATE TABLE만 사용 — 기존 데이터 영향 없음
- ✅ ALTER TABLE ADD COLUMN만 사용 — 기존 file_changes 행 유지
- ✅ 마이그레이션은 `user_version` pragma로 자동 적용

## 향후 작업 (W2)
- `commands/changelog.rs` 신설 (`commit_changelog_entry`, `list_changelog_by_day` 등)
- git diff 추출 유틸 (`git.rs` 확장)
- LLM 요약 프롬프트 템플릿
