//! 디바운서의 파일 id 캐시 — `FileIdMap` 과 같은 답을 **정렬된 지도**로 낸다
//! (`{#fileid-remove-scan}`, 2026-10-24).
//!
//! `notify-debouncer-full` 의 `FileIdMap` 은 `HashMap<PathBuf, FileId>` 이고
//! `remove_path` 가 `retain(|p| !p.starts_with(path))` — **Remove 이벤트 하나마다
//! 캐시 전체를 훑는다.** 캐시는 우리 사전 필터 **앞**이라 Create 된 모든 경로
//! (`target/`·`node_modules/`·`.git/objects`·중첩 worktree 사본)가 쌓이고 Remove
//! 에서만 빠진다. 그래서 파일 N 개를 지우는 일(worktree 하나 걷기, `cargo clean`)이
//! N × 캐시 크기 번의 경로 비교가 된다.
//!
//! 설치본에서 본 것: 샘플러가 잡은 FSEvents 콜백 스레드의 시간이 전부 이 두
//! `retain` (`Path::starts_with` → 성분 파싱 + `memcmp`) 안이었고, 그 스레드는
//! 디바운서 뮤텍스를 쥔 채라 이벤트가 안 나갔다 — 감독관이 그 프로젝트의 워처를
//! 이틀에 두 번 "응답 없음" 으로 끊었다 (중첩 worktree 가 있는 프로젝트,
//! handle_max 13.7 s).
//!
//! `PathBuf` 의 순서는 **성분 단위 사전순**이라 한 경로의 자손은 그 경로 바로 뒤에
//! 빈틈 없이 붙어 있다 (`a/b` < `a/b/…` < `a/b-c`). 그 구간만 걸으면 O(log n + k).
//! 나머지(넣기·찾기·재스캔)는 `FileIdMap` 과 한 줄씩 같다 — 워처는 `add_root` 를
//! 부르지 않으므로 넣기는 깊이 1(경로 자신과 바로 아래), 재스캔은 할 일이 없다.

use std::collections::BTreeMap;
use std::ops::Bound;
use std::path::{Path, PathBuf};

use notify_debouncer_full::file_id::{get_file_id, FileId};
use notify_debouncer_full::FileIdCache;
use walkdir::WalkDir;

#[derive(Default)]
pub(crate) struct OrderedFileIdCache {
    paths: BTreeMap<PathBuf, FileId>,
    /// 채널 앞 판정과 같은 매처 — 그 판정이 어차피 버릴 경로(`target/`·`node_modules/`·
    /// `.git/`)는 파일 id 를 얻지 않는다 (Windows 성능 라운드 2026-11-11). 윈도우에서
    /// `get_file_id` 는 파일마다 핸들을 열고 닫는다 — `cargo build` 한 번이 산출물 수천
    /// 개를 만들 때 그 전부가 디바운서 뮤텍스를 쥔 채 열렸다. 이름 바꾸기 짝짓기는 남는
    /// 경로에서 그대로다 (버린 쪽에서 남는 쪽으로 옮긴 파일은 짝 대신 생성으로 들어온다 —
    /// 소비자가 디스크를 보고 생성으로 가르는 것과 같은 결과).
    keep: Option<crate::oculpm::watcher_queue::PreFilter>,
}

impl OrderedFileIdCache {
    #[cfg(test)]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 사전 필터와 같은 판정으로 넣을 경로를 거르는 캐시.
    pub(crate) fn with_filter(keep: crate::oculpm::watcher_queue::PreFilter) -> Self {
        Self {
            paths: BTreeMap::new(),
            keep: Some(keep),
        }
    }

    fn keeps(&self, path: &Path) -> bool {
        self.keep.as_ref().is_none_or(|f| f.keeps(path))
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.paths.len()
    }
}

impl FileIdCache for OrderedFileIdCache {
    fn cached_file_id(&self, path: &Path) -> Option<&FileId> {
        self.paths.get(path)
    }

    fn add_path(&mut self, path: &Path) {
        // 사전 필터가 버릴 경로는 열지도 걷지도 않는다 (위 `keep`).
        if !self.keeps(path) {
            return;
        }
        // `FileIdMap::add_path` 와 같다 — 등록된 루트가 없으면 비재귀(깊이 1).
        let entries: Vec<(PathBuf, FileId)> = WalkDir::new(path)
            .follow_links(true)
            .max_depth(1)
            .into_iter()
            .filter_map(|entry| {
                let path = entry.ok()?.into_path();
                if !self.keeps(&path) {
                    return None;
                }
                let file_id = get_file_id(&path).ok()?;
                Some((path, file_id))
            })
            .collect();
        self.paths.extend(entries);
    }

    fn remove_path(&mut self, path: &Path) {
        let doomed: Vec<PathBuf> = self
            .paths
            .range::<Path, _>((Bound::Included(path), Bound::Unbounded))
            .map(|(p, _)| p)
            .take_while(|p| p.starts_with(path))
            .cloned()
            .collect();
        for p in doomed {
            self.paths.remove(&p);
        }
    }

    fn rescan(&mut self) {
        // `FileIdMap::rescan` 은 등록된 루트만 다시 넣는다 — 워처는 루트를 등록하지
        // 않으므로 그쪽도 아무것도 안 한다.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::FileIdMap;

    fn tree(n_dirs: usize, per_dir: usize) -> (tempfile::TempDir, Vec<PathBuf>, Vec<PathBuf>) {
        let tmp = tempfile::tempdir().unwrap();
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for d in 0..n_dirs {
            let dir = tmp.path().join(format!("wt/c{d}/src"));
            std::fs::create_dir_all(&dir).unwrap();
            dirs.push(dir.clone());
            for f in 0..per_dir {
                let file = dir.join(format!("f{f}.ts"));
                std::fs::write(&file, b"x").unwrap();
                files.push(file);
            }
        }
        (tmp, dirs, files)
    }

    fn snapshot_ordered(c: &OrderedFileIdCache, probe: &[PathBuf]) -> Vec<Option<FileId>> {
        probe.iter().map(|p| c.cached_file_id(p).copied()).collect()
    }

    fn snapshot_map(c: &FileIdMap, probe: &[PathBuf]) -> Vec<Option<FileId>> {
        probe.iter().map(|p| c.cached_file_id(p).copied()).collect()
    }

    /// 같은 넣기·빼기 순서에 `FileIdMap` 과 같은 답 — 이웃 이름(`c1` 과 `c10`,
    /// `src` 와 `src-old`)이 자손으로 잘못 걷히지 않는 것까지.
    #[test]
    fn answers_like_file_id_map() {
        let (tmp, dirs, files) = tree(12, 5);
        let sibling = tmp.path().join("wt/c1/src-old.ts");
        std::fs::write(&sibling, b"y").unwrap();
        let mut probe: Vec<PathBuf> = files.clone();
        probe.extend(dirs.iter().cloned());
        probe.push(sibling.clone());
        probe.push(tmp.path().join("wt/c1"));

        let mut ours = OrderedFileIdCache::new();
        let mut theirs = FileIdMap::new();
        // Create 이벤트처럼: 폴더(깊이 1 로 자식까지)와 파일을 하나씩.
        for p in dirs.iter().chain(files.iter()).chain([&sibling]) {
            ours.add_path(p);
            theirs.add_path(p);
        }
        assert_eq!(
            snapshot_ordered(&ours, &probe),
            snapshot_map(&theirs, &probe)
        );
        assert!(snapshot_ordered(&ours, &probe).iter().any(Option::is_some));

        // 폴더 하나 통째로, 파일 하나, 없는 경로, 이웃 이름의 접두사.
        for gone in [
            tmp.path().join("wt/c1/src"),
            files[30].clone(),
            tmp.path().join("nope"),
            tmp.path().join("wt/c1"),
        ] {
            ours.remove_path(&gone);
            theirs.remove_path(&gone);
            assert_eq!(
                snapshot_ordered(&ours, &probe),
                snapshot_map(&theirs, &probe),
                "remove {gone:?}"
            );
        }
        // `wt/c1` 을 걷어도 `wt/c10`·`wt/c11` 은 남는다.
        assert!(ours
            .cached_file_id(&tmp.path().join("wt/c10/src/f0.ts"))
            .is_some());
        assert!(ours.cached_file_id(&sibling).is_none());
    }

    /// 사전 필터가 버릴 경로(`target/` 아래)는 캐시에 들지 않고, 남는 경로는 그대로 든다.
    #[test]
    fn paths_the_prefilter_drops_get_no_file_id() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        std::fs::create_dir_all(root.join("target/debug")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        let junk = root.join("target/debug/a.o");
        let kept = root.join("src/a.rs");
        std::fs::write(&junk, b"x").unwrap();
        std::fs::write(&kept, b"x").unwrap();
        let ignore = crate::oculpm::watcher_queue::build_gitignore_from_lines(
            &root,
            &["target/".to_string()],
        );
        let filter = crate::oculpm::watcher_queue::PreFilter::new(
            root.clone(),
            ignore,
            crate::oculpm::watcher_queue::ProjectGitignore::none(),
        );
        let mut c = OrderedFileIdCache::with_filter(filter);
        c.add_path(&junk);
        c.add_path(&root.join("target"));
        c.add_path(&kept);
        assert!(c.cached_file_id(&junk).is_none());
        assert!(c.cached_file_id(&root.join("target/debug")).is_none());
        assert!(c.cached_file_id(&kept).is_some());
        // 남는 폴더를 깊이 1 로 넣으면 자식이 들고, 버릴 폴더의 자식은 들지 않는다.
        // (`target/` 같은 폴더 전용 규칙은 폴더 자신을 파일로 보면 안 맞는다 — 사전 필터와
        // 같은 판정이라 그 한 칸은 든다.)
        c.add_path(&root.join("src"));
        assert!(c.cached_file_id(&root.join("src")).is_some());
        c.add_path(&root.join("target/debug"));
        assert!(c.cached_file_id(&junk).is_none());
    }

    /// `{#fileid-remove-scan}` 측정 — 캐시에 파일 `N` 개가 든 채 그중 한 폴더
    /// (`K` 개)를 파일마다 Remove 할 때 걸리는 시간. 디버그 빌드로도 차이가 난다
    /// (`Path::starts_with` 는 미리 최적화된 std 안에 있다).
    ///
    /// ```text
    /// OCULPM_FID_N=60000 OCULPM_FID_K=3000 cargo test --lib fileid_remove_cost -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "측정 전용"]
    fn fileid_remove_cost() {
        let n: usize = std::env::var("OCULPM_FID_N")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_000);
        let k: usize = std::env::var("OCULPM_FID_K")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3_000);
        let per_dir = k;
        let (_tmp, dirs, files) = tree(n / per_dir, per_dir);
        let victims: Vec<PathBuf> = files
            .iter()
            .filter(|f| f.starts_with(&dirs[0]))
            .cloned()
            .collect();

        let mut ours = OrderedFileIdCache::new();
        let mut theirs = FileIdMap::new();
        for f in &files {
            ours.add_path(f);
            theirs.add_path(f);
        }
        let t = std::time::Instant::now();
        for v in &victims {
            theirs.remove_path(v);
        }
        let map_ms = t.elapsed().as_secs_f64() * 1e3;
        let t = std::time::Instant::now();
        for v in &victims {
            ours.remove_path(v);
        }
        let ord_ms = t.elapsed().as_secs_f64() * 1e3;
        assert_eq!(ours.len(), files.len() - victims.len());
        println!(
            "\n== fileid remove — 캐시 {} 개 중 {} 개를 하나씩 Remove ==\n  FileIdMap {map_ms:.1} ms · OrderedFileIdCache {ord_ms:.1} ms",
            files.len(),
            victims.len()
        );
    }
}
