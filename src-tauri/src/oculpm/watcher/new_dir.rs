//! 새 폴더 따라잡기 — 리눅스(inotify)에서 이벤트 없이 채워진 새 폴더의 파일을 찾는다.

use std::path::{Path, PathBuf};

/// 새로 생긴 폴더를 **이벤트 없이 채워진 채로** 받는 OS 인가 — 리눅스(inotify).
///
/// inotify 는 폴더마다 감시를 따로 건다. 새 폴더의 생성 이벤트를 받은 notify 가 그
/// 폴더에 감시를 걸기 **전에** 안에서 만들어진 파일은 아무 이벤트도 내지 않는다.
/// 사이드카 일지 쓰기(`create_dir_all(날짜/종류)` → 임시 파일 → 링크 게시)가 정확히
/// 이 모양이라, 오늘 첫 일지가 화면에 안 떴다 — E2E(ubuntu) 가 10-10 부터 간헐로
/// 붉었고 v3.13.6 은 그 때문에 리눅스 판이 빠졌다. 같은 판의 notify 로 리눅스
/// 컨테이너에서 200건을 재면 70~87% 를 놓치고, 새 폴더를 훑으면 0 이다 (2026-10-24).
/// macOS(FSEvents)·윈도우(ReadDirectoryChangesW)는 하위 트리를 한 번에 보므로 없다.
pub(super) fn backfills_new_dirs() -> bool {
    cfg!(target_os = "linux")
}

/// 새 폴더 하나에서 따라잡을 파일 수의 상한 — 큰 트리가 통째로 생겨도(체크아웃·복사)
/// 처리 루프를 오래 붙들지 않게. 그런 트리는 그 뒤의 변경 이벤트가 따라잡는다.
pub(super) const NEW_DIR_BACKFILL_CAP: usize = 2_000;

/// `dir` 아래의 파일을 깊이 우선으로 최대 `cap` 개 모은다 — 심볼릭 링크는 따라가지
/// 않는다(밖으로 새거나 고리를 돈다). 읽지 못한 폴더는 조용히 건너뛴다.
pub(super) fn files_in_new_dir(dir: &Path, cap: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file() {
                out.push(entry.path());
                if out.len() >= cap {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 깊이와 상관없이 파일만 모으고, 상한에서 멈추고, 심볼릭 링크는 따라가지 않는다.
    #[test]
    fn collects_files_depth_first_up_to_the_cap_without_following_links() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("20261024");
        std::fs::create_dir_all(root.join("Chores/deep")).unwrap();
        std::fs::write(root.join("Chores/a.md"), b"a").unwrap();
        std::fs::write(root.join("Chores/deep/b.md"), b"b").unwrap();
        std::fs::write(root.join("c.md"), b"c").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(tmp.path(), root.join("loop")).unwrap();

        let mut got = files_in_new_dir(&root, 100);
        got.sort();
        let mut want = vec![
            root.join("Chores/a.md"),
            root.join("Chores/deep/b.md"),
            root.join("c.md"),
        ];
        want.sort();
        assert_eq!(got, want);
        assert_eq!(files_in_new_dir(&root, 2).len(), 2, "상한에서 멈춘다");
        assert!(files_in_new_dir(&tmp.path().join("nope"), 10).is_empty());
    }
}
