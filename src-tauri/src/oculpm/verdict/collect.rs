//! 판정 입력 **수집**(IO). 판정 자체는 [`super::judge`] 가 하고 여기서는
//! 아무것도 결정하지 않는다 — 그래야 판정에 하네스가 붙는다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{ChangedFile, JournalRecord, VerdictInput, WorkdaySession};
use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::spec::Session;

/// 세그먼트 마커 접두 — `SessionStart` 가 만들고 `SessionEnd` 가 지운다.
pub const SEGMENT_MARKER_PREFIX: &str = ".session-start-";
/// 생존 흔적 접두 — 훅이 **매 턴** 다시 찍는다.
pub const LIVE_MARKER_PREFIX: &str = ".session-live-";

/// 옆 대화가 "지금 살아 있다"고 볼 흔적의 유효 기간.
///
/// 마커의 **존재**만으로는 못 센다: 크래시로 남은 마커가 7일간 버티기 때문에
/// (실측 2026-09-05: 잔여 마커 14개 중 13개가 SessionEnd 를 못 받았다) 그것만
/// 믿으면 사고 한 번에 게이트가 영구 침묵한다. 그래서 마커와 별도로 훅이 매
/// 턴 다시 찍는 생존 파일을 보고, 그 mtime 이 이 창 안일 때만 용의자로 센다.
///
/// 창이 6시간인 이유: 한 턴이 길어야 수십 분이지만 도구 하나가 오래 걸리는
/// 세션이 있고, 이 값이 짧으면 **살아 있는 옆 대화를 죽었다고 보아 엉뚱한
/// 대화를 붙잡는다**(오탐). 반대로 길면 침묵이 길어질 뿐이다(미탐). 위
/// 비대칭대로 넉넉한 쪽으로 잡았다.
pub const PEER_LIVE_WINDOW_SECS: i64 = 6 * 3600;

/// 프론트매터를 읽을 일지의 시간 창. 이 밖의 일지는 stat 만 하고 파싱하지
/// 않는다 — 게이트는 매 턴 도는 자리라 548건 전수 파싱을 감당할 수 없다.
const JOURNAL_LOOKBACK_SECS: i64 = 7 * 24 * 3600;
/// 그래도 파싱할 파일 수의 상한 (최신부터).
const JOURNAL_PARSE_CAP: usize = 400;

/// 디스크에서 판정 입력을 모은다.
///
/// 실패는 전부 "모름"으로 접힌다 — 수집이 못 읽은 것을 위반으로 바꾸지
/// 않는다. 그 변환은 [`super::judge`] 만이 한다.
pub fn collect(root: &Path, conversation: &str, now: i64) -> VerdictInput {
    let hooks = root.join(".oculpm").join("hooks");
    let segment_started_at =
        mtime_of(&hooks.join(format!("{SEGMENT_MARKER_PREFIX}{conversation}")));
    let live_peers = live_peers(&hooks, conversation, now);
    let changes = changed_files(root);
    let since = segment_started_at.unwrap_or(now) - JOURNAL_LOOKBACK_SECS;

    VerdictInput {
        conversation: conversation.to_string(),
        segment_started_at,
        live_peers,
        working_tree_readable: changes.is_some(),
        changes: changes.unwrap_or_default(),
        journals: journals(root, since),
        workday_sessions: workday_sessions(root),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 세그먼트 · 생존
// ─────────────────────────────────────────────────────────────────────────────

/// 지금 살아 있는 **다른** 대화들 (자기 자신 제외).
///
/// 마커가 있고(시작했고 아직 안 끝났다) 생존 흔적이 최근인 대화만 센다.
pub fn live_peers(hooks_dir: &Path, conversation: &str, now: i64) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(hooks_dir) else {
        return Vec::new();
    };
    let mut markers: Vec<String> = Vec::new();
    let mut live: BTreeMap<String, i64> = BTreeMap::new();
    for entry in rd.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if let Some(id) = name.strip_prefix(SEGMENT_MARKER_PREFIX) {
            markers.push(id.to_string());
        } else if let Some(id) = name.strip_prefix(LIVE_MARKER_PREFIX) {
            if let Some(t) = mtime_of(&entry.path()) {
                live.insert(id.to_string(), t);
            }
        }
    }
    let mut peers: Vec<String> = markers
        .into_iter()
        .filter(|id| id != conversation)
        .filter(|id| {
            live.get(id)
                .is_some_and(|t| now - t <= PEER_LIVE_WINDOW_SECS)
        })
        .collect();
    peers.sort();
    peers.dedup();
    peers
}

fn mtime_of(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

// ─────────────────────────────────────────────────────────────────────────────
// 워킹트리
// ─────────────────────────────────────────────────────────────────────────────

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

/// 더티 파일 목록. `None` = 워킹트리를 못 읽었다 (git 부재·비저장소).
///
/// pathspec `-- .` 로 이 프로젝트 하위만 본다 (모노레포 이웃 제외). 경로는
/// git 최상위 기준이라 `show-prefix` 로 우리 자리를 보정한다.
fn changed_files(root: &Path) -> Option<Vec<ChangedFile>> {
    let top = PathBuf::from(git(root, &["rev-parse", "--show-toplevel"])?.trim());
    let prefix = git(root, &["rev-parse", "--show-prefix"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let porcelain = git(
        root,
        &[
            "-c",
            "core.quotepath=off",
            "status",
            "--porcelain",
            "--",
            ".",
        ],
    )?;
    let oculpm_prefix = format!("{prefix}.oculpm");

    let mut out = Vec::new();
    for line in porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let mut path = &line[3..];
        // rename 은 새 경로로 판정한다 (`.oculpm` 밖으로 나간 이동도 실질 변경).
        if let Some(idx) = path.find(" -> ") {
            path = &path[idx + 4..];
        }
        // 공백 등으로 C-quote 된 경로는 겉따옴표만 벗긴다. 이스케이프가 남으면
        // stat 이 실패해 그 파일만 빠진다 — 미탐 방향이라 무해하다.
        let path = path.trim_matches('"');
        if path == oculpm_prefix || path.starts_with(&format!("{oculpm_prefix}/")) {
            continue;
        }
        // 삭제된 파일은 mtime 을 물을 자리가 없다. 셸 판정과 같은 한계
        // (`[ -e ]`) — 삭제만 한 대화는 지금도 빠져나간다 (이월).
        if let Some(modified_at) = mtime_of(&top.join(path)) {
            out.push(ChangedFile {
                path: path.to_string(),
                modified_at,
            });
        }
    }
    Some(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// 일지 · 작업 세션
// ─────────────────────────────────────────────────────────────────────────────

/// `.oculpm/journal/**/*.md` 중 `since` 이후에 손댄 것만 프론트매터까지 읽는다.
pub fn journals(root: &Path, since: i64) -> Vec<JournalRecord> {
    let mut paths: Vec<(i64, PathBuf)> = Vec::new();
    walk_md(&root.join(".oculpm").join("journal"), &mut |p| {
        if let Some(t) = mtime_of(&p) {
            if t >= since {
                paths.push((t, p));
            }
        }
    });
    paths.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    paths.truncate(JOURNAL_PARSE_CAP);

    paths
        .into_iter()
        .map(|(modified_at, path)| {
            let parsed = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| parse_frontmatter_and_body(&text).0.parsed);
            JournalRecord {
                agent_session: parsed.as_ref().and_then(|fm| fm.agent.session.clone()),
                workday_session_id: parsed
                    .as_ref()
                    .map(|fm| fm.session_id.clone())
                    .filter(|s| !s.is_empty()),
                modified_at,
            }
        })
        .collect()
}

fn walk_md(dir: &Path, visit: &mut impl FnMut(PathBuf)) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_md(&p, visit);
        } else if p.extension().is_some_and(|e| e == "md") {
            visit(p);
        }
    }
}

/// `sessions.json` 의 읽기 전용 시선. `index::read_sessions_sync` 와 같은
/// 파일을 보지만 저쪽은 워크데이 하나 + `WorkdayResolver` 를 요구한다 —
/// 판정은 워크데이를 미리 모르므로 인덱스 폴더를 훑는다.
#[derive(Deserialize)]
struct SessionsFileView {
    #[serde(default)]
    sessions: Vec<Session>,
}

fn workday_sessions(root: &Path) -> Vec<WorkdaySession> {
    let index = root.join(".oculpm").join("index");
    let Ok(rd) = std::fs::read_dir(&index) else {
        return Vec::new();
    };
    let mut dirs: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    // 워크데이 폴더 이름은 `YYYYMMDD` — 사전순이 곧 시간순이다. 최근 며칠이면
    // 충분하고, 오래된 세션은 어차피 지금 열려 있지 않다.
    dirs.sort();
    dirs.reverse();
    dirs.truncate(3);

    let mut out = Vec::new();
    for d in dirs {
        let Ok(text) = std::fs::read_to_string(index.join(&d).join("sessions.json")) else {
            continue;
        };
        let Ok(file) = serde_json::from_str::<SessionsFileView>(&text) else {
            continue;
        };
        for s in file.sessions {
            let Some(started_at) = parse_ts(&s.started_at) else {
                continue;
            };
            out.push(WorkdaySession {
                id: s.id,
                agent_sessions: s.agent_sessions,
                started_at,
                ended_at: s.ended_at.as_deref().and_then(parse_ts),
            });
        }
    }
    out
}

fn parse_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.timestamp())
}

/// 최근 일지들이 **자기 입으로 적은 대화 id** 전부.
///
/// 사후 해소 판정(`claude_hooks::journal_missing_signals`)이 쓰는 자리다.
/// 전체 판정([`collect`])과 달리 마커도 워킹트리도 필요 없다 — 신호가 난 지
/// 며칠 지난 대화는 마커가 이미 지워졌고, 그때의 워킹트리는 남아 있지 않다.
/// 물을 수 있는 것은 "그 뒤에 이 대화의 일지가 났는가" 하나뿐이다.
pub fn collect_journal_conversations(
    root: &Path,
    since: i64,
) -> std::collections::BTreeSet<String> {
    journals(root, since)
        .into_iter()
        .filter_map(|j| j.agent_session)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
