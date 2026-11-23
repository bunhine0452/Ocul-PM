//! 「Claude Code 를 못 봤다」 · 「훅 신호가 언제 왔나」 의 판정 (love-round #first-run · #no-journal-diagnosis).

use super::*;

#[test]
fn an_empty_home_and_path_have_seen_no_claude() {
    let home = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    assert!(!claude_seen_in(
        Some(home.path()),
        Some(bin.path().as_os_str())
    ));
    assert!(!claude_seen_in(None, None));
}

#[test]
fn a_claude_config_folder_counts_as_seen() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join(".claude")).unwrap();
    assert!(claude_seen_in(Some(home.path()), None));
}

#[test]
fn the_native_installer_place_counts_even_off_path() {
    let home = tempfile::tempdir().unwrap();
    let local = home.path().join(".local").join("bin");
    std::fs::create_dir_all(&local).unwrap();
    std::fs::write(local.join("claude"), b"").unwrap();
    assert!(claude_seen_in(Some(home.path()), None));
}

#[test]
fn a_claude_on_path_counts_and_a_folder_named_claude_does_not() {
    let home = tempfile::tempdir().unwrap();
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    std::fs::create_dir(a.path().join("claude")).unwrap();
    let only_dir = std::env::join_paths([a.path()]).unwrap();
    assert!(!claude_seen_in(Some(home.path()), Some(&only_dir)));
    std::fs::write(b.path().join("claude.cmd"), b"").unwrap();
    let both = std::env::join_paths([a.path(), b.path()]).unwrap();
    assert!(claude_seen_in(Some(home.path()), Some(&both)));
}

#[test]
fn the_hook_inbox_time_is_its_last_write_and_none_before_any() {
    let root = tempfile::tempdir().unwrap();
    assert_eq!(hook_last_at(root.path()), None);
    let inbox = root.path().join(INBOX_REL);
    std::fs::create_dir_all(inbox.parent().unwrap()).unwrap();
    std::fs::write(&inbox, b"{}\n").unwrap();
    let at = hook_last_at(root.path()).expect("인박스가 있는데 시각이 없다");
    let ts = crate::clock::parse_rfc3339(&at).expect("RFC 3339 가 아니다");
    let age = crate::clock::now().duration_since(ts).as_secs().abs();
    assert!(age < 120, "방금 쓴 인박스가 {age}초 전이라고 했다");
}
