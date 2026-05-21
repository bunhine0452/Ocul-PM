# 03. Changelog Tauri 커맨드 + LLM 요약

> **작업 ID**: W2 / G1 커맨드  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §4.1 (G1. 자동 Changelog)

---

## 변경 요약

`commands/changelog.rs` 신설. Tauri IPC로 프론트엔드에서 호출 가능한 6개 커맨드.
핵심인 `commit_changelog_entry`는 **git diff → LLM 요약 → DB 저장** 파이프라인을 구현.

## 새 파일

### `src-tauri/src/commands/changelog.rs`

**커맨드 6개**:

| 커맨드 | 역할 | 파라미터 |
|---|---|---|
| `commit_changelog_entry` | diff 수집 → LLM 요약 → DB 저장 | project_id, user_intent?, category?, provider, model |
| `list_changelog` | 엔트리 목록 반환 | project_id, since?, limit? |
| `get_changelog_detail` | 단일 엔트리 + 파일 상세 | entry_id |
| `update_changelog` | 제목/카테고리/요약 수정 | entry_id, title?, category?, ai_summary? |
| `delete_changelog` | 삭제 | entry_id |
| `pin_changelog` | 고정 토글 | entry_id |

### `commit_changelog_entry` 파이프라인:

```
Frontend → Tauri IPC
  ↓
1. git diff --stat (working tree vs HEAD)
  → 변경 파일 없으면 에러 반환
  ↓
2. git diff --unified=3 per file (max 64KB)
  → diff 텍스트 수집
  ↓
3. LLM 호출 (system prompt + diff context)
  → JSON 응답: { title, ai_summary, category, per_file_summaries }
  ↓
4. DB: changelog_entries INSERT
  ↓
5. DB: changelog_files INSERT (per file)
  ↓
6. ChangelogEntry 반환 → Frontend
```

### LLM 프롬프트 설계:

**시스템 프롬프트 핵심**:
- 한국어 개발자를 위한 기술 changelog 작성자 역할
- 출력 JSON: `title` (한국어 60자), `ai_summary` (한국어 마크다운), `category`, `per_file_summaries`
- temperature 0.3 (일관성 우선)

**사용자 메시지 구성**:
```
사용자 의도: {user_intent}  (있으면)
변경된 파일 (N files, +M -K)

### path/to/file (modified, +10 -5):
```diff
(unified diff, 파일당 4KB까지)
```
```

## 수정 파일

### `src-tauri/src/commands/mod.rs`
```diff
+ pub mod changelog;
+ pub use changelog::*;
```

### `src-tauri/src/lib.rs`
```diff
  use crate::commands::{
      ...
+     // G1 — Changelog
+     commit_changelog_entry, list_changelog, get_changelog_detail,
+     update_changelog, delete_changelog, pin_changelog,
  };
  
  // collect_commands! 매크로 내
+     commit_changelog_entry,
+     list_changelog,
+     get_changelog_detail,
+     update_changelog,
+     delete_changelog,
+     pin_changelog,
```

## 빌드 검증
- ✅ `cargo check` 성공 (warning 6개 — 기존 코드, 신규 없음)

## 해결된 문제
- ✅ G1 백엔드 파이프라인 전체 완성 (W1에서 DB 스키마만, 이제 커맨드까지)
- ✅ diff → LLM → DB 자동화 흐름 구현
- ✅ specta 바인딩 자동 생성 (dev build 시 `bindings.ts` 업데이트)

## 향후 작업 (W3)
- 프론트엔드 Changelog 타임라인 UI (UI-3)
- IA 5단 사이드바에서 Changelog 탭 연결
