//! `index_project` 의 파일당 블로킹 구간 — `project.rs` 에서 떼어 냈다 (순수 이동,
//! #index-double-run 의 단일 비행 래퍼가 그 파일을 800줄 한계 밖으로 밀어서).

use std::fs;
use std::time::UNIX_EPOCH;

use crate::indexer;

/// `index_project` 의 파일당 **CPU·블로킹 구간** 결과 (read + blake3 + metadata).
///
/// 이 심 전체가 오랫동안 `spawn_blocking` **밖**, 즉 tokio 런타임 워커 위에서
/// 돌았다. 기준선 측정(`docs/20260904_v242-load-bearing/perf-baseline.md` §1 M2)
/// 은 이 저장소(1,327 파일, 릴리스 프로필)에서 walk 204 ms + read·blake3·
/// tree-sitter **6,207 ms** = 워커 하나를 **6,411 ms** 통째로 점유한다고 쟀다.
/// 그 구간을 여기(그리고 `chunk_file` 호출)로 모아 blocking 풀로 넘긴다.
pub(super) struct PreparedFile {
    pub content: String,
    pub hash: String,
    pub size: i64,
    pub mtime: i64,
    pub language: Option<String>,
}

/// `Ok(None)` = 이 파일은 건너뛴다 (읽기 실패 · minified/생성 파일).
/// `Err` = 색인 전체를 중단할 만한 실패 (기존 `metadata` 의 `?` 와 같은 뜻).
pub(super) fn prepare_file(path: &std::path::Path) -> Result<Option<PreparedFile>, String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(None);
    };
    // minified/생성 파일은 행을 남기지 않고 건너뛴다 — 다음 색인 때 다시
    // 판정되므로 규칙이 바뀌면 스스로 따라온다.
    if !indexer::is_indexable_content(&content) {
        return Ok(None);
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(Some(PreparedFile {
        size: metadata.len() as i64,
        mtime,
        language: indexer::language_for(path).map(String::from),
        content,
        hash,
    }))
}

#[cfg(test)]
mod tests {
    use super::prepare_file;

    /// `index_project` 의 파일당 심을 `spawn_blocking` 으로 옮기면서 이 판정이
    /// 함수 하나로 빠져나왔다 — 판정 자체는 예전과 **한 글자도 달라지면 안 된다**.
    #[test]
    fn prepare_file_keeps_the_old_skip_rules() {
        let dir = tempfile::tempdir().unwrap();

        // 정상 파일 — 해시·크기·언어가 채워진다.
        let ok = dir.path().join("a.rs");
        std::fs::write(&ok, "fn main() {}\n").unwrap();
        let p = prepare_file(&ok).unwrap().expect("정상 파일은 Some");
        assert_eq!(p.content, "fn main() {}\n");
        assert_eq!(p.size, 13);
        assert_eq!(p.language.as_deref(), Some("rust"));
        assert_eq!(p.hash, blake3::hash(b"fn main() {}\n").to_hex().to_string());

        // 없는 파일 — 읽기 실패는 **건너뜀**이지 색인 중단이 아니다.
        assert!(prepare_file(&dir.path().join("nope.rs")).unwrap().is_none());

        // minified/생성 파일 — 한 줄이 너무 길면 행을 남기지 않고 건너뛴다.
        let min = dir.path().join("big.js");
        std::fs::write(&min, "x".repeat(50_000)).unwrap();
        assert!(prepare_file(&min).unwrap().is_none());
    }
}
