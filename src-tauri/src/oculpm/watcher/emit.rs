//! Tauri 이벤트 방출 헬퍼 — 앱 핸들이 없으면(단위 테스트) 전부 no-op.
//! 화면 갱신 신호(`file_changed` · `data_changed` · `journal_path_changed`)와
//! 무결성 경고 토스트를 한자리에 모아 둔다.

use crate::oculpm::spec::{
    FileChangeEvent, FileOp, IntegrityWarning, OculpmDataArea, OculpmDataChanged,
    OculpmFileChanged, OculpmIntegrityWarning, OculpmJournalPathChanged,
};

use super::handle::WatcherInner;

impl WatcherInner {
    pub(super) fn emit_file_changed(&self, event: &FileChangeEvent) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmFileChanged {
                project_id: self.project_id,
                event: event.clone(),
            }
            .emit(handle);
        }
    }

    pub(super) fn emit_data_changed(&self, area: OculpmDataArea, relative_path: &str, op: FileOp) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmDataChanged {
                project_id: self.project_id,
                area,
                relative_path: relative_path.to_string(),
                op,
            }
            .emit(handle);
        }
    }

    pub(super) fn emit_journal_path_changed(&self, relative_path: &str, op: FileOp) {
        if let Some(handle) = &self.app_handle {
            use tauri_specta::Event;
            let _ = OculpmJournalPathChanged {
                project_id: self.project_id,
                relative_path: relative_path.to_string(),
                op,
            }
            .emit(handle);
        }
    }

    /// Emit an `OculpmIntegrityWarning` toast (e.g. "비밀 N건 마스킹됨"). No-op
    /// when running without an app handle (unit tests). Mirrors the index
    /// actor's integrity-warning path.
    pub(super) fn emit_integrity_warning(&self, kind: &str, path: &str, message: &str) {
        let Some(handle) = &self.app_handle else {
            return;
        };
        use tauri_specta::Event;
        let _ = OculpmIntegrityWarning {
            project_id: self.project_id,
            warning: IntegrityWarning {
                kind: kind.to_string(),
                path: path.to_string(),
                message: message.to_string(),
            },
        }
        .emit(handle);
    }
}
