// Code graph commands (PR-GR1). `get_code_graph` reads the multi-relation graph
// built by `Db::rebuild_code_graph` after indexing. `get_dependency_graph`
// (project.rs) stays as the backward-compatible file-level view.
use crate::db::{CodeGraph, Db, ImpactReport, SymbolCall};
use tauri::State;

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
pub struct GraphOpts {
    /// Include symbol nodes + `contains` (file→symbol) edges. `false` = only
    /// file nodes + `imports` edges (lighter payload for large projects).
    pub symbol_level: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_code_graph(
    db: State<'_, Db>,
    project_id: u32,
    opts: GraphOpts,
) -> Result<CodeGraph, String> {
    db.get_code_graph(project_id, opts.symbol_level)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_change_impact(
    db: State<'_, Db>,
    project_id: u32,
    changed_paths: Vec<String>,
) -> Result<ImpactReport, String> {
    db.get_change_impact(project_id, changed_paths)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_calls(db: State<'_, Db>, file_id: u32) -> Result<Vec<SymbolCall>, String> {
    db.get_file_calls(file_id).await.map_err(|e| e.to_string())
}
