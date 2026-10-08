//! 코드 실행 신뢰 — 이 기기에서 이 프로젝트의 언어 서버를 띄워도 되는가.
//!
//! 언어 서버는 읽기 도구가 아니다. 파일 하나를 여는 것만으로 저장소가 고른 것을
//! 실행한다: rust-analyzer 는 `build.rs` 와 proc-macro 를 돌리고, 그 전에 부르는
//! `cargo metadata` 부터 저장소의 `rust-toolchain.toml`(경로 툴체인)과
//! `.cargo/config.toml`(`build.rustc`)이 고른 실행 파일을 쓴다. pyright 는 저장소
//! venv 의 python 을, typescript-language-server 는 저장소 `node_modules` 의 tsserver
//! 를 띄울 수 있다. 서버 옵션으로 일부를 끌 수는 있어도 전부는 못 막는다 — 그래서
//! 문은 「띄우느냐」 하나다 (2026-10-08 검토, VS Code Workspace Trust 와 같은 자리).
//!
//! 저장 자리는 SQLite `settings` — 기기에만 있고 저장소에는 없다. 선언적 설정
//! 문서는 이 키를 쓰지 못한다 (`config::schema::is_device_consent_key`) — 남의 문서
//! 한 장이 신뢰를 위조하면 이 문이 무의미하다.

use crate::db::Db;

/// SQLite `settings` 키 접두 (`code_trust.<project_id>`). 프런트의 `codeTrustKey` 와
/// 같은 모양이어야 한다.
pub const KEY_PREFIX: &str = "code_trust.";

pub fn key(project_id: u32) -> String {
    format!("{KEY_PREFIX}{project_id}")
}

/// 이 기기에서 사람이 신뢰한 프로젝트인가. 읽기 실패는 신뢰하지 않은 것으로 본다.
pub async fn is_trusted(db: &Db, project_id: u32) -> bool {
    matches!(db.settings_get(key(project_id)).await, Ok(Some(v)) if v == "true")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 기본은 닫혀 있고, 사람이 남긴 `"true"` 만 연다. 거두기(`"false"`)는 다시 닫는다.
    #[tokio::test]
    async fn closed_until_the_device_says_true() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        assert!(!is_trusted(&db, 3).await);

        db.settings_set(key(3), "true".into()).await.unwrap();
        assert!(is_trusted(&db, 3).await);
        assert!(!is_trusted(&db, 4).await, "프로젝트마다 따로다");

        db.settings_set(key(3), "false".into()).await.unwrap();
        assert!(!is_trusted(&db, 3).await);
    }
}
