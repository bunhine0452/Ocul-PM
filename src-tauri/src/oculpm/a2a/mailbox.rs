//! Phase 2 — 우편함 (마스터플랜 §5).
//!
//! 에이전트가 서로에게 보내는 A2A Message 를 파일로 배달한다:
//! `.oculpm/agents/inbox/<받는이>/<msg_id>.json`.
//!
//! ## 왜 변경(mutation)이 하나도 없는가
//!
//! 이 원장은 **여러 프로세스가 동시에 쓴다** — 앱, 앱 밖 CLI 세션 여럿. 파일을
//! 읽고 고쳐 쓰는 자리가 하나라도 있으면 마지막 쓴 쪽이 이기고 그 사이의 변경은
//! 조용히 사라진다. 그래서 이 모듈에는 고치는 연산이 없다:
//!
//! - 메시지는 **한 번 쓰고 끝**(`create_new` — 이미 있으면 실패).
//! - "읽음"도 고치지 않고 **표식 파일을 하나 더 만든다**(`<msg_id>.read`).
//!
//! 락도 CAS 도 필요 없다. (태스크의 상태 전이는 append-only 원장으로 같은
//! 문제를 푼다 — [`super::tasks`].)
//!
//! ## 크기 상한은 안전 장치다
//!
//! 받은 메시지는 **데이터이지 지시가 아니다**(마스터플랜 D2). 그 계약의 물리적
//! 절반이 상한이다 — 남의 에이전트가 우리 컨텍스트에 소설 한 권을 밀어 넣지
//! 못하게 한다. 시크릿 마스킹은 도구 경계(Phase 4)에서 일지와 같은 길로 돈다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::error::OculpmError;

use super::registry::is_valid_agent_id;

/// 우편함 루트 (프로젝트 루트 기준).
pub const INBOX_SUBDIR: &str = ".oculpm/agents/inbox";

/// 본문 상한 (문자). 넘으면 거부한다 — 자르지 않는다: 잘린 지시는 원문보다
/// 위험할 수 있고, 보낸 쪽이 실패를 알아야 다시 줄여 보낸다.
pub const MAX_TEXT_CHARS: usize = 4000;
/// 첨부(경로 참조) 개수 상한.
pub const MAX_ARTIFACTS: usize = 20;
/// 첨부 경로 한 개의 길이 상한.
pub const MAX_ARTIFACT_LEN: usize = 512;

/// A2A Message — 한 에이전트가 다른 에이전트에게 보낸 한 마디.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Message {
    pub id: String,
    /// 보낸 이의 `agent_id` (레지스트리의 카드 이름).
    pub from: String,
    pub to: String,
    pub text: String,
    /// 이 메시지가 어떤 태스크에 딸린 것이면 그 id.
    pub task_id: Option<String>,
    /// **경로 참조만.** 본문에 파일 내용을 복사하면 원장이 저장소의 나쁜
    /// 사본이 된다 (마스터플랜 §5).
    #[serde(default)]
    pub artifacts: Vec<String>,
    pub created_at: String,
}

/// 보낼 것 — id 와 시각은 서버가 짓는다.
#[derive(Debug, Clone)]
pub struct Outgoing {
    pub from: String,
    pub to: String,
    pub text: String,
    pub task_id: Option<String>,
    pub artifacts: Vec<String>,
}

pub fn inbox_dir(root: &Path, agent_id: &str) -> PathBuf {
    root.join(INBOX_SUBDIR).join(agent_id)
}

/// 거부 사유는 **에이전트가 그대로 읽는다** — 경로 접두사를 붙이지 않는다.
fn bad_input(root: &Path, message: String) -> OculpmError {
    let _ = root;
    OculpmError::A2aRejected(message)
}

/// 첨부는 **프로젝트 안의 상대 경로**여야 한다.
///
/// 절대 경로나 `..` 를 허용하면, 메시지 한 통이 "이 파일을 봐 달라"며 프로젝트
/// 밖(`~/.ssh/id_rsa`)을 가리킬 수 있다. 받는 쪽이 그 참조를 그대로 열면 우리가
/// 유출 경로를 하나 판 셈이다.
pub fn is_safe_artifact(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_ARTIFACT_LEN
        && !path.starts_with('/')
        && !path.starts_with('~')
        && !path.contains('\\')
        && !path.contains('\0')
        // 윈도우 드라이브 문자 (`C:\…`) 도 절대 경로다.
        && !path.chars().nth(1).is_some_and(|c| c == ':')
        && Path::new(path)
            .components()
            .all(|c| !matches!(c, std::path::Component::ParentDir))
}

fn validate(root: &Path, out: &Outgoing) -> Result<(), OculpmError> {
    for (label, id) in [("from", &out.from), ("to", &out.to)] {
        if !is_valid_agent_id(id) {
            return Err(bad_input(root, format!("invalid {label}: {id}")));
        }
    }
    if out.text.chars().count() > MAX_TEXT_CHARS {
        return Err(bad_input(
            root,
            format!("text exceeds {MAX_TEXT_CHARS} characters"),
        ));
    }
    if out.artifacts.len() > MAX_ARTIFACTS {
        return Err(bad_input(
            root,
            format!("more than {MAX_ARTIFACTS} artifacts"),
        ));
    }
    if let Some(bad) = out.artifacts.iter().find(|a| !is_safe_artifact(a)) {
        return Err(bad_input(
            root,
            format!("artifact must be a project-relative path: {bad}"),
        ));
    }
    Ok(())
}

/// 새 메시지 id. 같은 밀리초에 여러 프로세스가 보내도 겹치지 않게 uuid 를 쓴다
/// (앞의 시각은 파일 이름만 봐도 순서가 보이라고).
fn new_id(now: DateTime<Utc>) -> String {
    format!(
        "{}-{}",
        now.format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4().simple()
    )
}

/// 배달한다. **한 번 쓰고 끝** — 같은 id 가 이미 있으면 실패한다.
pub fn send(root: &Path, out: &Outgoing, now: DateTime<Utc>) -> Result<Message, OculpmError> {
    validate(root, out)?;
    let message = Message {
        id: new_id(now),
        from: out.from.clone(),
        to: out.to.clone(),
        text: out.text.clone(),
        task_id: out.task_id.clone(),
        artifacts: out.artifacts.clone(),
        created_at: now.to_rfc3339(),
    };
    let dir = inbox_dir(root, &message.to);
    std::fs::create_dir_all(&dir).map_err(|source| OculpmError::Io {
        path: dir.clone(),
        source,
    })?;
    let path = dir.join(format!("{}.json", message.id));
    let body = serde_json::to_vec_pretty(&message).map_err(|e| OculpmError::Io {
        path: path.clone(),
        source: std::io::Error::other(e),
    })?;

    // `create_new` 지만 **락이 아니다** — 그래서
    // [`file_guard`](crate::oculpm::file_guard) 를 쓰지 않는다. 저쪽은 드롭할 때
    // 파일을 지우는 상호배제 문지기고, 여기 파일은 배달물 그 자체다 (지우면
    // 편지가 사라진다). 같은 호출을 쓴다는 이유로 묶으면 의미가 뒤집힌다.
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|source| OculpmError::Io {
            path: path.clone(),
            source,
        })?;
    file.write_all(&body).map_err(|source| OculpmError::Io {
        path: path.clone(),
        source,
    })?;
    file.sync_all().map_err(|source| OculpmError::Io {
        path: path.clone(),
        source,
    })?;
    Ok(message)
}

fn read_marker(root: &Path, agent_id: &str, msg_id: &str) -> PathBuf {
    inbox_dir(root, agent_id).join(format!("{msg_id}.read"))
}

/// 아직 안 읽은 것만, 오래된 것부터.
pub fn unread(root: &Path, agent_id: &str) -> Vec<Message> {
    all(root, agent_id)
        .into_iter()
        .filter(|m| !read_marker(root, agent_id, &m.id).exists())
        .collect()
}

/// 읽음 여부와 무관한 전부 (파일명 = 시각 순).
pub fn all(root: &Path, agent_id: &str) -> Vec<Message> {
    if !is_valid_agent_id(agent_id) {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(inbox_dir(root, agent_id)) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    paths
        .iter()
        // 깨진 한 통이 우편함 전체를 무너뜨리지 않는다 (남이 쓴 파일이다).
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|raw| serde_json::from_str(&raw).ok())
        .collect()
}

/// 읽었다고 표시한다 — **원본은 고치지 않고 표식을 하나 더 만든다.**
/// 이미 읽음이면 `false`.
pub fn mark_read(root: &Path, agent_id: &str, msg_id: &str) -> bool {
    if !is_valid_agent_id(agent_id) || msg_id.contains('/') || msg_id.contains("..") {
        return false;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(read_marker(root, agent_id, msg_id))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outgoing(to: &str, text: &str) -> Outgoing {
        Outgoing {
            from: "claude-code-app".to_string(),
            to: to.to_string(),
            text: text.to_string(),
            task_id: None,
            artifacts: Vec::new(),
        }
    }

    #[test]
    fn send_then_read_roundtrips_and_marks_read_once() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        let sent = send(root, &outgoing("codex-app", "리뷰 부탁해"), now).unwrap();
        let inbox = unread(root, "codex-app");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].text, "리뷰 부탁해");
        assert_eq!(inbox[0].from, "claude-code-app");

        assert!(mark_read(root, "codex-app", &sent.id));
        assert!(unread(root, "codex-app").is_empty());
        assert_eq!(all(root, "codex-app").len(), 1, "원본은 그대로 남는다");
        assert!(!mark_read(root, "codex-app", &sent.id), "두 번 읽음은 없다");
    }

    /// 받는이별로 갈린다 — 남의 우편함이 보이면 안 된다.
    #[test]
    fn inboxes_are_per_recipient() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        send(root, &outgoing("codex-app", "너에게"), now).unwrap();
        assert_eq!(unread(root, "codex-app").len(), 1);
        assert!(unread(root, "claude-code-app").is_empty());
    }

    /// 첨부는 프로젝트 안의 상대 경로만.
    ///
    /// 절대 경로를 허용하면 메시지 한 통이 "이 파일을 봐 달라"며 `~/.ssh` 를
    /// 가리킬 수 있고, 받는 쪽이 그대로 열면 우리가 유출 경로를 판 셈이 된다.
    #[test]
    fn artifacts_may_not_point_outside_the_project() {
        assert!(is_safe_artifact("src/main.rs"));
        assert!(is_safe_artifact(".oculpm/journal/20260903/Bugs/x.md"));
        assert!(!is_safe_artifact("/etc/passwd"));
        assert!(!is_safe_artifact("~/.ssh/id_rsa"));
        assert!(!is_safe_artifact("../../secrets.env"));
        assert!(!is_safe_artifact("src/../../../etc/passwd"));
        assert!(!is_safe_artifact("C:\\Windows\\System32"));
        assert!(!is_safe_artifact(""));
        assert!(!is_safe_artifact(&"x".repeat(MAX_ARTIFACT_LEN + 1)));

        let dir = tempfile::tempdir().unwrap();
        let mut out = outgoing("codex-app", "봐 줘");
        out.artifacts = vec!["/etc/passwd".to_string()];
        assert!(send(dir.path(), &out, Utc::now()).is_err());
        assert!(unread(dir.path(), "codex-app").is_empty());
    }

    /// 상한을 넘으면 **거부한다 — 자르지 않는다.**
    #[test]
    fn oversized_messages_are_refused_not_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let long = "가".repeat(MAX_TEXT_CHARS + 1);
        assert!(send(dir.path(), &outgoing("codex-app", &long), Utc::now()).is_err());
        assert!(unread(dir.path(), "codex-app").is_empty());

        let mut many = outgoing("codex-app", "ok");
        many.artifacts = (0..=MAX_ARTIFACTS).map(|i| format!("f{i}.rs")).collect();
        assert!(send(dir.path(), &many, Utc::now()).is_err());
    }

    /// 받는이 이름은 경로가 된다 — 탈출을 막는다.
    #[test]
    fn recipient_names_cannot_escape_the_inbox() {
        let dir = tempfile::tempdir().unwrap();
        assert!(send(dir.path(), &outgoing("../../etc", "x"), Utc::now()).is_err());
        assert!(all(dir.path(), "../../etc").is_empty());
        assert!(!mark_read(dir.path(), "codex-app", "../../../x"));
    }

    /// 같은 밀리초에 여러 통을 보내도 서로를 덮지 않는다.
    #[test]
    fn same_instant_messages_do_not_collide() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        for i in 0..5 {
            send(dir.path(), &outgoing("codex-app", &format!("{i}")), now).unwrap();
        }
        assert_eq!(unread(dir.path(), "codex-app").len(), 5);
    }
}
