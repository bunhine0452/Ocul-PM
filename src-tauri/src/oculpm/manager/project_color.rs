//! 프로젝트 색을 `config.toml` 에 (2026-11-13, 플랜 `two-machines-20261113`).
//!
//! 색은 기기의 SQLite 에만 있어서 같은 저장소를 두 기기에서 열면 창 색이 달랐다. `config.toml` 은
//! 저장소에 올라가므로 거기 적으면 색이 저장소를 따라간다 (`OculpmConfig::project_color`).
//!
//! 쓰는 길은 여기 하나다. `set_config`(설정 화면의 저장)는 색을 **디스크의 값으로** 지킨다 — 설정
//! 화면이 든 사본도 메모리의 사본도 pull 로 들어온 색보다 낡았을 수 있고, 그대로 쓰면 다른 기기가
//! 고른 색을 되돌린다. 읽어서 이 기기에 맞추는 쪽은 `commands::project::sync_project_color`.

use super::*;

impl OculpmManager {
    /// 프로젝트 색을 `config.toml` 에 적는다 — 저장소를 따라 다른 기기로 간다 (`OculpmConfig::project_color`).
    /// `None` 은 「색 없음을 골랐다」(`"none"`)로 적는다: 키를 지우면 다른 기기는 제 옛 색을 그대로 둔다.
    /// 나머지 설정은 디스크의 것을 그대로 — 색 하나 바꾸면서 낡은 사본으로 덮지 않는다.
    /// 프로젝트를 아직 열지 않았거나(엔트리 없음) 설정 파일이 없으면 아무것도 쓰지 않는다.
    pub async fn set_project_color(
        &self,
        project_id: u32,
        color: Option<&str>,
    ) -> Result<(), OculpmError> {
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;
        let mut projects = self.projects.write().await;
        let Some(entry) = projects.get_mut(&project_id) else {
            return Ok(());
        };
        let config_path = entry.root.join(".oculpm").join("config.toml");
        let Ok(mut config) = OculpmConfig::load(&config_path) else {
            return Ok(());
        };
        config.project_color = Some(
            color
                .unwrap_or(OculpmConfig::PROJECT_COLOR_NONE)
                .to_string(),
        );
        config.save(&config_path)?;
        entry.config.project_color = config.project_color;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn disk_color(root: &std::path::Path) -> Option<String> {
        OculpmConfig::disk_project_color(&root.join(".oculpm/config.toml"))
    }

    #[tokio::test]
    async fn the_color_goes_to_config_and_survives_a_settings_save() {
        let dir = tempdir().unwrap();
        let manager = OculpmManager::new();
        manager.init_project(1, dir.path(), "ko").await.unwrap();
        let path = dir.path().join(".oculpm/config.toml");
        assert_eq!(disk_color(dir.path()), None, "고르기 전에는 키가 없다");
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("project_color"));

        manager.set_project_color(1, Some("teal")).await.unwrap();
        assert_eq!(disk_color(dir.path()).as_deref(), Some("teal"));

        // 다른 기기가 고른 색이 pull 로 들어왔다 — 메모리의 사본은 아직 teal 이다.
        let pulled = std::fs::read_to_string(&path)
            .unwrap()
            .replace("\"teal\"", "\"rose\"");
        std::fs::write(&path, pulled).unwrap();
        // 설정 화면이 낡은 사본(색 없음)으로 다른 값을 저장해도 색은 디스크의 것이 남는다.
        let mut stale = OculpmConfig::load(&path).unwrap();
        stale.project_color = None;
        stale.watcher.debounce_ms = 900;
        manager.set_config(1, stale).await.unwrap();
        assert_eq!(disk_color(dir.path()).as_deref(), Some("rose"));
        assert_eq!(OculpmConfig::load(&path).unwrap().watcher.debounce_ms, 900);

        // 「색 없음」은 키를 지우지 않고 적는다 — 지우면 다른 기기는 제 옛 색을 그대로 둔다.
        manager.set_project_color(1, None).await.unwrap();
        assert_eq!(disk_color(dir.path()).as_deref(), Some("none"));
    }

    #[tokio::test]
    async fn an_unopened_project_writes_nothing() {
        let dir = tempdir().unwrap();
        OculpmManager::new()
            .set_project_color(7, Some("teal"))
            .await
            .unwrap();
        assert!(!dir.path().join(".oculpm").exists());
    }
}
