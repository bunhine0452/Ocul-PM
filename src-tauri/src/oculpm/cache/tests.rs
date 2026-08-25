use super::*;
use crate::db::Db;
use std::fs;
use tempfile::tempdir;

async fn fresh_db() -> (Db, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let db = Db::open(db_path).await.expect("open db");
    (db, dir)
}

fn write_entry(root: &Path, rel: &str, frontmatter: &str, body: &str) -> PathBuf {
    let abs = root.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let text = if frontmatter.is_empty() {
        body.to_string()
    } else {
        format!("---\n{frontmatter}\n---\n{body}")
    };
    fs::write(&abs, text).unwrap();
    abs
}

fn standard_frontmatter(slug: &str) -> String {
    format!(
        "schema_version: 1\ntype: bug\nslug: {slug}\nstatus: done\ndifficulty: medium\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\ntags: [\"alpha\", \"beta\"]"
    )
}

/// Today 히어로의 「라인 변화」 경로: 인덱싱 직후엔 값이 없고(사이드카를
/// 아직 안 셌다), 세어 넣으면 워크데이 합에 잡히며 work-list 에서 빠진다.
#[tokio::test]
async fn line_counts_fill_the_workday_sum_and_clear_the_work_list() {
    use crate::oculpm::entry_diffs::FileLineCounts;
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_a.md";
    write_entry(
        &journal_root,
        rel,
        &standard_frontmatter("bug-a"),
        "[x] Title A\n\n## body\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    // Freshly indexed → churn unknown (NULL), so the ring reads 0 and the
    // entry is on the backfill work-list.
    assert_eq!(cache.workday_lines(1, "20260524").await.unwrap(), (0, 0));
    assert_eq!(
        cache.entries_missing_line_counts(1).await.unwrap(),
        vec![rel.to_string()]
    );

    cache
        .set_line_counts(
            1,
            rel,
            vec![
                FileLineCounts { path: "src/a.rs".into(), added: 40, removed: 10 },
                // a path that isn't in files_touched updates nothing
                FileLineCounts { path: "src/gone.rs".into(), added: 99, removed: 99 },
            ],
        )
        .await
        .unwrap();

    assert_eq!(cache.workday_lines(1, "20260524").await.unwrap(), (40, 10));
    assert!(cache.entries_missing_line_counts(1).await.unwrap().is_empty());
    // another workday is unaffected
    assert_eq!(cache.workday_lines(1, "20260525").await.unwrap(), (0, 0));
}

#[tokio::test]
async fn empty_journal_full_reindex_yields_zero_counts() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    fs::create_dir_all(&journal_root).unwrap();
    let report = cache.reindex_full(1, &journal_root).await.unwrap();
    assert_eq!(report.inserted, 0);
    assert_eq!(report.deleted, 0);
    assert_eq!(report.parse_errors, 0);
}

#[tokio::test]
async fn three_entries_upsert_via_full_reindex() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-a"),
        "[x] Title A\n\n## body\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1030_bug_b.md",
        &standard_frontmatter("bug-b"),
        "[ ] Title B\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1100_bug_c.md",
        &standard_frontmatter("bug-c"),
        "[x] Title C\n",
    );

    let report = cache.reindex_full(1, &journal_root).await.unwrap();
    assert_eq!(report.inserted, 3, "report: {report:?}");
    let rows = cache
        .list_entries(1, Some("20260524"), &EntryFilters::default())
        .await
        .unwrap();
    assert_eq!(rows.len(), 3);
    let slugs: Vec<&str> = rows.iter().map(|r| r.slug.as_str()).collect();
    assert!(slugs.contains(&"bug-a"));
    assert!(slugs.contains(&"bug-b"));
    assert!(slugs.contains(&"bug-c"));
    // tags hydrated
    assert!(rows.iter().all(|r| r.tags.contains(&"alpha".to_string())));
    // files_count = 1 (one file_touched per entry)
    assert!(rows.iter().all(|r| r.files_count == 1));
}

fn fm(ty: &str, slug: &str, status: &str, agent: &str, files: &[&str]) -> String {
    let files_block = files
        .iter()
        .map(|f| format!("  - path: \"{f}\"\n    op: update"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "schema_version: 1\ntype: {ty}\nslug: {slug}\nstatus: {status}\ndifficulty: medium\ncreated_at: \"2026-06-20T09:25:13+09:00\"\nsession_id: \"20260620-001\"\nagent: {{ id: {agent} }}\nlanguage: ko\nfiles_touched:\n{files_block}\ntags: []"
    )
}

#[tokio::test]
async fn range_entries_filters_by_workday_and_attaches_files() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let root = dir.path().join("journal");
    write_entry(
        &root,
        "20260618/Features_to_add/0900_feature_x.md",
        &fm("feature", "feat-x", "done", "claude-code", &["src/a.rs", "src/b.rs"]),
        "[x] Feature X\n",
    );
    write_entry(
        &root,
        "20260620/Refactors/1000_refactor_y.md",
        &fm("refactor", "ref-y", "done", "cursor", &["src/b.rs"]),
        "[x] Refactor Y\n",
    );
    write_entry(
        &root,
        "20260622/Errors/1100_error_z.md",
        &fm("error", "err-z", "abandoned", "claude-code", &["src/c.rs"])
            .replace("tags: []", "tags: [\"perf\", \"hotfix\"]"),
        "[ ] Error Z\n",
    );
    cache.reindex_full(7, &root).await.unwrap();

    // Full range — all three, newest workday first.
    let all = cache.range_entries(7, "20260618", "20260622").await.unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].workday, "20260622");
    assert_eq!(all[0].entry_type, "error");
    // tags attached (skill promotion pass reads these)
    let mut err_tags = all[0].tags.clone();
    err_tags.sort();
    assert_eq!(err_tags, vec!["hotfix".to_string(), "perf".to_string()]);
    // files attached
    let feat = all.iter().find(|e| e.entry_type == "feature").unwrap();
    let mut feat_files = feat.files.clone();
    feat_files.sort();
    assert_eq!(
        feat_files,
        vec!["src/a.rs".to_string(), "src/b.rs".to_string()]
    );

    // Narrow range excludes the boundary days.
    let narrow = cache.range_entries(7, "20260619", "20260621").await.unwrap();
    assert_eq!(narrow.len(), 1);
    assert_eq!(narrow[0].entry_type, "refactor");
    assert_eq!(narrow[0].agent_id, "cursor");

    // No entries in range → empty.
    let none = cache.range_entries(7, "20260101", "20260102").await.unwrap();
    assert!(none.is_empty());
}

#[tokio::test]
async fn delete_on_disk_then_incremental_reindex_drops_row() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let a = write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-a"),
        "[x] A\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1000_bug_b.md",
        &standard_frontmatter("bug-b"),
        "[ ] B\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();
    fs::remove_file(&a).unwrap();

    let report = cache.reindex_incremental(1, &journal_root).await.unwrap();
    assert_eq!(report.deleted, 1, "report: {report:?}");
    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].slug, "bug-b");
}

#[tokio::test]
async fn incremental_skips_unchanged_files() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-a"),
        "[x] A\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();
    let report = cache.reindex_incremental(1, &journal_root).await.unwrap();
    assert_eq!(report.inserted, 0);
    assert_eq!(report.updated, 0);
    assert_eq!(report.skipped_unchanged, 1, "report: {report:?}");
}

#[tokio::test]
async fn body_unchanged_with_new_mtime_is_mtime_only() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let path = write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-a"),
        "[x] A\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();
    let new_mtime = std::fs::metadata(&path).unwrap();
    // Rewrite identical body with no mtime change isn't reliable across
    // file systems, so we drive upsert directly with a different mtime.
    let original = std::fs::read_to_string(&path).unwrap();
    let (pf, body_text) = parse_frontmatter_and_body(&original);
    let body = parse_body(&body_text);
    let outcome = cache
        .upsert_entry(
            1,
            "20260524/Bugs/0925_bug_a.md",
            &pf,
            &body,
            new_mtime
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
                + 1000, // force mtime delta
            &original,
        )
        .await
        .unwrap();
    assert_eq!(outcome, UpsertOutcome::MtimeOnly);
}

#[tokio::test]
async fn frontmatter_parse_error_still_caches_with_parse_ok_false() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    // Missing required `slug` field — parser yields parsed=None.
    let broken = "schema_version: 1\ntype: bug\nstatus: done\ncreated_at: \"x\"\nsession_id: \"x\"\nagent: { id: x }\nlanguage: en";
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_broken.md",
        broken,
        "[x] still has a title\n",
    );
    let report = cache.reindex_full(1, &journal_root).await.unwrap();
    assert_eq!(report.parse_errors, 1, "report: {report:?}");
    assert_eq!(report.inserted, 1, "row still inserted (parse_ok=0)");

    let entry = cache
        .get_entry(1, "20260524/Bugs/0925_bug_broken.md")
        .await
        .unwrap()
        .expect("entry exists");
    // Fallback title from body's first non-blank line.
    assert_eq!(entry.title, "still has a title");
    assert_eq!(entry.frontmatter.entry_type, EntryType::Chore);
}

#[tokio::test]
async fn list_entries_filter_by_type() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-a"),
        "[x] A\n",
    );
    let feat_fm = standard_frontmatter("feat-a").replace("type: bug", "type: feature");
    write_entry(
        &journal_root,
        "20260524/Features_to_add/1000_feature_x.md",
        &feat_fm,
        "[ ] F\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    let only_features = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                types: vec![EntryType::Feature],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(only_features.len(), 1);
    assert_eq!(only_features[0].slug, "feat-a");
}

#[tokio::test]
async fn list_entries_search_matches_korean_substring() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_a.md",
        &standard_frontmatter("bug-korean"),
        "[x] 한국어 제목\n\n버그가 발생했어요.\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1030_bug_b.md",
        &standard_frontmatter("bug-other"),
        "[ ] English only\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    let rows = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                search: Some("한국어".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].slug, "bug-korean");
}

#[tokio::test]
async fn list_entries_verified_only_excludes_unverified() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let verified_fm =
        standard_frontmatter("v").replace("language: ko", "language: ko\nverified_by_user: true");
    write_entry(
        &journal_root,
        "20260524/Bugs/0925_bug_v.md",
        &verified_fm,
        "[x] V\n",
    );
    write_entry(
        &journal_root,
        "20260524/Bugs/1030_bug_u.md",
        &standard_frontmatter("u"),
        "[x] U\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    let rows = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                verified_only: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].slug, "v");
}

#[tokio::test]
async fn apply_path_change_created_then_removed_round_trip() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_a.md";
    write_entry(
        &journal_root,
        rel,
        &standard_frontmatter("bug-a"),
        "[x] A\n",
    );

    cache
        .apply_path_change(1, &journal_root, rel, PathChangeKind::Created)
        .await
        .unwrap();
    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);

    std::fs::remove_file(journal_root.join(rel)).unwrap();
    cache
        .apply_path_change(1, &journal_root, rel, PathChangeKind::Removed)
        .await
        .unwrap();
    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    assert!(rows.is_empty());
}

fn default_redact() -> Vec<Regex> {
    crate::oculpm::redact::compile_redact_patterns(
        &crate::oculpm::spec::OculpmConfig::default_for_new_project()
            .git
            .auto_redact_patterns,
    )
}

/// F7a-B: an agent wrote `created_at` without a tz offset. The indexing
/// projection (`.with_tz`) backfills the project offset into the cached
/// value and records a warning (flipping `parse_ok`) — while the on-disk
/// file is left exactly as authored.
#[tokio::test]
async fn with_tz_backfills_offset_and_warns_disk_unchanged() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_notz.md";
    let fm = "schema_version: 1\ntype: bug\nslug: notz\nstatus: done\n\
              created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
              agent: { id: claude-code }\nlanguage: ko";
    let abs = write_entry(&journal_root, rel, fm, "[x] body\n");
    let on_disk_before = std::fs::read_to_string(&abs).unwrap();

    let seoul: Tz = "Asia/Seoul".parse().unwrap();
    JournalCache::with_redaction(&db, default_redact())
        .with_tz(seoul)
        .reindex_full(1, &journal_root)
        .await
        .unwrap();

    let entry = JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .expect("row exists");
    // Cached value carries the backfilled +09:00 offset…
    assert_eq!(entry.frontmatter.created_at, "2026-05-24T09:25:13+09:00");
    // …recorded as an *advisory* warning (lights the ⚠ badge) but the
    // frontmatter parsed structurally, so parse_ok stays true.
    assert!(entry.parse_ok, "tz coercion is advisory, not a parse failure");
    assert!(
        entry.parse_warnings.iter().any(|w| w.contains("timezone offset")),
        "warns: {:?}",
        entry.parse_warnings
    );
    // …but the on-disk SSOT is byte-identical to what the agent wrote.
    assert_eq!(std::fs::read_to_string(&abs).unwrap(), on_disk_before);
}

/// Without `.with_tz`, the same tz-less entry is only *flagged* (detect +
/// warn), and the cached value is left untouched — proving backfill is the
/// tz facade's doing, not unconditional.
#[tokio::test]
async fn without_tz_detects_but_does_not_rewrite() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_notz2.md";
    let fm = "schema_version: 1\ntype: bug\nslug: notz2\nstatus: done\n\
              created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
              agent: { id: claude-code }\nlanguage: ko";
    write_entry(&journal_root, rel, fm, "[x] body\n");

    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();

    let entry = JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .expect("row exists");
    assert_eq!(entry.frontmatter.created_at, "2026-05-24T09:25:13"); // unchanged
    assert!(entry.parse_ok, "detect-only warning is advisory, not a parse failure");
    assert!(entry
        .parse_warnings
        .iter()
        .any(|w| w.contains("timezone offset")));
}

/// F7a-B follow-up: a row cached before the coercion logic existed
/// (`coercion_version` < current) must be re-projected by an *incremental*
/// pass even though its file is unchanged — then stamped current so it's
/// skipped again. We simulate the pre-mechanism row by writing it raw (no
/// tz) and forcing its version to 0.
#[tokio::test]
async fn incremental_recoerces_version_stale_row_then_skips() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_stale.md";
    let fm = "schema_version: 1\ntype: bug\nslug: \"버그 수정\"\nstatus: done\n\
              created_at: \"2026-05-24T09:25:13\"\nsession_id: \"20260524-001\"\n\
              agent: { id: claude-code }\nlanguage: ko";
    write_entry(&journal_root, rel, fm, "[x] body\n");

    // Index WITHOUT tz → raw created_at + raw (spaced) slug cached.
    JournalCache::new(&db)
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    // Force the row to look pre-mechanism (version 0).
    db.conn()
        .call(|c| {
            c.execute("UPDATE oculpm_journal SET coercion_version = 0", [])?;
            Ok::<_, tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();

    // Incremental WITH tz: mtime is unchanged, but the stale version must
    // prevent the walk-level skip so the row gets re-coerced. (The re-coerce
    // returns MtimeOnly, which the report folds into skipped_unchanged — so
    // the *values* below are the real proof it was re-processed, not skipped.)
    let seoul: Tz = "Asia/Seoul".parse().unwrap();
    JournalCache::new(&db)
        .with_tz(seoul)
        .reindex_incremental(1, &journal_root)
        .await
        .unwrap();

    let row = JournalCache::new(&db)
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    // Had it been skipped at the walk level, these would still be raw.
    assert_eq!(row[0].created_at, "2026-05-24T09:25:13+09:00"); // backfilled
    assert_eq!(row[0].slug, "버그-수정"); // Unicode-normalized

    // …and the row is stamped current, so future incrementals skip it again.
    let ver: i64 = db
        .conn()
        .call(|c| {
            Ok::<_, tokio_rusqlite::Error>(c.query_row(
                "SELECT coercion_version FROM oculpm_journal",
                [],
                |r| r.get::<_, i64>(0),
            )?)
        })
        .await
        .unwrap();
    assert_eq!(ver, COERCION_VERSION);
}

#[tokio::test]
async fn reindex_with_redaction_masks_secret_in_cache_body() {
    // R1: an agent-authored entry pastes an AWS key into the body. A cache
    // built with redaction must mask it on projection so the cached
    // body_markdown (→ AI context) never carries the plaintext, while a
    // plain cache leaves it as-is (proves masking is the facade's doing).
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_secret.md";
    write_entry(
        &journal_root,
        rel,
        &standard_frontmatter("bug-secret"),
        "[x] leaked\n\napi key: AKIAABCDEFGHIJKLMNOP done\n",
    );

    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    let entry = JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .expect("row exists");
    assert!(
        entry.body_markdown.contains("[REDACTED]"),
        "body should be masked: {}",
        entry.body_markdown
    );
    assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
}

#[tokio::test]
async fn apply_path_change_reports_redacted_count() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_two.md";
    write_entry(
        &journal_root,
        rel,
        &standard_frontmatter("bug-two"),
        "[x] two\n\ntoken=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
    );

    let (outcome, redacted) = JournalCache::with_redaction(&db, default_redact())
        .apply_path_change(1, &journal_root, rel, PathChangeKind::Created)
        .await
        .unwrap();
    assert!(matches!(outcome, Some(UpsertOutcome::Inserted)));
    assert_eq!(redacted, 1, "one GitHub PAT masked");

    let entry = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
    assert!(entry.body_markdown.contains("[REDACTED]"));
    assert!(!entry.body_markdown.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
}

#[tokio::test]
async fn redaction_masks_body_but_preserves_secret_like_frontmatter() {
    // R1 regression: masking touches the BODY only. A slug that itself
    // matches a redact pattern (`sk-…`) must survive — masking the YAML
    // would turn `slug: [REDACTED]` into a flow sequence and degrade the
    // row to an unparseable chore (wrong slug/type/status in the cache).
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_sk.md";
    // slug matches `sk-[A-Za-z0-9_-]{20,}`; body carries an AWS key.
    let fm = standard_frontmatter("sk-secret-looking-slug-1234");
    write_entry(
        &journal_root,
        rel,
        &fm,
        "[x] done\n\nleaked AKIAABCDEFGHIJKLMNOP here\n",
    );

    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    let entry = JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .expect("row exists");
    // Frontmatter parsed intact — slug NOT masked.
    assert_eq!(entry.frontmatter.slug, "sk-secret-looking-slug-1234");
    assert_eq!(entry.frontmatter.entry_type, EntryType::Bug);
    // Body masked.
    assert!(entry.body_markdown.contains("[REDACTED]"));
    assert!(!entry.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
}

#[tokio::test]
async fn reindex_incremental_does_not_scrub_preexisting_unmasked_secret() {
    // R1 KNOWN LIMITATION (dev-report §2 follow-up): a secret projected into
    // the cache by a pre-redaction build is NOT scrubbed by an incremental
    // reindex when the file's mtime is unchanged (the file is skipped before
    // masking). Only a full reindex or a content edit clears it. This pins
    // the behavior so a future "fix" updates the test deliberately.
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_stale.md";
    write_entry(
        &journal_root,
        rel,
        &standard_frontmatter("stale"),
        "[x] x\n\nkey AKIAABCDEFGHIJKLMNOP\n",
    );

    // First projection WITHOUT redaction (simulates a pre-R1 build).
    JournalCache::new(&db)
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    let before = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
    assert!(before.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));

    // Incremental WITH redaction but unchanged mtime → file skipped → secret survives.
    JournalCache::with_redaction(&db, default_redact())
        .reindex_incremental(1, &journal_root)
        .await
        .unwrap();
    let after = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
    assert!(
        after.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"),
        "known limitation: incremental skip leaves the stale secret"
    );

    // A FULL reindex with redaction DOES scrub it (the escape hatch).
    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();
    let healed = JournalCache::new(&db).get_entry(1, rel).await.unwrap().unwrap();
    assert!(healed.body_markdown.contains("[REDACTED]"));
    assert!(!healed.body_markdown.contains("AKIAABCDEFGHIJKLMNOP"));
}

#[tokio::test]
async fn reindex_full_drops_previous_project_rows() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_a.md";
    write_entry(&journal_root, rel, &standard_frontmatter("a"), "[x] A\n");
    cache.reindex_full(1, &journal_root).await.unwrap();
    std::fs::remove_file(journal_root.join(rel)).unwrap();
    let report = cache.reindex_full(1, &journal_root).await.unwrap();
    assert_eq!(report.inserted, 0);
    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    assert!(rows.is_empty());
}

#[tokio::test]
async fn template_and_attachments_are_skipped() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    // Real entry
    write_entry(&journal_root, "20260524/Bugs/0925_bug_a.md", &standard_frontmatter("a"), "[x]\n");
    // Should-be-skipped helpers
    write_entry(&journal_root, "_template.md", "", "ignored template\n");
    write_entry(&journal_root, "20260524/_attachments/note.md", "", "scratch\n");
    write_entry(&journal_root, "20260524/Bugs/.draft.md", "", "hidden\n");

    let report = cache.reindex_full(1, &journal_root).await.unwrap();
    assert_eq!(report.inserted, 1, "only real entry should be cached");
}

#[tokio::test]
async fn get_entry_returns_none_for_missing_path() {
    let (db, _dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let result = cache.get_entry(1, "20260524/Bugs/none.md").await.unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn upsert_outcome_signals_inserted_then_updated() {
    let (db, dir) = fresh_db().await;
    let cache = JournalCache::new(&db);
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_a.md";
    let abs = write_entry(&journal_root, rel, &standard_frontmatter("a"), "[x] v1\n");
    let mtime = std::fs::metadata(&abs).unwrap();
    let text1 = std::fs::read_to_string(&abs).unwrap();
    let (pf1, body_text1) = parse_frontmatter_and_body(&text1);
    let body1 = parse_body(&body_text1);
    let mtime_secs = mtime
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    assert_eq!(
        cache
            .upsert_entry(1, rel, &pf1, &body1, mtime_secs, &text1)
            .await
            .unwrap(),
        UpsertOutcome::Inserted
    );
    // Rewrite with different body → Updated
    std::fs::write(&abs, format!("---\n{}\n---\n[x] v2\n", standard_frontmatter("a"))).unwrap();
    let text2 = std::fs::read_to_string(&abs).unwrap();
    let (pf2, body_text2) = parse_frontmatter_and_body(&text2);
    let body2 = parse_body(&body_text2);
    assert_eq!(
        cache
            .upsert_entry(1, rel, &pf2, &body2, mtime_secs + 10, &text2)
            .await
            .unwrap(),
        UpsertOutcome::Updated
    );
}

// ───────── W5-PR5: overview_stats ──────────

/// Insert one journal row directly into the cache via reindex_full of a
/// hand-written .md file. Helper for the overview tests below.
fn write_journal(
    root: &Path,
    relative_path: &str,
    difficulty: Option<&str>,
    agent_id: &str,
    created_at: &str,
    unfinished: bool,
) {
    let mut fm = format!(
        "schema_version: 1\ntype: bug\nslug: x\nstatus: {status}\n",
        status = if unfinished { "in_progress" } else { "done" },
    );
    if let Some(d) = difficulty {
        fm.push_str(&format!("difficulty: {d}\n"));
    }
    fm.push_str(&format!(
        "created_at: \"{created_at}\"\nsession_id: \"20260520-001\"\nagent: {{ id: {agent_id} }}\nlanguage: ko",
    ));
    let body = if unfinished {
        "[ ] Title X\n\n## body\n"
    } else {
        "[x] Title X\n\n## body\n"
    };
    write_entry(root, relative_path, &fm, body);
}

#[allow(clippy::too_many_arguments)]
async fn insert_session_async<'a>(
    cache: &'a JournalCache<'a>,
    project_id: u32,
    session_id: &str,
    workday: &str,
    started_at: &str,
    ended_at: &str,
    file_event_count: u32,
    files_unique: u32,
) {
    let pid = project_id as i64;
    let sid = session_id.to_string();
    let wd = workday.to_string();
    let s = started_at.to_string();
    let e = ended_at.to_string();
    cache
        .db
        .conn()
        .call(move |c| {
            c.execute(
                "INSERT INTO oculpm_sessions_cache (project_id, session_id, workday, started_at, ended_at, ended_reason, file_event_count, files_unique, agent_label_guess)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, NULL)",
                params![pid, &sid, &wd, &s, &e, file_event_count as i64, files_unique as i64],
            )?;
            Ok::<(), rusqlite::Error>(())
        })
        .await
        .unwrap();
}
async fn fresh_cache_with_project() -> (Db, tempfile::TempDir, PathBuf) {
    let (db, dir) = fresh_db().await;
    // Project row for FK constraints elsewhere.
    let _ = db
        .create_project("ov".into(), dir.path().to_string_lossy().into())
        .await
        .unwrap();
    let journal_root = dir.path().join("journal");
    std::fs::create_dir_all(&journal_root).unwrap();
    (db, dir, journal_root)
}

#[tokio::test]
async fn overview_stats_aggregates_heatmap_cells_for_window() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    // 3 entries on 20260522.
    write_journal(
        &journal_root,
        "20260522/Bugs/0900_bug_a.md",
        Some("medium"),
        "claude-code",
        "2026-05-22T09:00:00+09:00",
        false,
    );
    write_journal(
        &journal_root,
        "20260522/Bugs/1000_bug_b.md",
        Some("low"),
        "cursor",
        "2026-05-22T10:00:00+09:00",
        false,
    );
    write_journal(
        &journal_root,
        "20260522/Bugs/1100_bug_c.md",
        None,
        "claude-code",
        "2026-05-22T11:00:00+09:00",
        false,
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    assert_eq!(stats.window_days, 7);
    assert_eq!(stats.heatmap_cells.len(), 7);
    // Most cells are empty; the 20260522 one has 3 entries.
    let last = stats.heatmap_cells.last().unwrap();
    assert_eq!(last.workday, "20260522");
    assert_eq!(last.entry_count, 3);
    assert_eq!(last.score, 15); // 3 * 5 + 0 file events
    let prior = stats.heatmap_cells.first().unwrap();
    assert_eq!(prior.entry_count, 0);
}

#[tokio::test]
async fn overview_stats_groups_difficulty_mix_with_null_count() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    write_journal(&journal_root, "20260522/Bugs/0900_bug_a.md", Some("medium"), "x", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_bug_b.md", Some("medium"), "x", "2026-05-22T09:10:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0920_bug_c.md", Some("high"), "x", "2026-05-22T09:20:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0930_bug_d.md", None, "x", "2026-05-22T09:30:00+09:00", false);
    cache.reindex_full(1, &journal_root).await.unwrap();

    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    assert_eq!(stats.difficulty_mix.medium, 2);
    assert_eq!(stats.difficulty_mix.high, 1);
    assert_eq!(stats.difficulty_mix.null_count, 1);
    assert_eq!(stats.difficulty_mix.low, 0);
}

#[tokio::test]
async fn overview_stats_agent_breakdown_share_sums_to_one() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "claude-code", "2026-05-22T09:10:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "cursor", "2026-05-22T09:20:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0930_d.md", None, "manual", "2026-05-22T09:30:00+09:00", false);
    cache.reindex_full(1, &journal_root).await.unwrap();

    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    let total_share: f32 = stats.agent_breakdown.iter().map(|a| a.share).sum();
    assert!(
        (total_share - 1.0).abs() < 1e-5,
        "agent shares should sum to 1.0, got {total_share}"
    );
    let claude = stats
        .agent_breakdown
        .iter()
        .find(|a| a.agent_id == "claude-code")
        .expect("claude-code present");
    assert_eq!(claude.entry_count, 2);
}

#[tokio::test]
async fn overview_stats_unfinished_caps_at_fifty() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    for i in 0..60 {
        let h = i / 60;
        let m = i % 60;
        write_journal(
            &journal_root,
            &format!("20260522/Bugs/{:02}{:02}_bug_{}.md", h, m, i),
            None,
            "x",
            &format!("2026-05-22T{:02}:{:02}:00+09:00", h, m),
            true, // unfinished
        );
    }
    cache.reindex_full(1, &journal_root).await.unwrap();

    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    assert_eq!(stats.unfinished_entries.len(), 50);
    // Most-recent first — first entry's created_at >= second's.
    for pair in stats.unfinished_entries.windows(2) {
        assert!(
            pair[0].created_at >= pair[1].created_at,
            "expected DESC ordering by created_at; got {} then {}",
            pair[0].created_at,
            pair[1].created_at
        );
    }
}

// ───────── W5-PR6: agent filter + observed_agent_ids ──────────

#[tokio::test]
async fn list_entries_filter_by_agent_includes_only_matching() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "manual", "2026-05-22T09:20:00+09:00", false);
    cache.reindex_full(1, &journal_root).await.unwrap();

    let rows = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                agents: vec!["cursor".into()],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].agent_id, "cursor");
}

#[tokio::test]
async fn list_entries_filter_by_agent_empty_set_shows_all() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "manual", "2026-05-22T09:20:00+09:00", false);
    cache.reindex_full(1, &journal_root).await.unwrap();

    let rows = cache
        .list_entries(1, None, &EntryFilters::default())
        .await
        .unwrap();
    assert_eq!(rows.len(), 3, "empty agents = no constraint");
}

#[tokio::test]
async fn list_entries_filter_combines_type_and_agent() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    // bug + claude-code, bug + cursor, feature + cursor.
    write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "claude-code", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "cursor", "2026-05-22T09:10:00+09:00", false);
    // Switch the third row to a feature by overwriting frontmatter type.
    let feat_fm = "schema_version: 1\ntype: feature\nslug: x\nstatus: done\ncreated_at: \"2026-05-22T09:20:00+09:00\"\nsession_id: \"20260520-001\"\nagent: { id: cursor }\nlanguage: ko";
    write_entry(
        &journal_root,
        "20260522/Features_to_add/0920_c.md",
        feat_fm,
        "[x] feat\n",
    );
    cache.reindex_full(1, &journal_root).await.unwrap();

    let rows = cache
        .list_entries(
            1,
            None,
            &EntryFilters {
                types: vec![EntryType::Bug],
                agents: vec!["cursor".into()],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 1, "intersection of bug + cursor = 1");
    assert_eq!(rows[0].agent_id, "cursor");
    assert_eq!(rows[0].entry_type, EntryType::Bug);
}

#[tokio::test]
async fn observed_agent_ids_returns_distinct_sorted() {
    let (db, _dir, journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    // Insert in non-alphabetical order, with duplicates.
    write_journal(&journal_root, "20260522/Bugs/0900_a.md", None, "manual", "2026-05-22T09:00:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0910_b.md", None, "claude-code", "2026-05-22T09:10:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0920_c.md", None, "claude-code", "2026-05-22T09:20:00+09:00", false);
    write_journal(&journal_root, "20260522/Bugs/0930_d.md", None, "cursor", "2026-05-22T09:30:00+09:00", false);
    cache.reindex_full(1, &journal_root).await.unwrap();

    let agents = cache.observed_agent_ids(1).await.unwrap();
    assert_eq!(agents, vec!["claude-code", "cursor", "manual"]);
}

#[tokio::test]
async fn overview_stats_recent_sessions_narrative_rate_handles_zero_sessions() {
    let (db, _dir, _journal_root) = fresh_cache_with_project().await;
    let cache = JournalCache::new(&db);
    // No sessions, no entries — narrative_rate must be 0 (not NaN) for
    // every day in the window. recent_sessions itself is empty.
    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    assert!(stats.recent_sessions.is_empty());

    // Now insert a session with file_event_count=0 — narrative_rate must
    // still be 0.0 (no with_events sessions).
    insert_session_async(
        &cache,
        1,
        "20260522-001",
        "20260522",
        "2026-05-22T09:00:00+09:00",
        "2026-05-22T10:00:00+09:00",
        0,
        0,
    )
    .await;
    let stats = cache.overview_stats(1, 7, "20260522").await.unwrap();
    assert_eq!(stats.recent_sessions.len(), 1);
    let row = &stats.recent_sessions[0];
    assert_eq!(row.session_count, 1);
    assert!(row.narrative_rate.is_finite());
    assert_eq!(row.narrative_rate, 0.0);
}
