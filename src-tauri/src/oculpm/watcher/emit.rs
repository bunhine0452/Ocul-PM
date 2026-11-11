//! Tauri 이벤트 방출 헬퍼 — 앱 핸들이 없으면(단위 테스트) 전부 no-op.
//! 화면 갱신 신호(`file_changed` · `data_changed` · `journal_path_changed`)와
//! 무결성 경고 토스트를 한자리에 모아 둔다.

use crate::oculpm::spec::{
    FileChangeEvent, FileOp, IntegrityWarning, OculpmDataArea, OculpmDataChanged,
    OculpmFileChanged, OculpmIntegrityWarning, OculpmJournalPathChanged,
};

use super::handle::WatcherInner;

/// 묶음이 이만큼 차면 정착을 기다리지 않고 보낸다 — 긴 폭풍(브랜치 전환)에서도
/// 화면이 몇 초씩 아무것도 못 받지 않게, IPC 한 번의 덩어리도 묶어 둔다.
pub(super) const FILE_BATCH_MAX: usize = 256;

impl WatcherInner {
    /// 파일 변경을 묶음에 담는다. 보내는 것은 [`Self::flush_file_changes`] — 소비 루프가
    /// 큐를 비운 순간(정착)에 부른다. 예전엔 파일마다 모든 창에 한 번씩 보냈다.
    pub(super) fn emit_file_changed(&self, event: &FileChangeEvent) {
        if self.app_handle.is_none() {
            return;
        }
        let full = {
            let mut pending = self
                .pending_changes
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            pending.push(event.clone());
            pending.len() >= FILE_BATCH_MAX
        };
        if full {
            self.flush_file_changes();
        }
    }

    /// 담아 둔 파일 변경을 한 번에 — **그 프로젝트를 연 창에만**. 창 레지스트리가 없으면
    /// (목 앱) 모두에게, 그 프로젝트를 연 창이 없으면 아무에게도 보내지 않는다.
    pub(super) fn flush_file_changes(&self) {
        let Some(handle) = &self.app_handle else {
            return;
        };
        let events = std::mem::take(
            &mut *self
                .pending_changes
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
        );
        if events.is_empty() {
            return;
        }
        use tauri_specta::Event;
        let payload = OculpmFileChanged {
            project_id: self.project_id,
            events,
        };
        let _ = match crate::commands::window::project_window_label(handle, self.project_id) {
            Some(Some(label)) => payload.emit_to(handle, label.as_str()),
            Some(None) => Ok(()),
            None => payload.emit(handle),
        };
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
