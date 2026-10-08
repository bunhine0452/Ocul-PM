//! 코드 실행 신뢰 — 이 기기에서 이 프로젝트의 저장소가 고른 코드를 돌려도 되는가.
//!
//! 이 문을 지나는 것은 둘이다.
//!
//! - **언어 서버.** 읽기 도구가 아니다. 파일 하나를 여는 것만으로 저장소가 고른 것을
//!   실행한다: rust-analyzer 는 `build.rs` 와 proc-macro 를 돌리고, 그 전에 부르는
//!   `cargo metadata` 부터 저장소의 `rust-toolchain.toml`(경로 툴체인)과
//!   `.cargo/config.toml`(`build.rustc`)이 고른 실행 파일을 쓴다. pyright 는 저장소
//!   venv 의 python 을, typescript-language-server 는 저장소 `node_modules` 의 tsserver
//!   를 띄울 수 있다. 서버 옵션으로 일부를 끌 수는 있어도 전부는 못 막는다 — 그래서
//!   문은 「띄우느냐」 하나다 (2026-10-08 검토, VS Code Workspace Trust 와 같은 자리).
//! - **앱 안 에이전트(ACP).** 어댑터가 저장소의 `.claude/settings.json` 훅과
//!   `.mcp.json` 서버를 읽는다 (claude-agent-acp 0.81 의 `settingSources` 가
//!   user·project·local). 터미널의 CLI 라면 처음에 폴더 신뢰를 묻지만 SDK 경로는
//!   묻지 않고, 우리는 화면이 열리는 순간 `acp_start` 를 부른다 — 묻지 않으면 화면
//!   하나 여는 것으로 저장소의 훅이 돈다 (2026-10-09 리포트). `.claude/` 는
//!   `git clone` 으로 따라오므로 git 설정 경로보다 넓다.
//!
//! 신뢰는 프로젝트에 하나다 — 언어 서버와 에이전트를 따로 묻지 않는다. 둘 다 「이
//! 저장소를 믿느냐」 의 같은 질문이고, 따로 두면 한쪽만 열린 어중간한 상태가 생긴다.
//!
//! 저장 자리는 SQLite `settings` — 기기에만 있고 저장소에는 없다. 선언적 설정
//! 문서는 이 키를 쓰지 못한다 (`config::schema::is_device_consent_key`) — 남의 문서
//! 한 장이 신뢰를 위조하면 이 문이 무의미하다.

use std::path::Path;

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

/// 앱 안 에이전트가 저장소에서 읽어 **실행할 수 있는** 설정 파일 (루트 상대).
/// 신뢰를 묻는 화면이 「무엇이 돌 수 있는지」 를 보여 주는 데 쓴다 — 목록이 비어도
/// 문은 닫혀 있다 (신뢰한 뒤에 생긴 파일도 그대로 돌기 때문이다).
const AGENT_EXEC_FILES: &[&str] = &[
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".mcp.json",
    ".codex/config.toml",
];

/// 앱 안 에이전트를 띄워도 되는가 — 아니면 `project_untrusted`.
///
/// `acp_start` 는 화면이 열리는 순간 불리므로, 묻지 않으면 화면 하나 여는 것으로
/// 저장소의 훅이 돈다. 설치보다 먼저 막는다 — 신뢰하지 않을 프로젝트 때문에
/// 어댑터를 내려받을 이유가 없다. detail = 그 저장소에 실제로 있는 실행 가능한
/// 설정 파일 (줄바꿈 구분 — 화면이 목록으로 보인다).
pub async fn require_for_agent(db: &Db, project_id: u32) -> Result<(), crate::app_error::AppError> {
    if is_trusted(db, project_id).await {
        return Ok(());
    }
    let files = match db.project_root(project_id).await {
        Ok(root) => agent_exec_files(&root).join("\n"),
        Err(_) => String::new(),
    };
    Err(crate::app_error::AppError::new("project_untrusted", files))
}

/// [`AGENT_EXEC_FILES`] 중 이 루트에 있는 것.
pub fn agent_exec_files(root: &Path) -> Vec<&'static str> {
    AGENT_EXEC_FILES
        .iter()
        .copied()
        .filter(|rel| root.join(rel).exists())
        .collect()
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

    #[test]
    fn lists_only_the_agent_settings_that_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(agent_exec_files(dir.path()).is_empty());
        std::fs::create_dir(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".claude/settings.json"), "{}").unwrap();
        std::fs::write(dir.path().join(".mcp.json"), "{}").unwrap();
        assert_eq!(
            agent_exec_files(dir.path()),
            vec![".claude/settings.json", ".mcp.json"]
        );
    }
}
