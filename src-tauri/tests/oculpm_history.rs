//! 로컬 히스토리 (B5) 통합 — 디스크에 실제로 무엇이 남는가.
//!
//! 보존 판단 자체(병합·캡·예산)는 `oculpm::history` 의 순수 단위 테스트가
//! 덮는다. 여기서는 그 판단이 **파일**로 옳게 번역되는지를 본다: meta 한 장과
//! 스냅샷 한 장이 생기는가, 밀려난 판의 스냅샷이 정말 지워지는가, 이름을
//! 바꾸면 판이 따라오는가.

use std::path::Path;

use ocul_pm_lib::oculpm::history::{
    self, CaptureOutcome, HistoryOp, HistorySource, DEFAULT_MAX_ENTRIES,
};

fn snaps(root: &Path, rel: &str) -> Vec<String> {
    let dir = history::dir_for(root, rel);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = rd
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".snap"))
        .collect();
    out.sort();
    out
}

fn write(root: &Path, rel: &str, body: &str) {
    let full = root.join(rel);
    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
    std::fs::write(full, body).unwrap();
}

fn capture(root: &Path, rel: &str, source: HistorySource, max: usize) -> CaptureOutcome {
    history::capture(root, rel, HistoryOp::Update, source, None, max).unwrap()
}

#[test]
fn one_capture_leaves_one_meta_and_one_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "src/main.rs", "fn main() {}\n");

    let out = history::capture(
        root,
        "src/main.rs",
        HistoryOp::Create,
        HistorySource::Agent,
        None,
        DEFAULT_MAX_ENTRIES,
    )
    .unwrap();
    assert_eq!(out, CaptureOutcome::Captured);

    assert!(history::dir_for(root, "src/main.rs")
        .join("meta.json")
        .is_file());
    assert_eq!(snaps(root, "src/main.rs").len(), 1);

    let list = history::list(root, "src/main.rs");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].op, HistoryOp::Create);
    assert_eq!(list[0].source, HistorySource::Agent);
    assert_eq!(list[0].bytes, 13);

    let restored = history::read_snapshot(root, "src/main.rs", list[0].ts_ms).unwrap();
    assert_eq!(String::from_utf8(restored).unwrap(), "fn main() {}\n");
}

#[test]
fn the_same_content_is_never_captured_twice() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "a.ts", "const a = 1;\n");

    assert_eq!(
        capture(root, "a.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES),
        CaptureOutcome::Captured
    );
    // 내용이 그대로면 이벤트가 몇 번 오든 판은 하나다 (워처는 한 번의 저장에
    // 여러 이벤트를 내는 파일 시스템 위에서 돈다).
    assert_eq!(
        capture(root, "a.ts", HistorySource::User, DEFAULT_MAX_ENTRIES),
        CaptureOutcome::Skipped
    );
    assert_eq!(history::list(root, "a.ts").len(), 1);
    assert_eq!(snaps(root, "a.ts").len(), 1);
}

#[test]
fn the_same_hand_in_quick_succession_merges_but_a_different_hand_does_not() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    write(root, "a.ts", "v1\n");
    capture(root, "a.ts", HistorySource::User, DEFAULT_MAX_ENTRIES);
    write(root, "a.ts", "v2\n");
    capture(root, "a.ts", HistorySource::User, DEFAULT_MAX_ENTRIES);

    // 자동 저장이 켜지면 사람 저장은 초 단위로 쌓인다 — 병합 창이 그걸 접는다.
    assert_eq!(history::list(root, "a.ts").len(), 1);
    assert_eq!(
        snaps(root, "a.ts").len(),
        1,
        "교체된 판의 스냅샷은 지워진다"
    );

    write(root, "a.ts", "v3\n");
    capture(root, "a.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES);

    // 내 저장 직후의 에이전트 쓰기는 절대 병합하지 않는다 — 그 경계가 바로
    // 사용자가 보고 싶어 하는 지점이다.
    let list = history::list(root, "a.ts");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].source, HistorySource::Agent, "최신순");
    assert_eq!(list[1].source, HistorySource::User);
    assert_eq!(snaps(root, "a.ts").len(), 2);
}

#[test]
fn the_cap_drops_the_oldest_version_and_its_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // source 를 번갈아 병합을 피한다 (같은 손이면 10초 창에서 접힌다).
    for (i, source) in [
        HistorySource::User,
        HistorySource::Agent,
        HistorySource::User,
    ]
    .into_iter()
    .enumerate()
    {
        write(root, "a.ts", &format!("v{i}\n"));
        capture(root, "a.ts", source, 2);
    }

    let list = history::list(root, "a.ts");
    assert_eq!(list.len(), 2);
    assert_eq!(
        snaps(root, "a.ts").len(),
        2,
        "밀려난 판의 스냅샷도 사라진다"
    );
    assert_eq!(
        String::from_utf8(history::read_snapshot(root, "a.ts", list[0].ts_ms).unwrap()).unwrap(),
        "v2\n"
    );
}

#[test]
fn oversized_and_binary_and_secret_files_are_never_captured() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    write(root, "big.txt", &"x".repeat(300 * 1024));
    assert_eq!(
        capture(root, "big.txt", HistorySource::Agent, DEFAULT_MAX_ENTRIES),
        CaptureOutcome::Skipped
    );

    std::fs::write(root.join("logo.png"), [0x89, 0x50, 0x00, 0x01]).unwrap();
    assert_eq!(
        capture(root, "logo.png", HistorySource::Agent, DEFAULT_MAX_ENTRIES),
        CaptureOutcome::Skipped
    );

    write(root, ".env", "SECRET=1\n");
    assert_eq!(
        capture(root, ".env", HistorySource::Agent, DEFAULT_MAX_ENTRIES),
        CaptureOutcome::Skipped
    );

    assert!(history::list(root, "big.txt").is_empty());
    assert!(history::list(root, "logo.png").is_empty());
    assert!(history::list(root, ".env").is_empty());
}

#[test]
fn versions_follow_a_rename_including_a_whole_directory() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    write(root, "old/a.ts", "v1\n");
    capture(root, "old/a.ts", HistorySource::User, DEFAULT_MAX_ENTRIES);

    history::rename(root, "old/a.ts", "old/b.ts").unwrap();
    assert!(history::list(root, "old/a.ts").is_empty());
    let moved = history::list(root, "old/b.ts");
    assert_eq!(moved.len(), 1);
    assert_eq!(
        String::from_utf8(history::read_snapshot(root, "old/b.ts", moved[0].ts_ms).unwrap())
            .unwrap(),
        "v1\n"
    );

    // 폴더 이름 바꾸기 — meta 에 경로가 적혀 있어 아래 파일이 전부 따라온다.
    history::rename(root, "old", "neo").unwrap();
    assert_eq!(history::list(root, "neo/b.ts").len(), 1);
    assert!(history::list(root, "old/b.ts").is_empty());
}

#[test]
fn deleting_the_file_keeps_its_versions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "gone.ts", "the only copy\n");
    capture(root, "gone.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES);

    std::fs::remove_file(root.join("gone.ts")).unwrap();

    // 지운 파일의 내용을 되찾는 것이 이 기능의 가장 좋은 순간이다.
    let list = history::list(root, "gone.ts");
    assert_eq!(list.len(), 1);
    assert_eq!(
        String::from_utf8(history::read_snapshot(root, "gone.ts", list[0].ts_ms).unwrap()).unwrap(),
        "the only copy\n"
    );
}

#[test]
fn forget_and_clear_and_usage() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "a.ts", "aaaa\n");
    write(root, "b.ts", "bbbb\n");
    capture(root, "a.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES);
    capture(root, "b.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES);

    assert!(history::usage_bytes(root) > 10, "meta + snap 을 함께 센다");

    history::forget(root, "a.ts").unwrap();
    assert!(history::list(root, "a.ts").is_empty());
    assert_eq!(history::list(root, "b.ts").len(), 1);

    history::clear_all(root).unwrap();
    assert!(history::list(root, "b.ts").is_empty());
    assert_eq!(history::usage_bytes(root), 0);
}

#[test]
fn the_project_budget_evicts_the_oldest_but_leaves_every_file_one_version() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    for (i, source) in [HistorySource::User, HistorySource::Agent]
        .into_iter()
        .enumerate()
    {
        write(root, "a.ts", &format!("{}\n", "a".repeat(100 + i)));
        capture(root, "a.ts", source, DEFAULT_MAX_ENTRIES);
    }
    write(root, "b.ts", &"b".repeat(120));
    capture(root, "b.ts", HistorySource::Agent, DEFAULT_MAX_ENTRIES);

    assert_eq!(history::list(root, "a.ts").len(), 2);
    let freed = history::enforce_budget(root, 150);
    assert!(freed > 0);
    assert_eq!(history::list(root, "a.ts").len(), 1, "최신 한 판은 남는다");
    assert_eq!(history::list(root, "b.ts").len(), 1);
    assert_eq!(snaps(root, "a.ts").len(), 1);
}
