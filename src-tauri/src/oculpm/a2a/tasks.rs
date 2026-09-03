//! Phase 2 — 태스크 수명주기 (마스터플랜 §6).
//!
//! A2A Task 를 그대로 쓴다: `submitted → working → (completed | failed |
//! canceled | input_required)`. 한 태스크가 파일 하나
//! (`.oculpm/agents/tasks/<task_id>.ndjson`)이고, 그 파일은 **덧붙이기만 한다.**
//!
//! ## 왜 append-only 인가 (CAS 를 안 쓰는 이유)
//!
//! 설계 초안은 "발동 원장의 CAS 를 재사용"이었는데, 실제로 그 CAS 는 SQLite
//! 쪽(기대 오프셋)이라 **여러 프로세스가 같은 파일을 고치는** 이 자리에는 쓸 수
//! 없다. 파일을 읽고 고쳐 쓰면 마지막 쓴 쪽이 이기고 그 사이의 전이가 사라진다.
//!
//! 상태를 고치는 대신 전이를 **한 줄씩 덧붙이고** 읽을 때 접는다.
//! [`append_ndjson`](crate::oculpm::atomic_io::append_ndjson) 은 O_APPEND +
//! 한 번의 `write(2)` 라 동시 생산자에게도 줄 단위로 원자적이다(그 모듈의
//! `concurrent_append_does_not_lose_lines` 가 이미 그것을 단언한다). 락도 CAS 도
//! 없이 유실이 없다.
//!
//! ## 종료는 의무다
//!
//! A2A 는 "종료 이벤트를 반드시 내라, 아니면 호출자가 영원히 기다린다"고 못
//! 박는다. 수행자가 죽으면 아무도 그 줄을 안 쓰므로, 기한을 함께 적어 두고
//! [`expire_overdue`] 가 대신 `failed` 로 닫는다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::{append_ndjson, NDJSON_LINE_CAP};
use crate::oculpm::chain::{self, ChainStatus};
use crate::oculpm::error::OculpmError;

use super::mailbox::{is_safe_artifact, MAX_ARTIFACTS};
use super::registry::is_valid_agent_id;

pub const TASKS_SUBDIR: &str = ".oculpm/agents/tasks";

/// 제목 상한 (문자).
pub const MAX_TITLE_CHARS: usize = 200;
/// 메모 상한 (문자).
pub const MAX_NOTE_CHARS: usize = 1000;
/// 기한을 안 주면 이만큼. 수행자가 죽어도 이 시간 뒤에는 닫힌다.
pub const DEFAULT_DEADLINE_HOURS: i64 = 6;

/// A2A Task 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Submitted,
    Working,
    InputRequired,
    Completed,
    Failed,
    Canceled,
}

impl TaskState {
    /// 더 갈 곳이 없는 상태.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Canceled)
    }

    /// 이 전이가 말이 되는가.
    ///
    /// 종료된 태스크는 **어떤 것으로도** 못 간다. 이걸 막지 않으면 끝난 작업이
    /// 다시 도는 것처럼 보이고, "종료 이벤트를 냈다"는 보장이 무의미해진다.
    pub fn can_move_to(self, next: Self) -> bool {
        if self.is_terminal() || self == next {
            return false;
        }
        match self {
            Self::Submitted => matches!(next, Self::Working | Self::Canceled | Self::Failed),
            Self::Working => !matches!(next, Self::Submitted),
            Self::InputRequired => !matches!(next, Self::Submitted),
            _ => false,
        }
    }
}

/// 원장 한 줄. 첫 줄만 [`head`](TaskEvent::head) 를 싣는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskEvent {
    at: String,
    /// 이 전이를 일으킨 `agent_id` (`system` = 기한 만료로 우리가 닫은 것).
    by: String,
    state: TaskState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    head: Option<TaskHead>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskHead {
    from: String,
    to: String,
    title: String,
    artifacts: Vec<String>,
    deadline_at: String,
}

/// 원장을 접어 만든 지금 상태.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Task {
    pub id: String,
    /// 넘긴 쪽.
    pub from: String,
    /// 받은 쪽.
    pub to: String,
    pub title: String,
    pub state: TaskState,
    /// 마지막 전이에 달린 메모.
    pub note: Option<String>,
    /// 경로 참조만 (본문 복사 금지).
    pub artifacts: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deadline_at: String,
}

/// 새로 넘길 것.
#[derive(Debug, Clone)]
pub struct NewTask {
    pub from: String,
    pub to: String,
    pub title: String,
    pub note: Option<String>,
    pub artifacts: Vec<String>,
    pub deadline_hours: Option<i64>,
}

pub fn tasks_dir(root: &Path) -> PathBuf {
    root.join(TASKS_SUBDIR)
}

fn task_path(root: &Path, task_id: &str) -> PathBuf {
    tasks_dir(root).join(format!("{task_id}.ndjson"))
}

/// 거부 사유는 **에이전트가 그대로 읽는다** — 경로 접두사를 붙이지 않는다.
fn bad_input(root: &Path, message: String) -> OculpmError {
    let _ = root;
    OculpmError::A2aRejected(message)
}

/// 파일명이 될 수 있는 태스크 id 인가.
pub fn is_valid_task_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'))
        && !id.contains("..")
}

/// 한 줄을 덧붙인다 — 앞 줄에 사슬로 묶어서.
///
/// `hash`·`prev` 는 구조체가 아니라 **직렬화된 값에** 얹는다. [`TaskEvent`] 가
/// 두 필드를 모르는 편이 낫다: 읽는 쪽(`read`)은 serde 가 모르는 필드를 그냥
/// 흘려보내므로 접는 코드가 사슬을 알 필요가 없고, 사슬을 아는 자리는 여기
/// 하나로 남는다.
///
/// 앞 줄을 읽고 → 덧붙이는 사이에 **다른 프로세스가 끼어들 수 있다.** 그때도
/// 줄은 유실되지 않고(O_APPEND) 사슬만 갈라지며, 검증기가 그것을 변조가 아니라
/// [갈래](crate::oculpm::chain::BreakReason::Forked)로 부른다. 락을 도입하지 않는
/// 이유는 이 모듈 첫머리의 append-only 결정 그대로다.
fn append_event(root: &Path, task_id: &str, event: &TaskEvent) -> Result<(), OculpmError> {
    let path = task_path(root, task_id);
    let io_err = |e: serde_json::Error| OculpmError::Io {
        path: path.clone(),
        source: std::io::Error::other(e),
    };

    // 앞 줄의 digest 와 이 줄의 자리. 파일이 없으면 이것이 첫 줄이다.
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let prior: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).collect();
    let seq = prior.len() as u32;
    let prev = prior
        .last()
        .and_then(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .and_then(|v| {
            v.get(chain::HASH_FIELD)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });

    let mut value = serde_json::to_value(event).map_err(io_err)?;
    if let Some(prev) = prev {
        value[chain::PREV_FIELD] = serde_json::Value::String(prev);
    }
    let hash = chain::line_digest(task_id, seq, &value).map_err(io_err)?;
    value[chain::HASH_FIELD] = serde_json::Value::String(hash);

    let line = serde_json::to_string(&value).map_err(io_err)?;
    if line.len() > NDJSON_LINE_CAP {
        // 한 줄이 원자적 쓰기 한도를 넘으면 동시 쓰기 보장이 깨진다 — 자르지
        // 않고 거부한다 (제목·메모·첨부 상한이 이걸 막는 앞단이다).
        return Err(bad_input(
            root,
            format!("task event exceeds {NDJSON_LINE_CAP} bytes"),
        ));
    }
    append_ndjson(&task_path(root, task_id), &line)
}

/// 태스크를 넘긴다 (`submitted`).
pub fn create(root: &Path, new: &NewTask, now: DateTime<Utc>) -> Result<Task, OculpmError> {
    for (label, id) in [("from", &new.from), ("to", &new.to)] {
        if !is_valid_agent_id(id) {
            return Err(bad_input(root, format!("invalid {label}: {id}")));
        }
    }
    if new.title.trim().is_empty() || new.title.chars().count() > MAX_TITLE_CHARS {
        return Err(bad_input(
            root,
            format!("title must be 1..={MAX_TITLE_CHARS} characters"),
        ));
    }
    if new.artifacts.len() > MAX_ARTIFACTS {
        return Err(bad_input(
            root,
            format!("more than {MAX_ARTIFACTS} artifacts"),
        ));
    }
    if let Some(bad) = new.artifacts.iter().find(|a| !is_safe_artifact(a)) {
        return Err(bad_input(
            root,
            format!("artifact must be a project-relative path: {bad}"),
        ));
    }
    let note = checked_note(root, new.note.as_deref())?;

    let task_id = format!(
        "{}-{}",
        now.format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4().simple()
    );
    let deadline = now + Duration::hours(new.deadline_hours.unwrap_or(DEFAULT_DEADLINE_HOURS));
    append_event(
        root,
        &task_id,
        &TaskEvent {
            at: now.to_rfc3339(),
            by: new.from.clone(),
            state: TaskState::Submitted,
            note,
            head: Some(TaskHead {
                from: new.from.clone(),
                to: new.to.clone(),
                title: new.title.clone(),
                artifacts: new.artifacts.clone(),
                deadline_at: deadline.to_rfc3339(),
            }),
        },
    )?;
    read(root, &task_id).ok_or_else(|| bad_input(root, "task disappeared after create".into()))
}

fn checked_note(root: &Path, note: Option<&str>) -> Result<Option<String>, OculpmError> {
    match note {
        Some(text) if text.chars().count() > MAX_NOTE_CHARS => Err(bad_input(
            root,
            format!("note exceeds {MAX_NOTE_CHARS} characters"),
        )),
        Some(text) => Ok(Some(text.to_string())),
        None => Ok(None),
    }
}

/// 기한 만료처럼 **우리가 대신** 쓰는 줄의 주인.
pub const SYSTEM_ACTOR: &str = "system";

/// **이 전이를 이 에이전트가 일으켜도 되는가.**
///
/// 상태 기계만으로는 부족하다 — 제3의 에이전트가 남의 태스크를 `completed` 로
/// 닫아 버릴 수 있기 때문이다. 원장이 공유 디스크에 있는 이상 누구나 쓸 수
/// 있으므로 규칙을 여기서 못 박는다:
///
/// - 받은 쪽(`to`)이 일을 한다 — working · input_required · completed · failed.
///   아직 시작 전(`submitted`)이라면 거절(canceled)도 그쪽 몫이다.
/// - 넘긴 쪽(`from`)은 무를 수 있다 — canceled · failed.
/// - 그 밖의 누구도 손대지 못한다. 기한 만료로 우리가 닫는 `system` 은 예외.
fn may_move(task: &Task, by: &str, next: TaskState) -> bool {
    if by == SYSTEM_ACTOR {
        return true;
    }
    if by == task.to {
        return next != TaskState::Canceled || task.state == TaskState::Submitted;
    }
    if by == task.from {
        return matches!(next, TaskState::Canceled | TaskState::Failed);
    }
    false
}

/// 상태를 옮긴다. 말이 안 되는 전이(끝난 태스크를 다시 여는 것 등)는 거부한다.
pub fn advance(
    root: &Path,
    task_id: &str,
    by: &str,
    next: TaskState,
    note: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Task, OculpmError> {
    if !is_valid_agent_id(by) {
        return Err(bad_input(root, format!("invalid agent: {by}")));
    }
    let current =
        read(root, task_id).ok_or_else(|| bad_input(root, format!("unknown task: {task_id}")))?;
    if !may_move(&current, by, next) {
        return Err(bad_input(
            root,
            format!("{by} may not move task {task_id} to {next:?}"),
        ));
    }
    if !current.state.can_move_to(next) {
        return Err(bad_input(
            root,
            format!(
                "illegal transition {:?} → {:?} (task {task_id})",
                current.state, next
            ),
        ));
    }
    let note = checked_note(root, note)?;
    append_event(
        root,
        task_id,
        &TaskEvent {
            at: now.to_rfc3339(),
            by: by.to_string(),
            state: next,
            note,
            head: None,
        },
    )?;
    read(root, task_id).ok_or_else(|| bad_input(root, "task vanished mid-update".into()))
}

/// 원장을 접는다. 깨진 줄은 건너뛴다 — 남이 쓴 파일이고, 한 줄이 깨졌다고
/// 태스크 전체를 잃을 수는 없다.
pub fn read(root: &Path, task_id: &str) -> Option<Task> {
    if !is_valid_task_id(task_id) {
        return None;
    }
    let raw = std::fs::read_to_string(task_path(root, task_id)).ok()?;
    let events: Vec<TaskEvent> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let first = events.first()?;
    let head = first.head.clone()?;
    let last = events.last()?;
    Some(Task {
        id: task_id.to_string(),
        from: head.from,
        to: head.to,
        title: head.title,
        state: last.state,
        note: last.note.clone(),
        artifacts: head.artifacts,
        created_at: first.at.clone(),
        updated_at: last.at.clone(),
        deadline_at: head.deadline_at,
    })
}

/// 이 프로젝트의 태스크 전부 (오래된 것부터).
pub fn list(root: &Path) -> Vec<Task> {
    let Ok(entries) = std::fs::read_dir(tasks_dir(root)) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "ndjson"))
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
        .collect();
    ids.sort();
    ids.iter().filter_map(|id| read(root, id)).collect()
}

/// **이 원장이 손을 탔는가** (플랜 `ledger-and-liveness-honesty`).
///
/// 묶는 값은 task id 다 — 타임스탬프 + UUIDv4 라 사실상 유일하고, 절대경로와
/// 달리 프로젝트 폴더를 옮겨도 변하지 않는다. 파일이 없으면 `None` (검증할
/// 것이 없는 것이지 깨진 것이 아니다).
pub fn verify_chain(root: &Path, task_id: &str) -> Option<ChainStatus> {
    if !is_valid_task_id(task_id) {
        return None;
    }
    let raw = std::fs::read_to_string(task_path(root, task_id)).ok()?;
    Some(chain::verify_lines(task_id, &raw))
}

/// 모든 태스크 원장을 검증한다 — id 순서로.
pub fn verify_all(root: &Path) -> Vec<(String, ChainStatus)> {
    let Ok(entries) = std::fs::read_dir(tasks_dir(root)) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "ndjson"))
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
        .collect();
    ids.sort();
    ids.into_iter()
        .filter_map(|id| verify_chain(root, &id).map(|status| (id, status)))
        .collect()
}

/// 이 에이전트가 **받은** 태스크.
pub fn list_for(root: &Path, agent_id: &str) -> Vec<Task> {
    list(root)
        .into_iter()
        .filter(|t| t.to == agent_id)
        .collect()
}

/// 기한이 지났는데 아직 안 끝난 것을 `failed` 로 닫는다.
///
/// 수행자가 죽으면 아무도 종료 줄을 안 쓴다 — 그대로 두면 넘긴 쪽이 영원히
/// 기다린다(A2A 가 경고하는 바로 그 상태). 닫은 것들을 돌려준다.
pub fn expire_overdue(root: &Path, now: DateTime<Utc>) -> Vec<Task> {
    list(root)
        .into_iter()
        .filter(|task| !task.state.is_terminal())
        .filter(|task| {
            DateTime::parse_from_rfc3339(&task.deadline_at)
                .map(|deadline| now > deadline.with_timezone(&Utc))
                .unwrap_or(false)
        })
        .filter_map(|task| {
            append_event(
                root,
                &task.id,
                &TaskEvent {
                    at: now.to_rfc3339(),
                    by: SYSTEM_ACTOR.to_string(),
                    state: TaskState::Failed,
                    note: Some("기한이 지나 닫힘 — 수행자가 종료를 알리지 않았다".to_string()),
                    head: None,
                },
            )
            .ok()?;
            read(root, &task.id)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_task() -> NewTask {
        NewTask {
            from: "claude-code-app".to_string(),
            to: "codex-app".to_string(),
            title: "리뷰에서 나온 P0 두 건 고치기".to_string(),
            note: None,
            artifacts: vec!["src-tauri/src/acp/process.rs".to_string()],
            deadline_hours: None,
        }
    }

    #[test]
    fn a_task_walks_from_submitted_to_completed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        let task = create(root, &new_task(), now).unwrap();
        assert_eq!(task.state, TaskState::Submitted);
        assert_eq!(task.to, "codex-app");

        let working = advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();
        assert_eq!(working.state, TaskState::Working);

        let done = advance(
            root,
            &task.id,
            "codex-app",
            TaskState::Completed,
            Some("일지 1408 참고"),
            now,
        )
        .unwrap();
        assert_eq!(done.state, TaskState::Completed);
        assert_eq!(done.note.as_deref(), Some("일지 1408 참고"));
        // 접었을 때 머리 정보는 첫 줄에서 그대로 온다.
        assert_eq!(done.title, "리뷰에서 나온 P0 두 건 고치기");
        assert_eq!(done.artifacts, vec!["src-tauri/src/acp/process.rs"]);

        assert_eq!(list_for(root, "codex-app").len(), 1);
        assert!(list_for(root, "claude-code-app").is_empty());
    }

    /// 끝난 태스크는 다시 열리지 않는다 — "종료를 냈다"는 보장이 무의미해진다.
    #[test]
    fn a_finished_task_cannot_be_reopened() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();
        advance(root, &task.id, "codex-app", TaskState::Completed, None, now).unwrap();

        for next in [
            TaskState::Working,
            TaskState::Submitted,
            TaskState::Failed,
            TaskState::Canceled,
        ] {
            assert!(
                advance(root, &task.id, "codex-app", next, None, now).is_err(),
                "{next:?} 로 되돌아갈 수 있으면 안 된다"
            );
        }
        assert_eq!(read(root, &task.id).unwrap().state, TaskState::Completed);
    }

    #[test]
    fn submitted_cannot_jump_straight_to_completed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        assert!(advance(root, &task.id, "codex-app", TaskState::Completed, None, now).is_err());
        // 취소·실패는 곧바로 갈 수 있다 (승인 전에 무를 수 있어야 한다).
        assert!(advance(root, &task.id, "codex-app", TaskState::Canceled, None, now).is_ok());
    }

    /// 수행자가 죽어 아무도 종료를 안 알리면, 기한이 대신 닫는다.
    #[test]
    fn an_overdue_task_is_closed_instead_of_hanging_forever() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let created = Utc::now() - Duration::hours(2);
        let mut spec = new_task();
        spec.deadline_hours = Some(1);
        let task = create(root, &spec, created).unwrap();
        advance(
            root,
            &task.id,
            "codex-app",
            TaskState::Working,
            None,
            created,
        )
        .unwrap();

        let closed = expire_overdue(root, Utc::now());
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].state, TaskState::Failed);
        assert!(closed[0].note.as_deref().unwrap().contains("기한"));

        // 이미 닫힌 것을 또 닫지 않는다.
        assert!(expire_overdue(root, Utc::now()).is_empty());
    }

    /// 남의 태스크를 제3자가 닫지 못한다.
    ///
    /// 원장은 공유 디스크에 있어 누구나 쓸 수 있다 — 상태 기계만으로는
    /// "codex 에게 넘긴 일을 gemini 가 completed 로 닫는" 것을 못 막는다.
    #[test]
    fn only_the_two_parties_may_move_a_task() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();

        // 제3자는 아무 것도 못 한다.
        assert!(advance(
            root,
            &task.id,
            "gemini-cli-app",
            TaskState::Working,
            None,
            now
        )
        .is_err());
        assert!(advance(
            root,
            &task.id,
            "gemini-cli-app",
            TaskState::Completed,
            None,
            now
        )
        .is_err());

        // 넘긴 쪽은 무를 수 있지만 남의 일을 대신 끝내지는 못한다.
        assert!(advance(
            root,
            &task.id,
            "claude-code-app",
            TaskState::Working,
            None,
            now
        )
        .is_err());
        assert!(advance(
            root,
            &task.id,
            "claude-code-app",
            TaskState::Canceled,
            None,
            now
        )
        .is_ok());

        // 받은 쪽이 일을 한다.
        let second = create(root, &new_task(), now).unwrap();
        assert!(advance(root, &second.id, "codex-app", TaskState::Working, None, now).is_ok());
        assert!(advance(
            root,
            &second.id,
            "codex-app",
            TaskState::Completed,
            None,
            now
        )
        .is_ok());
    }

    /// 원장은 덧붙이기만 한다 — 전이가 쌓여도 이전 줄은 그대로다.
    #[test]
    fn the_ledger_only_ever_grows() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();
        advance(
            root,
            &task.id,
            "codex-app",
            TaskState::InputRequired,
            Some("모델 선택을 물어봐야 한다"),
            now,
        )
        .unwrap();

        let raw = std::fs::read_to_string(task_path(root, &task.id)).unwrap();
        assert_eq!(raw.lines().filter(|l| !l.trim().is_empty()).count(), 3);
        assert!(raw.contains("submitted"), "첫 줄이 남아 있어야 한다");
    }

    /// **실제로 쓴 원장이 사슬로 이어진다** (플랜 `ledger-and-liveness-honesty`).
    ///
    /// `chain.rs` 의 순수 함수 테스트는 검증기가 옳다는 것만 말한다. 이 테스트는
    /// `append_event` 가 그 사슬을 **실제로 건다**는 것을 문다 — 체인을 빼면
    /// 여기가 깨진다.
    #[test]
    fn a_ledger_written_through_the_real_path_verifies() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();
        advance(
            root,
            &task.id,
            "codex-app",
            TaskState::Completed,
            Some("끝"),
            now,
        )
        .unwrap();

        assert_eq!(
            verify_chain(root, &task.id),
            Some(ChainStatus::Intact { lines: 3 })
        );
        assert_eq!(verify_all(root).len(), 1);
    }

    /// 손으로 고친 원장은 **그 줄에서** 잡힌다. 막지는 못하지만 숨지도 못한다.
    #[test]
    fn a_hand_edited_ledger_is_caught_at_the_edited_line() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();

        // 둘째 줄의 주인을 바꿔 치기 — 누가 한 일인지를 고치는 흔한 손질.
        let path = task_path(root, &task.id);
        let raw = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, raw.replace("codex-app", "claude-app")).unwrap();

        match verify_chain(root, &task.id) {
            Some(ChainStatus::Broken(b)) => assert_eq!(b.line, 1),
            other => panic!("손질을 못 잡았다: {other:?}"),
        }
    }

    /// 사슬이 없던 시절의 원장을 "깨졌다"고 부르지 않는다 — 없는 것은 없는 것이다.
    #[test]
    fn a_ledger_from_before_the_chain_is_unverifiable_not_broken() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(tasks_dir(root)).unwrap();
        let id = "20260901T100000.000-0123456789abcdef0123456789abcdef";
        std::fs::write(
            tasks_dir(root).join(format!("{id}.ndjson")),
            r#"{"at":"2026-09-01T10:00:00+09:00","by":"codex-app","state":"submitted","head":{"from":"claude-app","to":"codex-app","title":"옛 것","artifacts":[],"deadline_at":"2026-09-01T16:00:00+09:00"}}
"#,
        )
        .unwrap();

        assert_eq!(
            verify_chain(root, id),
            Some(ChainStatus::Unverifiable { line: 1 })
        );
        // 접는 쪽은 여전히 읽는다 — 옛 원장이 화면에서 사라지면 안 된다.
        assert!(read(root, id).is_some());
    }

    /// 깨진 줄 하나가 태스크를 통째로 잃게 하지 않는다.
    #[test]
    fn a_broken_line_does_not_lose_the_task() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let task = create(root, &new_task(), now).unwrap();
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(task_path(root, &task.id))
                .unwrap();
            writeln!(f, "{{ not json").unwrap();
        }
        advance(root, &task.id, "codex-app", TaskState::Working, None, now).unwrap();
        assert_eq!(read(root, &task.id).unwrap().state, TaskState::Working);
    }

    #[test]
    fn ids_and_payloads_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        let mut long_title = new_task();
        long_title.title = "제".repeat(MAX_TITLE_CHARS + 1);
        assert!(create(root, &long_title, now).is_err());

        let mut escaping = new_task();
        escaping.artifacts = vec!["../../etc/passwd".to_string()];
        assert!(create(root, &escaping, now).is_err());

        let mut bad_to = new_task();
        bad_to.to = "../evil".to_string();
        assert!(create(root, &bad_to, now).is_err());

        assert!(!is_valid_task_id("../x"));
        assert!(!is_valid_task_id("a/b"));
        assert!(is_valid_task_id("20260903T143000.000-abc123"));
    }
}
