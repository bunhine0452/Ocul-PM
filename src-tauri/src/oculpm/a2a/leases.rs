//! Phase 3 — 작업 구역 임대 (마스터플랜 §7).
//!
//! 이 기능의 **1차 가치**다. 이 저장소에서 실제로 난 사고는 대화 부족이 아니라
//! 충돌이었다 — 병렬 세션이 서로의 WIP 를 쓸어 담은 `git add -A`(2d95df8),
//! stage 와 commit 사이에 움직인 HEAD. 임대는 그것을 **부딪히기 전에** 막는다.
//!
//! ```text
//! A: claim(["src-tauri/src/acp/**"], 30분)      → lease#1
//! B: claim(["src-tauri/src/acp/process.rs"])    → 거절 { holder: A, until: … }
//! B: claim(["src/features/chat/**"])            → lease#2
//! ```
//!
//! ## 겹침은 넉넉하게 본다
//!
//! 두 glob 이 정말 교차하는지는 일반적으로 풀기 어렵다. 그래서 각 패턴에서
//! **첫 와일드카드 앞의 디렉터리 접두사**만 뽑아 비교한다. `src/**/*.rs` 와
//! `src/**/*.ts` 는 실제로 안 겹치지만 여기서는 겹친다고 본다 — 틀리는 방향을
//! 고른 것이다. 헛되이 "쓰는 중"이라고 하는 것은 불편하지만, 안 겹친다고
//! 잘못 말하면 그게 바로 이 기능이 막으려던 사고다.
//!
//! ## 살아 있는 임대란
//!
//! 기한이 남아 있고, **주인이 아직 붙어 있는** 것. 주인이 참여자 목록에
//! 카드를 두었는데 그 카드가 죽었으면 기한과 무관하게 풀린다(세션이 죽으면
//! 구역도 놓아야 한다). 카드가 아예 없는 주인은 기한만으로 판정한다 —
//! 등록하지 않았다는 이유로 남의 임대를 뺏을 수는 없다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use ignore::overrides::OverrideBuilder;
use serde::{Deserialize, Serialize};

use crate::oculpm::error::OculpmError;

use super::registry;
use super::tasks::SYSTEM_ACTOR;

pub const LEASES_SUBDIR: &str = ".oculpm/agents/leases";

/// 임대를 안 놓으면 이만큼 뒤 자동 해제.
pub const DEFAULT_TTL_MINUTES: i64 = 30;
/// 한 번에 잡을 수 있는 패턴 수.
pub const MAX_PATTERNS: usize = 40;
/// 확인-후-쓰기 구간을 지키는 짧은 문지기의 수명. 이 구간은 파일 몇 개를
/// 읽고 하나를 쓰는 것뿐이라 초 단위면 넉넉하다 — 이보다 오래된 문지기는
/// 죽은 프로세스가 남긴 것으로 보고 걷어낸다.
const GUARD_STALE_SECONDS: i64 = 10;

/// 잡아 둔 구역 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Lease {
    pub id: String,
    /// 주인의 `agent_id`.
    pub holder: String,
    /// 잡은 glob 들 (프로젝트 상대).
    pub patterns: Vec<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub expires_at: String,
}

/// 거절당했을 때 돌려주는 것 — 누가, 언제까지.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct LeaseConflict {
    pub holder: String,
    pub until: String,
    /// 부딪힌 패턴 (내 것, 상대 것).
    pub mine: String,
    pub theirs: String,
}

pub fn leases_dir(root: &Path) -> PathBuf {
    root.join(LEASES_SUBDIR)
}

/// 거부 사유는 **에이전트가 그대로 읽는다** — 경로 접두사를 붙이지 않는다.
fn bad_input(root: &Path, message: String) -> OculpmError {
    let _ = root;
    OculpmError::A2aRejected(message)
}

/// 패턴은 프로젝트 안을 가리켜야 한다.
pub fn is_safe_pattern(pattern: &str) -> bool {
    !pattern.trim().is_empty()
        && pattern.len() <= 512
        && !pattern.starts_with('/')
        && !pattern.starts_with('~')
        && !pattern.starts_with('!')
        && !pattern.contains("..")
        && !pattern.contains('\0')
}

/// 첫 와일드카드 앞의 디렉터리 접두사. `src/acp/**` → `src/acp/`,
/// `src/acp/process.rs` → `src/acp/process.rs`.
fn claim_prefix(pattern: &str) -> String {
    let cut = pattern.find(['*', '?', '[', '{']).unwrap_or(pattern.len());
    let head = &pattern[..cut];
    if cut == pattern.len() {
        return head.to_string();
    }
    match head.rfind('/') {
        Some(slash) => head[..=slash].to_string(),
        None => String::new(),
    }
}

/// 두 패턴이 같은 땅을 밟는가 (넉넉하게 — 모듈 문서 참고).
fn patterns_overlap(a: &str, b: &str) -> bool {
    let (pa, pb) = (claim_prefix(a), claim_prefix(b));
    pa.starts_with(&pb) || pb.starts_with(&pa)
}

/// 이 경로가 이 임대에 걸리는가.
pub fn lease_covers(root: &Path, lease: &Lease, rel_path: &str) -> bool {
    let mut builder = OverrideBuilder::new(root);
    for pattern in &lease.patterns {
        if builder.add(pattern).is_err() {
            return false;
        }
    }
    match builder.build() {
        Ok(overrides) => overrides.matched(rel_path, false).is_whitelist(),
        Err(_) => false,
    }
}

fn lease_path(root: &Path, id: &str) -> PathBuf {
    leases_dir(root).join(format!("{id}.json"))
}

fn read_lease(path: &Path) -> Option<Lease> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 지금 살아 있는 임대 (기한 + 주인 생사).
pub fn active(root: &Path, now: DateTime<Utc>) -> Vec<Lease> {
    let Ok(entries) = std::fs::read_dir(leases_dir(root)) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();

    // 참여자 목록은 한 번만 읽는다 — 임대마다 디렉터리를 훑으면 O(n²).
    let cards = registry::read_all(root);
    paths
        .iter()
        .filter_map(|p| read_lease(p))
        .filter(|lease| !expired(lease, &cards, now))
        .collect()
}

fn expired(lease: &Lease, cards: &[registry::AgentCard], now: DateTime<Utc>) -> bool {
    let past_deadline = DateTime::parse_from_rfc3339(&lease.expires_at)
        .map(|until| now > until.with_timezone(&Utc))
        .unwrap_or(true);
    if past_deadline {
        return true;
    }
    // 주인이 카드를 두었는데 그 카드가 죽었으면 구역도 놓는다. 카드가 아예
    // 없으면(등록 안 한 세션) 기한만 본다 — 등록을 안 했다는 이유로 남의
    // 임대를 뺏을 수는 없다.
    match cards.iter().find(|c| c.agent_id == lease.holder) {
        Some(card) => !registry::is_live(card, now),
        None => false,
    }
}

/// 구역을 잡는다. 겹치면 [`LeaseConflict`] 를 담은 오류.
pub fn claim(
    root: &Path,
    holder: &str,
    patterns: &[String],
    ttl_minutes: Option<i64>,
    note: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Lease, OculpmError> {
    if !registry::is_valid_agent_id(holder) {
        return Err(bad_input(root, format!("invalid holder: {holder}")));
    }
    if patterns.is_empty() || patterns.len() > MAX_PATTERNS {
        return Err(bad_input(
            root,
            format!("patterns must be 1..={MAX_PATTERNS}"),
        ));
    }
    if let Some(bad) = patterns.iter().find(|p| !is_safe_pattern(p)) {
        return Err(bad_input(root, format!("unsafe pattern: {bad}")));
    }

    // **확인과 쓰기 사이를 지킨다.** 없으면 둘이 동시에 "안 겹친다"를 확인하고
    // 둘 다 쓴다 — 임대가 겹친 채로 성립하는, 이 기능이 막으려던 바로 그 상태.
    let _guard = Guard::acquire(root, now)?;

    let held = active(root, now);
    for mine in patterns {
        for theirs in held.iter().filter(|l| l.holder != holder) {
            if let Some(hit) = theirs
                .patterns
                .iter()
                .find(|other| patterns_overlap(mine, other))
            {
                let conflict = LeaseConflict {
                    holder: theirs.holder.clone(),
                    until: theirs.expires_at.clone(),
                    mine: mine.clone(),
                    theirs: hit.clone(),
                };
                return Err(bad_input(
                    root,
                    serde_json::to_string(&conflict).unwrap_or_else(|_| {
                        format!("{} holds {hit} until {}", conflict.holder, conflict.until)
                    }),
                ));
            }
        }
    }

    let lease = Lease {
        id: format!(
            "{}-{}",
            now.format("%Y%m%dT%H%M%S%.3f"),
            uuid::Uuid::new_v4().simple()
        ),
        holder: holder.to_string(),
        patterns: patterns.to_vec(),
        note: note.map(str::to_string),
        created_at: now.to_rfc3339(),
        expires_at: (now + Duration::minutes(ttl_minutes.unwrap_or(DEFAULT_TTL_MINUTES)))
            .to_rfc3339(),
    };
    let body = serde_json::to_vec_pretty(&lease).map_err(|e| OculpmError::Io {
        path: lease_path(root, &lease.id),
        source: std::io::Error::other(e),
    })?;
    crate::oculpm::atomic_io::write_atomic(&lease_path(root, &lease.id), &body)?;
    Ok(lease)
}

/// 놓는다. 주인(또는 `system`)만 놓을 수 있다.
pub fn release(root: &Path, lease_id: &str, by: &str) -> bool {
    if lease_id.contains('/') || lease_id.contains("..") {
        return false;
    }
    let path = lease_path(root, lease_id);
    let Some(lease) = read_lease(&path) else {
        return false;
    };
    if by != SYSTEM_ACTOR && by != lease.holder {
        return false;
    }
    std::fs::remove_file(path).is_ok()
}

/// 만료·주인 사망으로 죽은 임대를 지운다. 지운 개수.
pub fn sweep(root: &Path, now: DateTime<Utc>) -> usize {
    let Ok(entries) = std::fs::read_dir(leases_dir(root)) else {
        return 0;
    };
    let cards = registry::read_all(root);
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|p| read_lease(&p).map(|l| (p, l)))
        .filter(|(_, lease)| expired(lease, &cards, now))
        .filter(|(path, _)| std::fs::remove_file(path).is_ok())
        .count()
}

/// 이 경로를 지금 쥐고 있는 임대 (있으면).
pub fn holder_of(root: &Path, rel_path: &str, now: DateTime<Utc>) -> Option<Lease> {
    active(root, now)
        .into_iter()
        .find(|lease| lease_covers(root, lease, rel_path))
}

/// 이 에이전트가 건드린 경로 중 **남의 구역**인 것.
///
/// 이것이 위반 감지의 전부다. 파일 변경만 보고 누가 썼는지는 알 수 없으므로,
/// 에이전트가 스스로 신고한 변경 목록(ACP `session_info_update` 의 파일 변경
/// 보고)에만 적용한다. 앱 밖 CLI 세션은 신고하지 않으니 여기 걸리지 않는다 —
/// 그쪽에는 임대가 강제가 아니라 **합의**다.
pub fn trespasses(
    root: &Path,
    actor: &str,
    rel_paths: &[String],
    now: DateTime<Utc>,
) -> Vec<(String, Lease)> {
    let held = active(root, now);
    rel_paths
        .iter()
        .filter_map(|path| {
            held.iter()
                .filter(|lease| lease.holder != actor)
                .find(|lease| lease_covers(root, lease, path))
                .map(|lease| (path.clone(), lease.clone()))
        })
        .collect()
}

/// 확인-후-쓰기 구간을 지키는 짧은 문지기. 드롭하면 풀린다.
struct Guard {
    path: PathBuf,
}

impl Guard {
    fn acquire(root: &Path, now: DateTime<Utc>) -> Result<Self, OculpmError> {
        let dir = leases_dir(root);
        std::fs::create_dir_all(&dir).map_err(|source| OculpmError::Io {
            path: dir.clone(),
            source,
        })?;
        let path = dir.join(".claim.lock");
        for attempt in 0..2 {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(_) => return Ok(Self { path }),
                Err(_) if attempt == 0 => {
                    // 죽은 프로세스가 남긴 문지기인가. 오래됐으면 걷어낸다 —
                    // 이 구간은 초 단위라, 이보다 오래된 것은 주인이 없다.
                    let stale = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .map(|t| {
                            now - DateTime::<Utc>::from(t) > Duration::seconds(GUARD_STALE_SECONDS)
                        })
                        .unwrap_or(false);
                    if !stale {
                        break;
                    }
                    let _ = std::fs::remove_file(&path);
                }
                Err(_) => break,
            }
        }
        Err(bad_input(
            root,
            "another agent is claiming right now — retry".to_string(),
        ))
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pats(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_second_agent_is_told_who_holds_the_ground() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        let mine = claim(
            root,
            "claude-code-app",
            &pats(&["src-tauri/src/acp/**"]),
            None,
            None,
            now,
        )
        .unwrap();
        assert_eq!(mine.holder, "claude-code-app");

        let refused = claim(
            root,
            "codex-app",
            &pats(&["src-tauri/src/acp/process.rs"]),
            None,
            None,
            now,
        )
        .expect_err("겹치면 거절해야 한다");
        let text = refused.to_string();
        assert!(
            text.contains("claude-code-app"),
            "선점자를 알려야 한다: {text}"
        );

        // 겹치지 않는 구역은 나란히 잡힌다.
        assert!(claim(
            root,
            "codex-app",
            &pats(&["src/features/chat/**"]),
            None,
            None,
            now
        )
        .is_ok());
        assert_eq!(active(root, now).len(), 2);
    }

    /// 같은 주인은 자기 구역을 다시 잡을 수 있다 (재시작·연장).
    #[test]
    fn the_same_holder_may_re_claim_its_own_ground() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        claim(root, "codex-app", &pats(&["src/**"]), None, None, now).unwrap();
        assert!(claim(
            root,
            "codex-app",
            &pats(&["src/features/**"]),
            None,
            None,
            now
        )
        .is_ok());
    }

    /// 겹침은 **넉넉하게** 본다 — 틀리려면 "쓰는 중" 쪽으로 틀린다.
    #[test]
    fn overlap_errs_towards_busy() {
        assert!(patterns_overlap("src/**", "src/features/chat/x.tsx"));
        assert!(patterns_overlap("src/acp/process.rs", "src/acp/**"));
        // 실제로는 안 겹치지만 접두사가 같아 겹친다고 본다 (의도된 보수성).
        assert!(patterns_overlap("src/**/*.rs", "src/**/*.ts"));
        // 다른 땅은 안 겹친다.
        assert!(!patterns_overlap("src-tauri/**", "src/**"));
        assert!(!patterns_overlap("docs/a.md", "landing/b.html"));
    }

    #[test]
    fn a_lease_expires_and_frees_the_ground() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let then = Utc::now() - Duration::minutes(90);
        claim(root, "codex-app", &pats(&["src/**"]), Some(30), None, then).unwrap();

        let now = Utc::now();
        assert!(active(root, now).is_empty(), "기한이 지나면 안 보인다");
        assert!(claim(root, "claude-code-app", &pats(&["src/**"]), None, None, now).is_ok());
        assert_eq!(sweep(root, now), 1, "죽은 임대는 걷힌다");
    }

    /// 세션이 죽으면 구역도 놓는다 — 기한이 남아 있어도.
    #[test]
    fn a_dead_holder_releases_the_ground_before_its_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();

        // 죽은 pid 로 카드를 남긴 참여자.
        let ghost = registry::AgentCard {
            agent_id: "codex-term-4000000000".to_string(),
            name: "Codex".to_string(),
            description: None,
            version: "1.8.0".to_string(),
            skills: Vec::new(),
            provider: "codex".to_string(),
            surface: registry::AgentSurface::Terminal,
            session_id: None,
            pid: Some(4_000_000_000),
            project_root: root.display().to_string(),
            heartbeat_at: now.to_rfc3339(),
        };
        registry::register(root, &ghost).unwrap();
        claim(
            root,
            &ghost.agent_id,
            &pats(&["src/**"]),
            Some(600),
            None,
            now,
        )
        .unwrap();

        assert!(active(root, now).is_empty(), "죽은 주인의 임대는 안 산다");
        assert!(claim(root, "claude-code-app", &pats(&["src/**"]), None, None, now).is_ok());
    }

    /// 등록하지 않은 주인은 기한만으로 판정한다 — 등록 안 했다는 이유로
    /// 남의 임대를 뺏을 수는 없다.
    #[test]
    fn an_unregistered_holder_keeps_its_lease_until_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        claim(
            root,
            "some-cli-session",
            &pats(&["src/**"]),
            None,
            None,
            now,
        )
        .unwrap();
        assert_eq!(active(root, now).len(), 1);
    }

    #[test]
    fn only_the_holder_or_system_releases() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        let lease = claim(root, "codex-app", &pats(&["src/**"]), None, None, now).unwrap();

        assert!(!release(root, &lease.id, "claude-code-app"));
        assert!(!release(root, &lease.id, "../evil"));
        assert!(release(root, &lease.id, "codex-app"));
        assert!(active(root, now).is_empty());
    }

    /// 남의 구역을 밟은 경로만 골라낸다 (에이전트가 스스로 신고한 변경에 적용).
    #[test]
    fn trespasses_names_the_paths_that_belong_to_someone_else() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        claim(
            root,
            "claude-code-app",
            &pats(&["src-tauri/src/acp/**"]),
            None,
            None,
            now,
        )
        .unwrap();

        let touched = pats(&[
            "src-tauri/src/acp/process.rs",
            "src/features/chat/AcpConversation.tsx",
        ]);
        let hits = trespasses(root, "codex-app", &touched, now);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "src-tauri/src/acp/process.rs");
        assert_eq!(hits[0].1.holder, "claude-code-app");

        // 자기 구역을 밟는 것은 위반이 아니다.
        assert!(trespasses(root, "claude-code-app", &touched, now).is_empty());
    }

    #[test]
    fn patterns_must_stay_inside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        for bad in ["/etc/**", "~/secrets/**", "../other/**", "!src/**", ""] {
            assert!(
                claim(root, "codex-app", &pats(&[bad]), None, None, now).is_err(),
                "{bad} 는 거부되어야 한다"
            );
        }
        assert!(active(root, now).is_empty());
    }

    /// 죽은 프로세스가 남긴 문지기가 영원히 길을 막지 않는다.
    #[test]
    fn a_stale_guard_is_broken_instead_of_blocking_forever() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let now = Utc::now();
        std::fs::create_dir_all(leases_dir(root)).unwrap();
        std::fs::write(leases_dir(root).join(".claim.lock"), b"").unwrap();

        // 방금 생긴 문지기는 존중한다.
        assert!(claim(root, "codex-app", &pats(&["src/**"]), None, None, now).is_err());
        // 시간이 지난 뒤에는 걷어내고 진행한다.
        let later = now + Duration::seconds(GUARD_STALE_SECONDS + 1);
        assert!(claim(root, "codex-app", &pats(&["src/**"]), None, None, later).is_ok());
    }
}
