//! 증거 등급 규칙이 바뀌면 본문이 그대로인 일지도 다시 매긴다 (COERCION_VERSION 5, 2026-11-23).
//!
//! `tests.rs` 옆에 따로 둔 이유는 `agent_session_tests.rs` 와 같다(파일 크기 래칫 · 유출 원장의 `*tests.rs` 꼬리).
//! 「설치본에서 눈으로 보지는 않았다」 를 미검증으로 읽게 된 뒤에도, 이미 캐시에 등급 2 로 들어간 일지는 본문 해시가
//! 같아 전면 재작성을 타지 않는다 — 자기치유 UPDATE 가 등급을 함께 고치지 않으면 회색 ✓ 가 영영 남았다.

use super::*;
use crate::db::Db;
use std::fs;
use tempfile::tempdir;

#[tokio::test]
async fn evidence_is_regraded_for_rows_cached_by_an_older_rule() {
    let dir = tempdir().unwrap();
    let db = Db::open(dir.path().join("test.db")).await.expect("open db");
    let journal_root = dir.path().join("journal");
    let rel = "20261123/Features_to_add/0900_feature_unseen.md";
    let abs = journal_root.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let fm = "schema_version: 1\ntype: feature\nslug: unseen\nstatus: done\n\
              created_at: \"2026-11-23T09:00:00+09:00\"\nsession_id: \"20261123-001\"\n\
              agent: { id: claude-code }\nlanguage: ko";
    let body = "[x] 화면: 무엇을 했다\n\n## 검증\n`pnpm test` 통과. 설치본에서 눈으로 보지는 않았다.\n";
    fs::write(&abs, format!("---\n{fm}\n---\n{body}")).unwrap();

    JournalCache::new(&db)
        .reindex_full(1, &journal_root)
        .await
        .unwrap();

    // 옛 규칙이 매긴 행을 흉내낸다 — 등급 2(명령 있음) · 옛 재투영 도장.
    db.conn()
        .call(|c| {
            c.execute(
                "UPDATE oculpm_journal SET evidence = 2, coercion_version = 4",
                [],
            )?;
            Ok::<_, tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();

    // 본문은 한 글자도 안 바뀌었다 — 자기치유 경로만 탄다.
    JournalCache::new(&db)
        .reindex_incremental(1, &journal_root)
        .await
        .unwrap();

    let rows = JournalCache::new(&db)
        .range_entries(1, "20261123", "20261123")
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].evidence,
        crate::oculpm::evidence::SECTION,
        "스스로 안 봤다고 적은 일지가 회색 ✓ 로 남았다"
    );
}
