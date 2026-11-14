//! 「남은 파일」 — 일지가 건드린 파일이 지금 프로젝트에 있는가 (11-14).
//!
//! 일지는 지우지 않으니 쌓인다. 이 저장소 실측(1,030건): 건드린 파일이 하나도 남지 않은
//! 일지가 86건, 절반 이상 사라진 것까지 치면 41% 다. 그런 일지가 지금 코드에 대한 일지와
//! 같은 얼굴로 검색에 섞이면, 읽는 쪽(사람도 에이전트도)은 사라진 코드의 사정을 지금의
//! 사실로 읽는다.
//!
//! 판정은 **파일이 있는가** 하나다 — LLM 0 · git 실행 0 · 네트워크 0. 그래서 거칠다:
//! 이름만 바뀐 파일도 「없다」로 센다. 지우는 근거로는 못 쓰고, 뒤로 보내는 근거로만 쓴다.
//!
//! 「이후 같은 파일을 건드린 일지 수」는 넣지 않았다. 같은 날 재 보니 중앙값이 49건이었다
//! (`lib.rs` 같은 허브 파일 탓) — 거의 모든 일지에 큰 수가 붙어 아무것도 가르지 못한다.

use std::collections::HashMap;
use std::path::Path;

use super::{Scored, SearchRow};
use crate::oculpm::planner::stale::inside_project;

/// 한 일지의 「남은 파일 / 셀 파일」.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Alive {
    pub alive: usize,
    /// 셈에 든 파일 수 — 프로젝트 안 · 기록 폴더 밖 · 지우거나 옮긴 것이 아닌 것.
    pub of: usize,
}

impl Alive {
    /// 건드린 파일이 하나도 남지 않았다. 셀 파일이 없는 일지는 모르는 것이라 `false` —
    /// 모르는 것을 낡았다고 하지 않는다 (`planner::stale` 과 같은 원칙).
    pub fn gone(&self) -> bool {
        self.of > 0 && self.alive == 0
    }

    /// 응답 한 칸 — `2/5`, 셀 파일이 없으면 `-`.
    pub fn cell(&self) -> String {
        if self.of == 0 {
            "-".to_string()
        } else {
            format!("{}/{}", self.alive, self.of)
        }
    }
}

/// 한 번의 검색 동안 같은 경로를 두 번 묻지 않는다 (`lib.rs` 는 일지 수백 건에 나온다).
pub struct AliveCheck<'a> {
    root: &'a Path,
    seen: HashMap<String, bool>,
}

impl<'a> AliveCheck<'a> {
    pub fn new(root: &'a Path) -> Self {
        Self {
            root,
            seen: HashMap::new(),
        }
    }

    pub fn of(&mut self, row: &SearchRow) -> Alive {
        self.count(&row.files, &row.files_dropped)
    }

    /// `files` 는 일지가 건드린 경로 전부, `dropped` 는 그중 지우거나 옮긴 것.
    pub fn count(&mut self, files: &[String], dropped: &[String]) -> Alive {
        // 윈도우에서 쓴 일지의 `\` 를 편다 — 두 기기를 오가는 저장소에서 같은 파일이다.
        let norm = |p: &str| p.replace('\\', "/");
        let dropped: Vec<String> = dropped.iter().map(|p| norm(p)).collect();
        let mut counted: Vec<String> = files
            .iter()
            .map(|p| norm(p))
            // 지우거나 옮긴 파일은 없는 것이 정상이다. 「걷어냈다」는 일지는 결정의 기록이라
            // 그 파일이 없다는 이유로 낡았다고 하면 거꾸로다.
            .filter(|p| inside_project(p) && !dropped.contains(p))
            .collect();
        counted.sort_unstable();
        counted.dedup();
        let mut alive = 0;
        for p in &counted {
            let root = self.root;
            let exists = *self
                .seen
                .entry(p.clone())
                // 링크를 따라가지 않는다 — 프로젝트 밖을 가리키는 링크의 생사는 우리 일이 아니다.
                .or_insert_with(|| std::fs::symlink_metadata(root.join(p)).is_ok());
            if exists {
                alive += 1;
            }
        }
        Alive {
            alive,
            of: counted.len(),
        }
    }
}

/// 랭킹 결과에 「남은 파일」을 붙이고, 하나도 안 남은 일지를 뒤로 보낸다. 두 무리 안의
/// 순서는 [`super::rank`] 가 정한 그대로다. 전부가 그런 일지면(걷어낸 기능을 찾는 중)
/// 순서를 건드리지 않는다. 돌려주는 수는 뒤로 간 건수.
///
/// 화면(`commands::journal_search`)과 에이전트(`mcp::tools::search`)가 이 한 함수를 부른다 —
/// 같은 질의에 다른 순서를 주지 않으려는 것이다.
pub fn gone_last(root: &Path, scored: Vec<Scored>) -> (Vec<(Scored, Alive)>, usize) {
    let mut check = AliveCheck::new(root);
    let mut hits: Vec<(Scored, Alive)> = scored
        .into_iter()
        .map(|s| {
            let a = check.of(&s.row);
            (s, a)
        })
        .collect();
    let gone = hits.iter().filter(|(_, a)| a.gone()).count();
    if gone == 0 || gone == hits.len() {
        return (hits, 0);
    }
    // 안정 정렬 — false(남음) 가 앞, 무리 안의 순서는 그대로.
    hits.sort_by_key(|(_, a)| a.gone());
    (hits, gone)
}

/// 건드린 파일이 하나도 남지 않은 일지의 경로 (정렬) — 일지 화면이 접는 것.
/// `touches` 는 `(일지 경로, 건드린 파일, op)` 전부 ([`super::cache::fetch_touches`]).
pub fn gone_entries(root: &Path, touches: Vec<(String, String, String)>) -> Vec<String> {
    let mut by_entry: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
    for (rel, path, op) in touches {
        let slot = by_entry.entry(rel).or_default();
        if super::cache::is_dropped_op(&op) {
            slot.1.push(path.clone());
        }
        slot.0.push(path);
    }
    let mut check = AliveCheck::new(root);
    let mut out: Vec<String> = by_entry
        .into_iter()
        .filter(|(_, (files, dropped))| check.count(files, dropped).gone())
        .map(|(rel, _)| rel)
        .collect();
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(rel: &str, path: &str, op: &str) -> (String, String, String) {
        (rel.to_string(), path.to_string(), op.to_string())
    }

    #[test]
    fn only_entries_with_nothing_left_are_gone() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/kept.rs"), "x").unwrap();
        let gone = gone_entries(
            dir.path(),
            vec![
                touch("d/b_gone.md", "src/old.rs", "update"),
                touch("d/a_gone.md", "src/older.rs", "create"),
                touch("d/partly.md", "src/kept.rs", "update"),
                touch("d/partly.md", "src/old.rs", "update"),
                // 지운 파일뿐인 일지는 셀 것이 없다 — 모르는 것을 낡았다고 하지 않는다.
                touch("d/removal.md", "src/tray.rs", "delete"),
                touch("d/outside.md", "../x.rs", "update"),
            ],
        );
        assert_eq!(gone, vec!["d/a_gone.md", "d/b_gone.md"]);
    }
}
