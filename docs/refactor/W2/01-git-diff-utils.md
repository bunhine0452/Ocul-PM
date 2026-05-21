# 01. Git Diff 유틸리티 추가

> **작업 ID**: W2 / G1 커맨드  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §4.1 (G1. 자동 Changelog)

---

## 변경 요약

Changelog 커밋 시 변경 내역을 수집하기 위한 git diff 유틸리티 3개 함수를 `git.rs`에 추가.

## 변경 파일

### `src-tauri/src/git.rs`

**새 타입**:
```rust
pub struct DiffFileStat {
    pub file_path: String,
    pub change_type: String, // "A" added, "M" modified, "D" deleted, "R" renamed
    pub lines_added: u32,
    pub lines_removed: u32,
    pub old_path: Option<String>, // 리네임 시 이전 경로
}
```

**새 함수 3개**:

| 함수 | 역할 | git 명령 |
|---|---|---|
| `diff_stat(root, from, to)` | 파일별 +/- 통계 + 변경 타입 | `--numstat -z` + `--name-status -z` |
| `diff_patch(root, file, from, to, max_bytes)` | 파일별 unified diff 텍스트 | `--unified=3` |
| `diff_shortstat(root, from, to)` | 전체 요약 (files, +, -) | `--shortstat` |

**설계 결정**:
- `from`/`to`가 모두 None이면 working tree vs HEAD 비교 (커밋 전 변경 감지)
- `from`/`to` 지정 시 두 ref 간 비교 (릴리즈 노트용)
- `diff_patch`의 `max_bytes` 파라미터로 거대 diff 메모리 폭발 방지 (기본 64KB)
- `--numstat`과 `--name-status` 두 번 호출하는 이유: numstat만으로는 변경 타입(A/M/D/R)을 구분할 수 없음
