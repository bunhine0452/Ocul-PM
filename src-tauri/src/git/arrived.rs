//! 「받아 온 것」 (2026-11-13, 플랜 `two-machines-20261113` `{#arrival}` · `{#synced}`).
//!
//! 다른 기기에서 일하고 이 기기로 돌아오면 두 가지를 모른다 — 방금 받아 온 것 안에 어떤 일이 들어
//! 있는지, 그리고 받아 온 지가 얼마나 됐는지. 둘 다 git 이 이미 적어 둔다: 리모트 가지의 reflog
//! (`logs/refs/remotes/<리모트>/<가지>`)는 그 가지가 움직인 때마다 한 줄이고, 줄의 메시지가 이 기기가
//! 올린 것(`update by push`)인지 받아 온 것인지를 가른다.
//!
//! **받아 오지 않는다.** reflog 와 `FETCH_HEAD` 의 수정 시각은 파일로 읽고(git 0번), 받아 온 구간이
//! 있을 때만 그 구간이 더한 일지를 `git log` 로 묻는다 — 구간이 그대로면 지난 답을 쓴다.
//!
//! **이 기기에서 만든 커밋은 뺀다.** 가지를 올려 PR 로 합치고 다시 받으면, 내가 여기서 쓴 일지도
//! 「받아 온 구간」 에 들어 있다. HEAD 의 reflog 가 이 기기에서 만든 커밋(`commit: …`)을 적어 두므로,
//! 받아 온 커밋의 oid 나 작성 시각이 거기 있으면 여기서 한 일이다 — 리베이스 머지는 oid 를 바꾸지만
//! 작성 시각은 그대로 둔다. 스쿼시 머지는 작성 시각까지 새로 써서 가리지 못한다(받아 온 것으로 센다).
//! 지금 가지와 이름이 같은 리모트 가지만 본다. 떨어진 HEAD · reftable 저장소는 모른다고 답한다(`None`).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::head::{dot_git_for, git_dirs, is_oid, read_head, GitDirs, Head};
use super::race::run;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct Arrived {
    /// `since` 뒤에 받아 온 커밋이 더한 일지 — 지금 작업 트리에 있는 것만. 일지 루트 기준
    /// (`20261113/Bugs/…md`), 최신 경로가 먼저.
    pub journals: Vec<String>,
    /// 리모트와 마지막으로 주고받은 때(받아 오기 · 올리기), epoch 초. 다른 곳에서 쓴 일지를 받은
    /// 흔적이 없는 저장소면 `None` — 혼자 한 기기에서 쓰는 저장소에 「주고받은 지 N일」 을 말하지 않는다.
    pub synced_at: Option<u32>,
}

/// reflog 한 줄 — `<옛 oid> <새 oid> <이름> <메일> <epoch> <tz>\t<메시지>`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Move {
    old: String,
    new: String,
    at: u32,
    msg: String,
}

impl Move {
    /// 다른 곳에서 온 커밋으로 움직였다 — 이 기기가 올린 것도, 가지가 처음 생긴 것도 아니다.
    fn incoming(&self) -> bool {
        let born = self.old.bytes().all(|b| b == b'0');
        !born && self.old != self.new && !self.msg.starts_with("update by push")
    }
}

fn parse_reflog(text: &str) -> Vec<Move> {
    text.lines()
        .filter_map(|line| {
            let (head, msg) = line.split_once('\t').unwrap_or((line, ""));
            let mut front = head.split(' ');
            let (old, new) = (front.next()?, front.next()?);
            // 이름에는 빈칸이 있을 수 있다 — 시각은 뒤에서 센다.
            let mut back = head.rsplit(' ');
            let _tz = back.next()?;
            let at = back.next()?.parse().ok()?;
            if !is_oid(old) || !is_oid(new) {
                return None;
            }
            Some(Move {
                old: old.to_string(),
                new: new.to_string(),
                at,
                msg: msg.to_string(),
            })
        })
        .collect()
}

/// 지금 가지와 이름이 같은 리모트 가지들의 reflog — 리모트가 여럿이면 전부.
fn remote_moves(dirs: &GitDirs, branch: &str) -> Vec<Move> {
    let logs = dirs.common_dir.join("logs").join("refs").join("remotes");
    let Ok(remotes) = std::fs::read_dir(logs) else {
        return Vec::new();
    };
    let mut moves: Vec<Move> = remotes
        .flatten()
        .filter_map(|r| std::fs::read_to_string(r.path().join(branch)).ok())
        .flat_map(|text| parse_reflog(&text))
        .collect();
    moves.sort_by_key(|m| m.at);
    moves
}

fn mtime_secs(p: PathBuf) -> Option<u32> {
    let at = std::fs::metadata(p).ok()?.modified().ok()?;
    u32::try_from(at.duration_since(UNIX_EPOCH).ok()?.as_secs()).ok()
}

/// 이 기기에서 만든 커밋 — 모든 워크트리의 HEAD reflog 에서 `commit…` 줄의 새 oid 와 그 시각.
#[derive(Default)]
struct Mine {
    oids: HashSet<String>,
    times: BTreeSet<u32>,
}

impl Mine {
    fn read(dirs: &GitDirs) -> Self {
        let mut logs = vec![
            dirs.git_dir.join("logs").join("HEAD"),
            dirs.common_dir.join("logs").join("HEAD"),
        ];
        if let Ok(trees) = std::fs::read_dir(dirs.common_dir.join("worktrees")) {
            logs.extend(trees.flatten().map(|t| t.path().join("logs").join("HEAD")));
        }
        let mut mine = Mine::default();
        for text in logs.iter().filter_map(|p| std::fs::read_to_string(p).ok()) {
            for m in parse_reflog(&text) {
                if m.msg.starts_with("commit") {
                    mine.times.insert(m.at);
                    mine.oids.insert(m.new);
                }
            }
        }
        mine
    }

    /// 작성 시각은 reflog 의 시각과 같은 순간에 찍힌다 — 초가 넘어가는 경계만 봐준다.
    fn made(&self, oid: &str, authored: u32) -> bool {
        self.oids.contains(oid)
            || self
                .times
                .range(authored.saturating_sub(2)..=authored.saturating_add(2))
                .next()
                .is_some()
    }
}

/// `git log --format=@@<oid>\t<작성 시각>` + `--name-only` 출력에서, `mine` 이 만들지 않은 커밋이 더한
/// 일지 경로(`.oculpm/journal/` 뒤).
fn foreign_journals(out: &str, mine: &Mine) -> Vec<String> {
    let mut found = Vec::new();
    let mut foreign = false;
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("@@") {
            let (oid, at) = head.split_once('\t').unwrap_or((head, ""));
            foreign = !mine.made(oid, at.trim().parse().unwrap_or(0));
        } else if let Some(rel) = line.trim().strip_prefix(".oculpm/journal/") {
            if foreign && rel.ends_with(".md") {
                found.push(rel.to_string());
            }
        }
    }
    found
}

/// `old..new` 에서 다른 곳의 커밋이 더한 일지. `slot` 은 기억해 둘 자리 이름 — 구간이 그대로면 git 을
/// 다시 띄우지 않는다(오늘 화면이 창에 돌아올 때마다 부른다).
fn foreign_added(
    root: &Path,
    dirs: &GitDirs,
    slot: &'static str,
    old: &str,
    new: &str,
) -> BTreeSet<String> {
    type Memo = HashMap<(PathBuf, &'static str), (String, BTreeSet<String>)>;
    static MEMO: LazyLock<Mutex<Memo>> = LazyLock::new(Default::default);
    let range = format!("{old}..{new}");
    let key = (root.to_path_buf(), slot);
    if let Some((seen, hit)) = MEMO.lock().ok().and_then(|m| m.get(&key).cloned()) {
        if seen == range {
            return hit;
        }
    }
    // `log` 가 맨 앞이어야 `safe::cmd` 가 외부 diff 를 끈다. `--relative` 는 프로젝트가 저장소의 하위
    // 폴더일 때 경로를 프로젝트 기준으로 돌려준다. 옛 커밋이 gc 로 사라졌으면 모른다 — 빈 답.
    let found: BTreeSet<String> = run(
        root,
        &[
            "log",
            "--diff-filter=A",
            "--name-only",
            "--relative",
            "--format=@@%H%x09%at",
            &range,
            "--",
            ".oculpm/journal",
        ],
    )
    .map(|out| {
        foreign_journals(&out, &Mine::read(dirs))
            .into_iter()
            .collect()
    })
    .unwrap_or_default();
    if let Ok(mut m) = MEMO.lock() {
        m.insert(key, (range, found.clone()));
    }
    found
}

/// 「다른 곳에서도 이 저장소에 기록한다」 를 가늠할 때 돌아보는 받아 온 횟수.
const RECENT: usize = 12;

/// `since`(epoch 초) 뒤에 받아 온 일지와, 리모트와 마지막으로 주고받은 때.
/// git 저장소가 아니거나 가지 위가 아니면 `None`.
pub fn arrived(root: &Path, since: u32) -> Option<Arrived> {
    let dirs = git_dirs(&dot_git_for(root)?)?;
    let Head::Branch { name, .. } = read_head(&dirs)? else {
        return None;
    };
    let moves = remote_moves(&dirs, &name);
    let incoming: Vec<&Move> = moves.iter().filter(|m| m.incoming()).collect();
    let (Some(first), Some(last)) = (
        incoming.get(incoming.len().saturating_sub(RECENT)),
        incoming.last(),
    ) else {
        return Some(Arrived::default());
    };

    // 오늘 받아 온 구간 — 그 사이에 이 기기가 올린 커밋이 끼어 있어도 `foreign_added` 가 뺀다.
    let journal_root = root.join(".oculpm").join("journal");
    let journals: Vec<String> = match incoming.iter().find(|m| m.at >= since) {
        // 받아 왔지만 아직 이 가지에 합치지 않은 일지는 작업 트리에 없다 — 없는 것을 왔다고 하지 않는다.
        Some(today) => foreign_added(root, &dirs, "today", &today.old, &last.new)
            .into_iter()
            .rev()
            .filter(|rel| journal_root.join(rel).is_file())
            .collect(),
        None => Vec::new(),
    };

    // 「주고받은 지 N일」 은 다른 곳의 기록을 받은 적이 있는 저장소에만 — 혼자 한 기기에서 쓰거나
    // 내 PR 을 합쳐 받기만 하는 저장소에는 말하지 않는다.
    let shared = !journals.is_empty()
        || !foreign_added(root, &dirs, "recent", &first.old, &last.new).is_empty();
    let synced_at = shared
        .then(|| {
            [
                moves.last().map(|m| m.at),
                mtime_secs(dirs.git_dir.join("FETCH_HEAD")),
                mtime_secs(dirs.common_dir.join("FETCH_HEAD")),
            ]
            .into_iter()
            .flatten()
            .max()
        })
        .flatten();
    Some(Arrived {
        journals,
        synced_at,
    })
}

#[cfg(test)]
#[path = "arrived_tests.rs"]
mod tests;
