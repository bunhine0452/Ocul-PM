//! 태그 병합 — `merge_journal_tags` 가 디스크 원본의 `tags` 만 다시 쓰는 것의
//! 테스트 ({#tag-merge}).
//!
//! `tests_related.rs` 와 같은 이유로 형제 파일이다 (`tests.rs` 는 크기 래칫 위).

use super::*;
use crate::db::Db;

async fn fresh_manager_and_db() -> (OculpmManager, Db, tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db"))
        .await
        .expect("open db");
    let manager = OculpmManager::new();
    let project_root = dir.path().join("project");
    std::fs::create_dir_all(&project_root).unwrap();
    manager.init_project(7, &project_root, "ko").await.unwrap();
    (manager, db, dir, project_root)
}

fn put_entry(project_root: &Path, rel: &str, body: &str, tags: &[&str]) {
    let abs = project_root.join(".oculpm/journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let tag_lines: String = tags.iter().map(|t| format!("\n  - \"{t}\"")).collect();
    std::fs::write(
        &abs,
        format!(
            "---\nschema_version: 1\ntype: bug\nslug: agent-bug\nstatus: done\n\
             created_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\n\
             agent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched: []\n\
             related: []\ntags:{tag_lines}\n---\n{body}"
        ),
    )
    .unwrap();
}

fn disk_tags(project_root: &Path, rel: &str) -> Vec<String> {
    let raw = std::fs::read_to_string(project_root.join(".oculpm/journal").join(rel)).unwrap();
    parse_frontmatter_and_body(&raw).0.parsed.unwrap().tags
}

const A: &str = "20260524/Bugs/0925_bug_a.md";
const B: &str = "20260520/Bugs/1010_bug_b.md";
const C: &str = "20260519/Bugs/1111_bug_c.md";

/// 병합은 **표기 차이를 넘어** 잡고, 본문은 한 글자도 안 변하며, 나머지 태그는
/// 순서까지 그대로 남는다.
#[tokio::test]
async fn merging_rewrites_only_the_tags_line() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let body = "[x] 워처가 멈췄다\n\n## 발생 원인\n\n큐가 막혔다.\n\n## 검증\n\n재현 2회\n";
    put_entry(
        &project_root,
        A,
        body,
        &["terminal", "IME_버그", "mcp-tool"],
    );
    put_entry(&project_root, B, "[x] b\n", &["ime-bugs"]);
    put_entry(&project_root, C, "[x] c\n", &["unrelated"]);
    manager.reindex_journal_cache(&db, 7).await.unwrap();

    let report = manager
        .merge_journal_tags(
            &db,
            7,
            vec!["ime-버그".to_string(), "IME-BUGS".to_string()],
            "ime".to_string(),
        )
        .await
        .unwrap();
    assert_eq!(report.rewritten, 2, "{report:?}");
    assert!(report.skipped.is_empty(), "{report:?}");

    assert_eq!(
        disk_tags(&project_root, A),
        vec!["terminal", "ime", "mcp-tool"],
        "자리는 그대로, 그 자리의 말만 바뀐다"
    );
    assert_eq!(disk_tags(&project_root, B), vec!["ime"]);
    assert_eq!(
        disk_tags(&project_root, C),
        vec!["unrelated"],
        "무관은 불변"
    );

    let raw = std::fs::read_to_string(project_root.join(".oculpm/journal").join(A)).unwrap();
    let (pf, disk_body) = parse_frontmatter_and_body(&raw);
    assert_eq!(disk_body, body, "본문 바이트는 그대로");
    assert_eq!(pf.parsed.unwrap().session_id, "20260524-001");
}

/// 같은 일지가 `from` 을 둘 이상 갖고 있으면 하나로 접힌다 — 중복 태그는
/// 만들지 않는다.
#[tokio::test]
async fn two_sources_in_one_entry_collapse_into_one_tag() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_entry(&project_root, A, "[x] a\n", &["bug", "bugs", "terminal"]);
    manager.reindex_journal_cache(&db, 7).await.unwrap();

    let report = manager
        .merge_journal_tags(&db, 7, vec!["bugs".to_string()], "bug".to_string())
        .await
        .unwrap();
    assert_eq!(report.rewritten, 1);
    assert_eq!(disk_tags(&project_root, A), vec!["bug", "terminal"]);
}

/// 다시 눌러도 안전하다 — 두 번째 호출은 아무것도 안 쓰고 이유를 댄다.
#[tokio::test]
async fn merging_twice_is_a_no_op_that_says_so() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_entry(&project_root, A, "[x] a\n", &["bugs"]);
    manager.reindex_journal_cache(&db, 7).await.unwrap();

    manager
        .merge_journal_tags(&db, 7, vec!["bugs".to_string()], "bug".to_string())
        .await
        .unwrap();
    // 첫 병합 뒤 캐시에는 `bug` 만 남는다 — 두 번째는 후보 자체가 0건이다.
    let again = manager
        .merge_journal_tags(&db, 7, vec!["bugs".to_string()], "bug".to_string())
        .await
        .unwrap();
    assert_eq!(again.rewritten, 0);
    assert_eq!(disk_tags(&project_root, A), vec!["bug"]);
}

/// 출처 표식은 어휘가 아니다 — 대상으로도 원천으로도 못 쓴다.
#[tokio::test]
async fn source_marker_tags_are_not_mergeable() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_entry(&project_root, A, "[x] a\n", &["bug", "mcp-tool"]);
    manager.reindex_journal_cache(&db, 7).await.unwrap();

    assert!(manager
        .merge_journal_tags(&db, 7, vec!["bug".to_string()], "mcp-tool".to_string())
        .await
        .is_err());
    assert!(
        manager
            .merge_journal_tags(&db, 7, vec!["mcp-tool".to_string()], "bug".to_string())
            .await
            .is_err(),
        "남는 원천이 없으므로 거절"
    );
    assert_eq!(disk_tags(&project_root, A), vec!["bug", "mcp-tool"]);
}
