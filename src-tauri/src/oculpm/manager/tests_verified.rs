//! 확인은 내용에 묶인다 ({#reviewed-hash}, 2026-09-15) — `set_journal_verified`
//! 가 본문 해시를 적고, 캐시 투영이 그 해시로 `verified_stale` 를 정하는 것의
//! 테스트. `tests.rs` 의 `set_journal_verified_*` 옆이 제자리지만 그 파일은
//! 크기 래칫에 걸려 있어(`scripts/check-file-sizes.mjs`) `tests_teardown.rs`
//! 처럼 형제 파일로 둔다.

use super::*;
use crate::db::Db;
use crate::oculpm::cache::{EntryFilters, PathChangeKind};

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

/// 에이전트가 쓴 것처럼 디스크에 직접 놓는다 (수동 작성 경로는 마스킹·
/// `verified_by_user: true` 기본값이 끼어들어 이 시나리오와 다르다).
fn put_agent_entry(project_root: &Path, rel: &str, extra_fm: &str, body: &str) {
    let abs = project_root.join(".oculpm/journal").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let content = format!(
        "---\nschema_version: 1\ntype: bug\nslug: agent-bug\nstatus: done\ncreated_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\nagent: {{ id: claude-code }}\nlanguage: ko\nfiles_touched:\n  - path: \"src/a.rs\"\n    op: update\n{extra_fm}---\n{body}"
    );
    std::fs::write(&abs, content).unwrap();
}

/// 워처가 타는 그 길 — 디스크의 지금 상태를 캐시에 다시 투영한다.
async fn reproject(manager: &OculpmManager, db: &Db, project_root: &Path, rel: &str) {
    let root = project_root.join(".oculpm/journal");
    let redact = manager.redact_patterns(7).await;
    JournalCache::with_redaction(db, redact)
        .with_tz(manager.tz_for(7).await)
        .apply_path_change(7, &root, rel, PathChangeKind::Modified)
        .await
        .unwrap();
}

async fn verified_only_count(manager: &OculpmManager, db: &Db) -> usize {
    manager
        .list_journal_entries(
            db,
            7,
            None,
            EntryFilters {
                verified_only: true,
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .len()
}

#[tokio::test]
async fn set_journal_verified_records_body_hash() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let rel = "20260524/Bugs/0925_bug_hash.md";
    put_agent_entry(
        &project_root,
        rel,
        "",
        "[x] agent did a thing\n\n## 내용\n본문\n",
    );
    manager.reindex_journal_cache(&db, 7).await.unwrap();
    let abs = project_root.join(".oculpm/journal").join(rel);

    // 확인 → 프론트매터에 지금 본문의 해시가 같이 적힌다.
    manager
        .set_journal_verified(&db, 7, rel.to_string(), true)
        .await
        .unwrap();
    let raw = std::fs::read_to_string(&abs).unwrap();
    let (pf, body) = parse_frontmatter_and_body(&raw);
    let fm = pf.parsed.expect("parsed after verify");
    assert!(fm.verified_by_user);
    assert_eq!(
        fm.verified_hash.as_deref(),
        Some(verified_body_hash(&body).as_str()),
        "해시는 디스크 본문 그대로에서 나온다:\n{raw}"
    );
    assert!(raw.contains("verified_hash: \"blake3:"), "{raw}");
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .expect("cached");
    assert!(cached.frontmatter.verified_by_user);
    assert!(!cached.verified_stale, "방금 확인한 본문은 오래되지 않았다");

    // 해제 → 해시 줄이 사라진다 (남겨 두면 다음 확인과 무관한 값이 된다).
    manager
        .set_journal_verified(&db, 7, rel.to_string(), false)
        .await
        .unwrap();
    let raw = std::fs::read_to_string(&abs).unwrap();
    assert!(raw.contains("verified_by_user: false"), "{raw}");
    assert!(!raw.contains("verified_hash"), "{raw}");
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(!cached.frontmatter.verified_by_user);
    assert!(!cached.verified_stale);
}

#[tokio::test]
async fn body_change_after_verify_marks_stale() {
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let rel = "20260524/Bugs/0925_bug_stale.md";
    put_agent_entry(
        &project_root,
        rel,
        "",
        "[x] agent did a thing\n\n## 내용\n첫 본문\n",
    );
    manager.reindex_journal_cache(&db, 7).await.unwrap();
    manager
        .set_journal_verified(&db, 7, rel.to_string(), true)
        .await
        .unwrap();

    // 에이전트가 확인 뒤 본문을 고친다 — 프론트매터(해시 포함)는 그대로.
    let abs = project_root.join(".oculpm/journal").join(rel);
    let raw = std::fs::read_to_string(&abs).unwrap();
    assert!(raw.contains("verified_hash:"), "{raw}");
    std::fs::write(&abs, raw.replace("첫 본문", "고친 본문")).unwrap();
    reproject(&manager, &db, &project_root, rel).await;

    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .expect("cached");
    assert!(
        cached.frontmatter.verified_by_user,
        "플래그 자체는 디스크 그대로"
    );
    assert!(cached.verified_stale, "확인 뒤 바뀐 본문 → 다시 검토");

    // 「확인됨」으로 세지 않는다 — 목록 필터도, 변경 그룹 머리글도.
    assert_eq!(verified_only_count(&manager, &db).await, 0);
    let all = manager
        .list_journal_entries(&db, 7, None, EntryFilters::default())
        .await
        .unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].verified_by_user && all[0].verified_stale);
    let groups = JournalCache::new(&db)
        .group_changes(7, vec!["src/a.rs".to_string()])
        .await
        .unwrap();
    assert_eq!(groups[0].entry_path.as_deref(), Some(rel));
    assert_eq!(groups[0].verified_by_user, Some(true));
    assert_eq!(groups[0].verified_stale, Some(true));

    // 다시 검토 = 같은 커맨드에 true — 해시가 지금 본문으로 다시 묶인다.
    manager
        .set_journal_verified(&db, 7, rel.to_string(), true)
        .await
        .unwrap();
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(cached.frontmatter.verified_by_user);
    assert!(!cached.verified_stale, "재확인 뒤에는 오래되지 않았다");
    let raw = std::fs::read_to_string(&abs).unwrap();
    let (pf, body) = parse_frontmatter_and_body(&raw);
    assert_eq!(
        pf.parsed.unwrap().verified_hash.as_deref(),
        Some(verified_body_hash(&body).as_str())
    );
    assert_eq!(verified_only_count(&manager, &db).await, 1);
}

#[tokio::test]
async fn legacy_verified_without_hash_is_not_stale() {
    // 이 키가 생기기 전에 확인된 일지(실제 저장소의 8건) — 해시가 없으니
    // 대조할 것이 없고, 그대로 유효하다. 디스크 백필도 하지 않는다.
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let rel = "20260524/Bugs/0925_bug_legacy.md";
    put_agent_entry(
        &project_root,
        rel,
        "verified_by_user: true\n",
        "[x] verified long ago\n\n## 내용\n옛 본문\n",
    );
    manager.reindex_journal_cache(&db, 7).await.unwrap();
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .expect("cached");
    assert!(cached.frontmatter.verified_by_user);
    assert_eq!(cached.frontmatter.verified_hash, None);
    assert!(
        !cached.verified_stale,
        "해시 없는 확인은 오래된 것이 아니다"
    );

    // 본문이 바뀌어도 마찬가지 — 묶인 내용이 없으니 떨어질 것도 없다.
    let abs = project_root.join(".oculpm/journal").join(rel);
    let raw = std::fs::read_to_string(&abs).unwrap();
    std::fs::write(&abs, raw.replace("옛 본문", "새 본문")).unwrap();
    reproject(&manager, &db, &project_root, rel).await;
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(cached.frontmatter.verified_by_user);
    assert!(!cached.verified_stale);
    assert_eq!(
        verified_only_count(&manager, &db).await,
        1,
        "여전히 「확인됨」으로 센다"
    );
    let on_disk = std::fs::read_to_string(&abs).unwrap();
    assert!(
        !on_disk.contains("verified_hash"),
        "디스크 백필 없음:\n{on_disk}"
    );
}

#[tokio::test]
async fn verify_binds_the_pre_redaction_body_so_a_masked_projection_is_not_stale() {
    // 해시는 마스킹 **전** 디스크 본문에 묶이고 투영도 같은 본문을 해시한다 —
    // 비밀이 든 일지(캐시에는 [REDACTED] 로 들어간다)를 확인해도 거짓 「다시
    // 검토」가 되지 않는다. 마스킹된 `body.raw` 를 해시했다면 여기서 깨진다.
    let (manager, db, _dir, project_root) = fresh_manager_and_db().await;
    let rel = "20260524/Bugs/0925_bug_secret.md";
    put_agent_entry(
        &project_root,
        rel,
        "",
        "[x] leaked\n\napi key: AKIAABCDEFGHIJKLMNOP done\n",
    );
    manager.reindex_journal_cache(&db, 7).await.unwrap();
    manager
        .set_journal_verified(&db, 7, rel.to_string(), true)
        .await
        .unwrap();
    // 워처 재투영을 한 번 더 — 프론트매터만 바뀐 파일을 마스킹 캐시가 다시 읽는다.
    reproject(&manager, &db, &project_root, rel).await;
    let cached = manager
        .get_journal_entry(&db, 7, rel.to_string())
        .await
        .unwrap()
        .expect("cached");
    assert!(
        cached.body_markdown.contains("[REDACTED]"),
        "캐시는 마스킹된 채"
    );
    assert!(cached.frontmatter.verified_by_user);
    assert!(
        !cached.verified_stale,
        "마스킹은 내용 변경이 아니다 — 확인은 그대로 유효"
    );
    assert_eq!(verified_only_count(&manager, &db).await, 1);
}
