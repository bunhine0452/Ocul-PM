//! 기동 화해 — 감시를 넘겨받기 전에 색인을 디스크와 맞춘다 (2026-10-08 검토).
//!
//! 전체 색인(`index_project`)의 화해는 걷기 결과와 대조하므로 정확하지만, 그 색인은
//! 처음(청크 0)과 사람이 누른 재색인에서만 돈다. 그 사이 앱이 꺼져 있을 때 지워진
//! 파일은 워처의 Delete 를 받지 못해 **영영 남았다** — 측정 당시 13.1만 청크 중
//! 1.47만(11%), 통째로 지운 폴더 하나가 8.4k 였다. 유령은 의미 검색 결과와 AI 패널
//! 근거로 계속 떠오른다.
//!
//! 여기서는 걷지 않는다 — 색인된 경로마다 stat 만 하고, 지금 규칙으로는 색인하지
//! 않을 자리(벤더·캐시 폴더 · 잠금 파일 · 비밀 파일)도 함께 걷어 낸다. 재임베딩은
//! 없다. `.gitignore` 는 보지 않는다: 그 판정은 걷기의 몫이고, 여기서 틀리면 멀쩡한
//! 행을 지운다.

use std::path::Path;

use crate::db::Db;

/// 색인에는 있는데 더는 색인할 수 없는 경로 (순수 — stat 만).
pub(crate) fn stale_paths(root: &Path, indexed: Vec<String>) -> Vec<String> {
    indexed
        .into_iter()
        .filter(|rel| {
            let p = Path::new(rel);
            crate::indexer::is_skipped_name(p)
                || crate::indexer::has_denied_component(p)
                || !root.join(rel).is_file()
        })
        .collect()
}

/// 이 프로젝트의 유령 색인 행을 지운다. 지운 파일 수를 돌려준다 — 임베딩·심볼은
/// FK cascade, diff 기준선은 `delete_files_by_paths` 가 함께 지운다.
pub(crate) async fn prune_stale_index(
    db: &Db,
    project_id: u32,
    root: &Path,
) -> Result<u32, String> {
    let indexed: Vec<String> = db
        .list_project_files(project_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(_, path)| path)
        .collect();
    if indexed.is_empty() {
        return Ok(0);
    }
    let root_owned = root.to_path_buf();
    let stale = tokio::task::spawn_blocking(move || stale_paths(&root_owned, indexed))
        .await
        .map_err(|e| e.to_string())?;
    db.delete_files_by_paths(project_id, stale)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_present_files_and_drops_vanished_or_excluded_ones() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.join(".env.example"), "KEY=1\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("node_modules/x/index.js"), "1\n").unwrap();

        let stale = stale_paths(
            root,
            vec![
                "src/main.rs".into(),
                "src/gone.rs".into(),
                "removed-dir/a.ts".into(),
                ".env.example".into(),
                "node_modules/x/index.js".into(),
            ],
        );
        assert_eq!(
            stale,
            vec![
                "src/gone.rs".to_string(),
                "removed-dir/a.ts".to_string(),
                ".env.example".to_string(),
                "node_modules/x/index.js".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn prunes_rows_and_reports_the_count() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("kept.rs"), "fn a() {}\n").unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let project_id = db
            .create_project("proj".into(), root.to_string_lossy().into_owned())
            .await
            .unwrap();
        for path in ["kept.rs", "gone.rs"] {
            db.upsert_file(project_id, path.into(), "h".into(), 1, 0, None)
                .await
                .unwrap();
        }
        assert_eq!(prune_stale_index(&db, project_id, &root).await.unwrap(), 1);
        let left: Vec<String> = db
            .list_project_files(project_id)
            .await
            .unwrap()
            .into_iter()
            .map(|(_, p)| p)
            .collect();
        assert_eq!(left, vec!["kept.rs".to_string()]);
    }
}
