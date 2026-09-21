//! 「잇기」 — `add_journal_related` 가 디스크 원본 frontmatter 의 `related` 에
//! 한 항목을 더하는 것의 테스트 ({#related-ui}).
//!
//! `tests.rs` 의 메타 편집 테스트 옆이 제자리지만 그 파일은 크기 래칫에 걸려
//! 있어(`scripts/check-file-sizes.mjs`) `tests_verified.rs` 처럼 형제 파일로
//! 둔다.

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
    manager.init_project(9, &project_root, "ko").await.unwrap();
    (manager, db, dir, project_root)
}

fn put_agent_entry(project_root: &Path, rel: &str, body: &str) {
    let abs = project_root.join(".oculpm/journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let content = format!(
        "---\nschema_version: 1\ntype: bug\nslug: agent-bug\nstatus: done\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\nrelated: []\ntags: []\n---\n{body}"
    );
    std::fs::write(&abs, content).unwrap();
}

const A: &str = "20260524/Bugs/0925_bug_a.md";
const B: &str = "20260520/Bugs/1010_bug_b.md";

/// 이어진 것은 **디스크에 남고**, 본문은 한 글자도 안 변한다 — 일지의 SSOT 는
/// 캐시가 아니라 그 파일이다.
#[tokio::test]
async fn linking_writes_the_ref_into_the_source_file_and_keeps_the_body() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let body = "[x] 워처가 멈췄다\n\n## 발생 원인\n\n큐가 막혔다.\n\n## 검증\n\n재현 2회\n";
    put_agent_entry(&project_root, A, body);
    put_agent_entry(&project_root, B, "[x] 예전에도 멈췄다\n\n## 검증\n\n있음\n");
    manager.reindex_journal_cache(&db, 9).await.unwrap();

    let entry = manager
        .add_journal_related(&db, 9, A.to_string(), B.to_string(), "followup".to_string())
        .await
        .unwrap();
    assert_eq!(entry.frontmatter.related.len(), 1, "캐시 투영에도 실린다");

    let raw = std::fs::read_to_string(project_root.join(".oculpm/journal").join(A)).unwrap();
    let (pf, disk_body) = parse_frontmatter_and_body(&raw);
    let fm = pf.parsed.expect("frontmatter parses");
    assert_eq!(fm.related.len(), 1);
    assert_eq!(fm.related[0].ref_path, B);
    assert_eq!(fm.related[0].kind, "followup");
    assert_eq!(disk_body, body, "본문 바이트는 그대로");
    // 다른 키도 살아 있다 (통째로 다시 쓰지만 값은 보존한다).
    assert_eq!(fm.slug, "agent-bug");
    assert_eq!(fm.files_touched.len(), 1);
    assert_eq!(fm.session_id, "20260524-001");
}

/// 접두 표기가 섞여 들어와도 같은 것으로 본다 — plan-log·검색 결과·사람이
/// 복붙하는 형태가 제각각이다.
#[tokio::test]
async fn a_prefixed_ref_is_normalized_before_it_is_written() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_agent_entry(&project_root, A, "[x] a\n");
    put_agent_entry(&project_root, B, "[x] b\n");
    manager.reindex_journal_cache(&db, 9).await.unwrap();

    manager
        .add_journal_related(
            &db,
            9,
            A.to_string(),
            format!(".oculpm/journal/{B}"),
            "blocks".to_string(),
        )
        .await
        .unwrap();
    let raw = std::fs::read_to_string(project_root.join(".oculpm/journal").join(A)).unwrap();
    let fm = parse_frontmatter_and_body(&raw).0.parsed.unwrap();
    assert_eq!(fm.related[0].ref_path, B);
}

/// 거절 넷. 특히 **중복**을 조용히 넘기지 않는 이유: 화면은 "이었어요" 라고
/// 말하는데 파일은 그대로이면, 그 거짓말을 확인할 길이 사용자에게 없다.
#[tokio::test]
async fn the_four_refusals() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_agent_entry(&project_root, A, "[x] a\n");
    put_agent_entry(&project_root, B, "[x] b\n");
    manager.reindex_journal_cache(&db, 9).await.unwrap();

    // 1. 규격 밖 kind
    assert!(manager
        .add_journal_related(&db, 9, A.to_string(), B.to_string(), "weird".to_string())
        .await
        .is_err());
    // 2. 자기 자신
    assert!(manager
        .add_journal_related(&db, 9, A.to_string(), A.to_string(), "followup".to_string())
        .await
        .is_err());
    // 3. 없는 대상
    assert!(manager
        .add_journal_related(
            &db,
            9,
            A.to_string(),
            "20260101/Bugs/0000_bug_nope.md".to_string(),
            "followup".to_string(),
        )
        .await
        .is_err());
    // 4. 이미 이어 둔 것 (kind 가 달라도 같은 대상이면 거절)
    manager
        .add_journal_related(&db, 9, A.to_string(), B.to_string(), "followup".to_string())
        .await
        .unwrap();
    assert!(manager
        .add_journal_related(
            &db,
            9,
            A.to_string(),
            B.to_string(),
            "duplicate".to_string()
        )
        .await
        .is_err());

    let raw = std::fs::read_to_string(project_root.join(".oculpm/journal").join(A)).unwrap();
    let fm = parse_frontmatter_and_body(&raw).0.parsed.unwrap();
    assert_eq!(fm.related.len(), 1, "거절은 파일을 안 건드린다");
}

/// 경로 탈출은 `..` 하나로 끝나지 않게 — 이 값은 프런트가 준 문자열이고
/// 곧바로 frontmatter 에 적힌다 (`resolve_entry_path` 와 같은 가드).
#[tokio::test]
async fn a_ref_cannot_escape_the_journal_root() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    put_agent_entry(&project_root, A, "[x] a\n");
    manager.reindex_journal_cache(&db, 9).await.unwrap();
    for bad in ["../../etc/passwd", "/etc/passwd", "20260524/../../x.md"] {
        assert!(
            manager
                .add_journal_related(
                    &db,
                    9,
                    A.to_string(),
                    bad.to_string(),
                    "followup".to_string()
                )
                .await
                .is_err(),
            "{bad} 는 거절돼야 한다"
        );
    }
}
