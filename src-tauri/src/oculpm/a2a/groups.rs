//! 세션 묶기 — **프로젝트가 곧 팀은 아니다** (`docs/a2a/00-master-plan.md`).
//!
//! v2.37.0 은 한 프로젝트에 등록한 세션을 전부 한 팀으로 봤다. 실제로는 한쪽이
//! 리팩토링 중일 때 다른 쪽은 그냥 질문에 답하고 있는데도 같은 우편함에 있었다.
//! 이제 **사용자가 화면에서 직접 묶은 세션끼리만** 말하고 일을 넘긴다.
//!
//! ## 무엇을 그룹에 걸고 무엇을 안 거는가
//!
//! | | 그룹에 매이나 | 왜 |
//! |---|---|---|
//! | 메시지·태스크 | **매인다** | *사회적 관계*다 — 누구와 일하는지는 사용자가 정한다 |
//! | 파일 임대 | **안 매인다** | *물리적 자원*이다 — 같은 파일을 고치면 친하든 아니든 부딪힌다 |
//!
//! 임대까지 그룹 안으로 넣으면 "묶지 않은 두 세션이 같은 파일을 조용히 덮어쓰는"
//! 구멍이 생긴다. 애초에 막으려던 그 사고다.
//!
//! ## 묶이지 않으면 발견만
//!
//! 기본값은 **고립**이다. 등록한 세션은 목록에 보이지만 아무에게도 못 보낸다.
//! "받은 메시지는 데이터이지 지시가 아니다"(D2) 앞에 **"애초에 아무나 못
//! 보낸다"**가 서는 셈이고, 승인 없이는 아무 일도 없다는 원칙(D5)과 결이 같다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::OculpmError;

use super::registry;

pub const GROUPS_SUBDIR: &str = ".oculpm/agents/groups";

/// 이름 상한 (화면 한 줄).
pub const MAX_TITLE_CHARS: usize = 60;
/// 한 그룹의 멤버 상한.
pub const MAX_MEMBERS: usize = 12;

/// 사용자가 묶은 한 팀.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Group {
    pub id: String,
    pub title: String,
    /// 멤버의 `agent_id`. 순서는 사용자가 묶은 순서다.
    pub members: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn groups_dir(root: &Path) -> PathBuf {
    root.join(GROUPS_SUBDIR)
}

fn group_path(root: &Path, id: &str) -> PathBuf {
    groups_dir(root).join(format!("{id}.json"))
}

fn rejected(message: String) -> OculpmError {
    OculpmError::A2aRejected(message)
}

/// 파일명이 될 수 있는 그룹 id 인가.
pub fn is_valid_group_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'))
        && !id.contains("..")
}

fn read_group(path: &Path) -> Option<Group> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 디스크의 그룹 전부 (죽은 멤버 포함, 파일명 순).
pub fn read_all(root: &Path) -> Vec<Group> {
    let Ok(entries) = std::fs::read_dir(groups_dir(root)) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    paths.iter().filter_map(|p| read_group(p)).collect()
}

fn write(root: &Path, group: &Group) -> Result<(), OculpmError> {
    let body = serde_json::to_vec_pretty(group).map_err(|e| OculpmError::Io {
        path: group_path(root, &group.id),
        source: std::io::Error::other(e),
    })?;
    write_atomic(&group_path(root, &group.id), &body)
}

fn validate(title: &str, members: &[String]) -> Result<(), OculpmError> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_TITLE_CHARS {
        return Err(rejected(format!(
            "title must be 1..={MAX_TITLE_CHARS} characters"
        )));
    }
    if members.len() < 2 {
        // 하나짜리 그룹은 그룹이 아니다 — 묶는다는 말이 성립하지 않는다.
        return Err(rejected("a group needs at least two members".to_string()));
    }
    if members.len() > MAX_MEMBERS {
        return Err(rejected(format!("more than {MAX_MEMBERS} members")));
    }
    if let Some(bad) = members.iter().find(|m| !registry::is_valid_agent_id(m)) {
        return Err(rejected(format!("invalid member: {bad}")));
    }
    let mut sorted = members.to_vec();
    sorted.sort();
    sorted.dedup();
    if sorted.len() != members.len() {
        return Err(rejected("a member appears twice".to_string()));
    }
    Ok(())
}

/// 묶는다. 이미 다른 그룹에 있던 멤버는 **그 그룹에서 빠진다**.
///
/// 한 세션이 여러 그룹에 걸치면 "누구에게 보내는가"가 모호해진다 — 화면에서
/// 세션을 끌어다 놓는 동작과도 맞는다(마지막에 놓은 자리가 그 세션의 자리다).
pub fn create(
    root: &Path,
    title: &str,
    members: &[String],
    now: DateTime<Utc>,
) -> Result<Group, OculpmError> {
    validate(title, members)?;
    detach_all(root, members, now)?;

    let group = Group {
        id: format!(
            "{}-{}",
            now.format("%Y%m%dT%H%M%S%.3f"),
            uuid::Uuid::new_v4().simple()
        ),
        title: title.trim().to_string(),
        members: members.to_vec(),
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
    };
    write(root, &group)?;
    Ok(group)
}

/// 멤버를 갈아 끼운다 (둘 미만이 되면 해체가 맞으므로 거부).
pub fn set_members(
    root: &Path,
    id: &str,
    members: &[String],
    now: DateTime<Utc>,
) -> Result<Group, OculpmError> {
    let mut group = read(root, id).ok_or_else(|| rejected(format!("unknown group: {id}")))?;
    validate(&group.title, members)?;
    detach_all_except(root, members, id, now)?;
    group.members = members.to_vec();
    group.updated_at = now.to_rfc3339();
    write(root, &group)?;
    Ok(group)
}

/// 그룹을 푼다.
pub fn dissolve(root: &Path, id: &str) -> bool {
    if !is_valid_group_id(id) {
        return false;
    }
    std::fs::remove_file(group_path(root, id)).is_ok()
}

pub fn read(root: &Path, id: &str) -> Option<Group> {
    if !is_valid_group_id(id) {
        return None;
    }
    read_group(&group_path(root, id))
}

/// 이 멤버들을 다른 모든 그룹에서 뺀다.
fn detach_all(root: &Path, members: &[String], now: DateTime<Utc>) -> Result<(), OculpmError> {
    detach_all_except(root, members, "", now)
}

fn detach_all_except(
    root: &Path,
    members: &[String],
    keep: &str,
    now: DateTime<Utc>,
) -> Result<(), OculpmError> {
    for mut other in read_all(root) {
        if other.id == keep {
            continue;
        }
        let before = other.members.len();
        other.members.retain(|m| !members.contains(m));
        if other.members.len() == before {
            continue;
        }
        if other.members.len() < 2 {
            // 남은 하나는 팀이 아니다 — 조용히 푼다.
            dissolve(root, &other.id);
            continue;
        }
        other.updated_at = now.to_rfc3339();
        write(root, &other)?;
    }
    Ok(())
}

/// **살아 있는** 그룹만 — 멤버 중 살아 있는 세션이 둘 이상인 것.
///
/// 죽은 세션이 남은 그룹을 그대로 보여 주면 "저기로 넘기면 되겠다" 는 판단이
/// 허공으로 간다. 참여자 판정과 같은 잣대(pid)를 쓴다.
pub fn live(root: &Path, now: DateTime<Utc>) -> Vec<Group> {
    let alive: Vec<String> = registry::list_live(root, now)
        .into_iter()
        .map(|c| c.agent_id)
        .collect();
    read_all(root)
        .into_iter()
        .filter(|g| g.members.iter().filter(|m| alive.contains(m)).count() >= 2)
        .collect()
}

/// 이 세션이 속한 살아 있는 그룹.
pub fn group_of(root: &Path, agent_id: &str, now: DateTime<Utc>) -> Option<Group> {
    live(root, now)
        .into_iter()
        .find(|g| g.members.iter().any(|m| m == agent_id))
}

/// **말을 걸어도 되는가.** 같은 그룹에 있어야 한다.
///
/// 묶이지 않은 세션은 여기서 막힌다 — 목록에는 보이지만 아무에게도 못 보낸다.
pub fn may_talk(root: &Path, from: &str, to: &str, now: DateTime<Utc>) -> bool {
    if from == to {
        // 자기 자신에게 보내는 것은 그룹과 무관하다 (메모·시험용).
        return true;
    }
    group_of(root, from, now).is_some_and(|g| g.members.iter().any(|m| m == to))
}

/// 말을 걸 수 없을 때 **사람이 읽을 이유**를 만든다.
pub fn refusal(root: &Path, from: &str, to: &str, now: DateTime<Utc>) -> String {
    match group_of(root, from, now) {
        Some(g) => format!(
            "'{to}' 는 이 그룹(「{}」)의 멤버가 아닙니다 — 화면에서 함께 묶은 세션에게만 보낼 수 있습니다",
            g.title
        ),
        None => "이 세션은 아직 어느 그룹에도 묶이지 않았습니다 — Today 의 「함께 일하는 중」에서 함께 일할 세션과 묶어 주세요".to_string(),
    }
}

/// 죽은 그룹(살아 있는 멤버 둘 미만)을 지운다. 지운 개수.
pub fn sweep(root: &Path, now: DateTime<Utc>) -> usize {
    let alive: Vec<String> = registry::list_live(root, now)
        .into_iter()
        .map(|c| c.agent_id)
        .collect();
    read_all(root)
        .into_iter()
        .filter(|g| g.members.iter().filter(|m| alive.contains(m)).count() < 2)
        .filter(|g| dissolve(root, &g.id))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::a2a::registry::{AgentCard, AgentSurface};

    fn live_card(root: &Path, id: &str) {
        registry::register(
            root,
            &AgentCard {
                agent_id: id.to_string(),
                name: id.to_string(),
                description: None,
                version: String::new(),
                skills: Vec::new(),
                provider: "claude-code".to_string(),
                surface: AgentSurface::Terminal,
                session_id: None,
                pid: Some(std::process::id()),
                project_root: root.display().to_string(),
                heartbeat_at: Utc::now().to_rfc3339(),
            },
        )
        .unwrap();
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// 묶이지 않으면 **아무에게도 못 보낸다** — 목록에 보이는 것과 말을 걸 수
    /// 있는 것은 다르다.
    #[test]
    fn an_unbound_session_can_see_but_not_speak() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        live_card(root, "a");
        live_card(root, "b");

        assert!(!may_talk(root, "a", "b", now));
        assert!(refusal(root, "a", "b", now).contains("묶이지"));

        create(root, "auth 리팩토링", &ids(&["a", "b"]), now).unwrap();
        assert!(may_talk(root, "a", "b", now));
        assert!(may_talk(root, "b", "a", now));
    }

    /// 다른 그룹끼리는 못 보낸다 — 이유에 그 그룹 이름이 들어간다.
    #[test]
    fn groups_do_not_talk_across_the_fence() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        for id in ["a", "b", "c", "d"] {
            live_card(root, id);
        }
        create(root, "auth", &ids(&["a", "b"]), now).unwrap();
        create(root, "랜딩", &ids(&["c", "d"]), now).unwrap();

        assert!(may_talk(root, "a", "b", now));
        assert!(!may_talk(root, "a", "c", now));
        assert!(refusal(root, "a", "c", now).contains("auth"));
    }

    /// 한 세션은 그룹 하나에만 — 새로 묶으면 옛 자리에서 빠진다.
    #[test]
    fn a_session_belongs_to_exactly_one_group() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        for id in ["a", "b", "c"] {
            live_card(root, id);
        }
        create(root, "첫 팀", &ids(&["a", "b"]), now).unwrap();
        create(root, "둘째 팀", &ids(&["b", "c"]), now).unwrap();

        // b 가 옮겨 가면서 첫 팀은 하나만 남아 스스로 풀린다.
        let groups = live(root, now);
        assert_eq!(groups.len(), 1, "{groups:?}");
        assert_eq!(groups[0].title, "둘째 팀");
        assert!(!may_talk(root, "a", "b", now));
        assert!(may_talk(root, "b", "c", now));
    }

    /// 하나짜리는 그룹이 아니다.
    #[test]
    fn a_group_of_one_is_not_a_group() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        live_card(root, "a");
        assert!(create(root, "혼자", &ids(&["a"]), now).is_err());
        assert!(create(root, "", &ids(&["a", "b"]), now).is_err());
        assert!(create(root, "겹침", &ids(&["a", "a"]), now).is_err());
        assert!(create(root, "탈출", &ids(&["a", "../evil"]), now).is_err());
    }

    /// 죽은 세션만 남은 그룹은 보이지 않고, 청소에 걷힌다.
    #[test]
    fn a_group_whose_sessions_died_stops_being_a_group() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        live_card(root, "a");
        live_card(root, "b");
        create(root, "곧 죽을 팀", &ids(&["a", "b"]), now).unwrap();
        assert_eq!(live(root, now).len(), 1);

        // b 의 카드를 지우면(세션 종료) 살아 있는 멤버가 하나뿐이다.
        registry::unregister(root, "b");
        assert!(live(root, now).is_empty());
        assert!(!may_talk(root, "a", "b", now));
        assert_eq!(sweep(root, now), 1);
        assert!(read_all(root).is_empty());
    }

    #[test]
    fn members_can_be_swapped_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        for id in ["a", "b", "c"] {
            live_card(root, id);
        }
        let g = create(root, "팀", &ids(&["a", "b"]), now).unwrap();
        let updated = set_members(root, &g.id, &ids(&["a", "c"]), now).unwrap();
        assert_eq!(updated.members, ids(&["a", "c"]));
        assert!(may_talk(root, "a", "c", now));
        assert!(!may_talk(root, "a", "b", now));
        // 둘 미만으로 줄이는 것은 해체이지 갱신이 아니다.
        assert!(set_members(root, &g.id, &ids(&["a"]), now).is_err());
    }
}
