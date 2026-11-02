use super::*;

fn journal(root: &Path, day: &str, name: &str, kind: &str, files: &[&str], body: &str) {
    let dir = root.join(".oculpm/journal").join(day).join("Bugs");
    std::fs::create_dir_all(&dir).unwrap();
    let touched: String = files
        .iter()
        .map(|f| format!("  - path: \"{f}\"\n    op: update\n"))
        .collect();
    let md = format!(
        "---\nschema_version: 1\ntype: {kind}\nslug: \"{name}\"\nstatus: done\ncreated_at: \"2026-11-02T10:00:00+09:00\"\n\
         session_id: \"20261102-001\"\nagent:\n  id: \"claude-code\"\nlanguage: \"ko\"\nverified_by_user: false\n\
         files_touched:\n{touched}---\n{body}"
    );
    std::fs::write(dir.join(format!("{name}.md")), md).unwrap();
}

fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y%m%d").unwrap()
}

#[test]
fn recent_bug_journals_touching_the_file_are_found_newest_first() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let body =
        "[x] 윗줄: 이름이 겹쳤다\n\n## 발생 원인\n`76px`\n\n## 검증\n- `pnpm test`: 993 passed\n";
    journal(
        r,
        "20261102",
        "1729_bug_a",
        "bug",
        &["src/styles/shell.css"],
        body,
    );
    journal(
        r,
        "20261030",
        "0900_bug_b",
        "bug",
        &["src/styles/shell.css", "src/x.ts"],
        "[x] 옛 버그\n",
    );
    journal(
        r,
        "20261020",
        "0900_bug_old",
        "bug",
        &["src/styles/shell.css"],
        "[x] 너무 옛날\n",
    );
    journal(
        r,
        "20261102",
        "1800_feature_c",
        "feature",
        &["src/styles/shell.css"],
        "[x] 기능\n",
    );
    journal(
        r,
        "20261102",
        "1801_bug_other",
        "bug",
        &["src/other.css"],
        "[x] 다른 파일\n",
    );
    let hits = find(r, "src/styles/shell.css", day("20261102"), 7);
    assert_eq!(
        hits.iter().map(|h| h.journal.as_str()).collect::<Vec<_>>(),
        ["20261102/Bugs/1729_bug_a.md", "20261030/Bugs/0900_bug_b.md"]
    );
    assert_eq!(hits[0].title, "윗줄: 이름이 겹쳤다");
    assert_eq!(
        hits[0].check.as_deref(),
        Some("pnpm test"),
        "발생 원인 칸의 코드가 아니라 검증 칸의 것"
    );
    assert_eq!(hits[1].check, None);
    let msg = message("src/styles/shell.css", &hits);
    assert!(msg.contains("그때 확인 명령: `pnpm test`"), "{msg}");
    let json: serde_json::Value = serde_json::from_str(&hook_json(&msg)).unwrap();
    assert_eq!(json["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert_eq!(json["hookSpecificOutput"]["additionalContext"], msg);
}

#[test]
fn paths_are_made_project_relative_and_outside_paths_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    std::fs::create_dir_all(r.join("src")).unwrap();
    let abs = r.join("src/new.ts").to_string_lossy().to_string();
    assert_eq!(project_rel(r, &abs).as_deref(), Some("src/new.ts"));
    assert_eq!(project_rel(r, "src\\a.ts").as_deref(), Some("src/a.ts"));
    assert_eq!(project_rel(r, "../x.ts"), None);
    assert_eq!(project_rel(r, "/etc/hosts"), None);
    assert_eq!(project_rel(r, ".oculpm/journal/x.md"), None);
}

#[test]
fn one_warning_per_file_per_conversation() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    std::fs::create_dir_all(r.join(".oculpm")).unwrap();
    assert!(first_time(r, "abc-1", "src/a.ts"));
    assert!(!first_time(r, "abc-1", "src/a.ts"));
    assert!(first_time(r, "abc-1", "src/b.ts"));
    assert!(first_time(r, "abc-2", "src/a.ts"));
    // 대화 id 가 이상하면 표시를 남기지 않는다(경로로 쓰이니까) — 매번 경고.
    assert!(first_time(r, "../evil", "src/a.ts"));
    assert!(!r.join(".oculpm/hooks/.refix-../evil").exists());
}
