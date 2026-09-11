//! `history.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다.

use super::*;

fn entry(ts_ms: i64, hash: &str, source: HistorySource) -> HistoryEntry {
    HistoryEntry {
        ts_ms,
        hash: hash.to_string(),
        bytes: 10,
        source,
        op: HistoryOp::Update,
    }
}

#[test]
fn key_shards_by_the_first_two_hex_chars() {
    let key = key_for("src/main.rs");
    let dir = dir_for(Path::new("/p"), "src/main.rs");
    assert!(dir.ends_with(format!("{}/{}", &key[..2], &key[..16])));
    assert!(dir.starts_with("/p/.oculpm/index/history"));
}

#[test]
fn same_content_is_never_recorded_twice() {
    let existing = vec![entry(1, "aa", HistorySource::Agent)];
    let decision = decide_capture(
        &existing,
        entry(9_000, "aa", HistorySource::User),
        50,
        MERGE_WINDOW_MS,
    );
    assert_eq!(decision, CaptureDecision::Skip);
}

#[test]
fn max_entries_zero_is_off() {
    let decision = decide_capture(&[], entry(1, "aa", HistorySource::User), 0, MERGE_WINDOW_MS);
    assert_eq!(decision, CaptureDecision::Skip);
}

#[test]
fn the_same_hand_inside_the_merge_window_replaces_the_previous_version() {
    let existing = vec![entry(1_000, "aa", HistorySource::User)];
    let CaptureDecision::Keep { entries, evicted } = decide_capture(
        &existing,
        entry(6_000, "bb", HistorySource::User),
        50,
        MERGE_WINDOW_MS,
    ) else {
        panic!("expected Keep");
    };
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].hash, "bb");
    assert_eq!(evicted.len(), 1);
    assert_eq!(evicted[0].hash, "aa");
}

#[test]
fn a_different_hand_is_never_merged_even_inside_the_window() {
    let existing = vec![entry(1_000, "aa", HistorySource::User)];
    let CaptureDecision::Keep { entries, evicted } = decide_capture(
        &existing,
        entry(1_500, "bb", HistorySource::Agent),
        50,
        MERGE_WINDOW_MS,
    ) else {
        panic!("expected Keep");
    };
    assert_eq!(
        entries.len(),
        2,
        "그 경계가 사용자가 보고 싶어 하는 지점이다"
    );
    assert!(evicted.is_empty());
}

#[test]
fn merging_keeps_the_create_op() {
    let existing = vec![HistoryEntry {
        op: HistoryOp::Create,
        ..entry(1_000, "aa", HistorySource::Agent)
    }];
    let CaptureDecision::Keep { entries, .. } = decide_capture(
        &existing,
        entry(2_000, "bb", HistorySource::Agent),
        50,
        MERGE_WINDOW_MS,
    ) else {
        panic!("expected Keep");
    };
    assert_eq!(entries[0].op, HistoryOp::Create);
}

#[test]
fn the_cap_drops_the_oldest_first() {
    let existing: Vec<HistoryEntry> = (0..3)
        .map(|i| entry(i * 100_000, &format!("h{i}"), HistorySource::Agent))
        .collect();
    let CaptureDecision::Keep { entries, evicted } = decide_capture(
        &existing,
        entry(999_000, "new", HistorySource::Agent),
        3,
        MERGE_WINDOW_MS,
    ) else {
        panic!("expected Keep");
    };
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].hash, "h1");
    assert_eq!(evicted.len(), 1);
    assert_eq!(evicted[0].hash, "h0");
}

#[test]
fn budget_eviction_takes_the_oldest_but_leaves_one_version_per_file() {
    let mut all = Vec::new();
    for (key, ts) in [("a", 1), ("a", 2), ("b", 3), ("b", 4)] {
        all.push((
            key.to_string(),
            HistoryEntry {
                bytes: 100,
                ..entry(ts, &format!("{key}{ts}"), HistorySource::Agent)
            },
        ));
    }
    // 총 400, 예산 100 → 파일마다 최신 한 판만 남는다(총 200) — 더는 못 줄인다.
    let plan = plan_budget_eviction(&all, 100);
    assert_eq!(plan.len(), 2);
    assert!(plan.contains(&("a".to_string(), 1)));
    assert!(plan.contains(&("b".to_string(), 3)));
}

#[test]
fn budget_eviction_is_empty_under_budget() {
    let all = vec![("a".to_string(), entry(1, "aa", HistorySource::Agent))];
    assert!(plan_budget_eviction(&all, 1_000).is_empty());
}

#[test]
fn secrets_and_our_own_infrastructure_are_never_captured() {
    assert!(should_capture("src/main.rs"));
    assert!(should_capture("config/env.ts"));
    assert!(!should_capture(".env"));
    assert!(!should_capture("apps/web/.env.local"));
    assert!(!should_capture(".oculpm/index/history/x"));
    assert!(!should_capture(".git/config"));
    assert!(!should_capture("../outside.rs"));
    assert!(!should_capture(""));
}

#[test]
fn binary_probe_only_looks_at_the_head() {
    assert!(looks_binary(b"png\0\0data"));
    assert!(!looks_binary(b"fn main() {}"));
    let mut late_nul = vec![b'a'; BINARY_PROBE_BYTES + 10];
    late_nul[BINARY_PROBE_BYTES + 5] = 0;
    assert!(!looks_binary(&late_nul));
}

#[test]
fn self_write_note_carries_the_hand_that_wrote_it() {
    let state = HistoryState::default();
    state.note_self_write(1, "a.ts", "blake3:abc", false);
    assert_eq!(state.take_source(1, "a.ts", "abc"), HistorySource::User);
    // 쪽지는 한 번만 쓰인다.
    assert_eq!(state.take_source(1, "a.ts", "abc"), HistorySource::Agent);
    // ⌘K 가 쓴 판은 창구가 같아도 에이전트다 — 안 적으면 사람으로 남는다.
    state.note_self_write(1, "a.ts", "blake3:abc", true);
    assert_eq!(state.take_source(1, "a.ts", "abc"), HistorySource::Agent);
}

#[test]
fn a_different_hash_is_the_agents_write() {
    let state = HistoryState::default();
    state.note_self_write(1, "a.ts", "abc", false);
    assert_eq!(state.take_source(1, "a.ts", "def"), HistorySource::Agent);
    assert_eq!(state.take_source(2, "a.ts", "abc"), HistorySource::Agent);
}

/// 감사 라운드 2026-09-11 A5 — 같은 파일의 캡처가 동시에 들어와도(rename
/// 저장의 Create+Modify 쌍) 한 쪽이 `No such file` 로 죽지 않고, meta 는
/// 한 판만 갖고, 임시 파일이 남지 않는다.
#[test]
fn concurrent_captures_of_one_file_neither_fail_nor_leave_tmp_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/a.ts"), b"export const a = 1;\n").unwrap();

    let handles: Vec<_> = (0..8)
        .map(|_| {
            let root = root.clone();
            std::thread::spawn(move || {
                capture(
                    &root,
                    "src/a.ts",
                    HistoryOp::Create,
                    HistorySource::User,
                    None,
                    50,
                    PROJECT_BUDGET_BYTES,
                )
            })
        })
        .collect();
    let outcomes: Vec<CaptureOutcome> = handles
        .into_iter()
        .map(|h| h.join().unwrap().expect("no capture may fail"))
        .collect();
    assert_eq!(
        outcomes
            .iter()
            .filter(|o| **o == CaptureOutcome::Captured)
            .count(),
        1,
        "같은 내용은 한 번만 찍힌다"
    );

    let hdir = dir_for(&root, "src/a.ts");
    assert_eq!(read_meta(&hdir, "src/a.ts").entries.len(), 1);
    let leftovers: Vec<_> = std::fs::read_dir(&hdir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "임시 파일이 남았다: {leftovers:?}");
}

/// D1 — 예산 설정은 MB 문자열이고, 없거나 이상하면 기본값·범위 밖은 잘린다.
#[test]
fn budget_setting_parses_clamps_and_defaults() {
    assert_eq!(budget_from_setting(None), PROJECT_BUDGET_BYTES);
    assert_eq!(budget_from_setting(Some("abc")), PROJECT_BUDGET_BYTES);
    assert_eq!(budget_from_setting(Some("200")), 200 * 1024 * 1024);
    assert_eq!(budget_from_setting(Some("1")), 64 * 1024 * 1024);
    assert_eq!(budget_from_setting(Some("999999")), 8192 * 1024 * 1024);
}
