//! 037 `agent_session` — 대화 id 가 캐시를 왕복하는가.
//!
//! `tests.rs` 옆에 따로 둔 이유는 파일 크기 래칫이다: 저쪽은 이미 한계를 한참
//! 넘긴 채 "더 늘리지만 마라"로 묶여 있어, 새 주제를 얹을 자리가 없다. 주제가
//! 하나로 닫히므로 쪼개는 선도 여기가 자연스럽다.
//!
//! 이름이 `..._tests.rs` 인 것도 우연이 아니다 — 유출 원장 스캐너가 파일명
//! 꼬리(`tests.rs`)로 테스트를 가르므로, 다른 이름이면 테스트가 리댁션
//! 호출 자리로 세어져 `redact::CALL_SITE_FILES` 단언이 붉어진다.

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
    fs::write(&abs, format!("---\n{frontmatter}\n---\n{body}")).unwrap();
    abs
}

/// `tests.rs` 의 같은 이름 헬퍼와 **같은 몸통** — 프로젝트 기본 패턴을 쓴다.
/// 두 벌을 손으로 맞추지 않으려고 설정에서 읽는다.
fn default_redact() -> Vec<Regex> {
    crate::oculpm::redact::compile_redact_patterns(
        &crate::oculpm::spec::OculpmConfig::default_for_new_project()
            .git
            .auto_redact_patterns,
    )
}

/// 037 — `agent.session`(대화 id)이 캐시를 왕복한다.
///
/// 이 칸이 생기기 전에는 `get_entry` 의 하이드레이션이 `session: None` 을
/// 하드코딩해서, **캐시를 거친 모든 표면이 대화를 구별하지 못했다**. 디스크를
/// 직접 읽는 판정 경로만 값을 봤다.
#[tokio::test]
async fn agent_session_round_trips_through_the_cache() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");

    let rel = "20260524/Features_to_add/1000_feature_conv.md";
    let fm = "schema_version: 1\ntype: feature\nslug: conv\nstatus: done\n\
              created_at: \"2026-05-24T10:00:00+09:00\"\nsession_id: \"20260524-001\"\n\
              agent: { id: claude-code, version: \"Opus 5\", session: \"6a994a30-conv\" }\n\
              language: ko";
    write_entry(&journal_root, rel, fm, "[x] body\n");

    // 같은 작업 시간대(session_id)의 **다른 대화** — 두 값이 갈린다는 것이 요점.
    let rel2 = "20260524/Features_to_add/1001_feature_conv2.md";
    let fm2 = "schema_version: 1\ntype: feature\nslug: conv2\nstatus: done\n\
               created_at: \"2026-05-24T10:01:00+09:00\"\nsession_id: \"20260524-001\"\n\
               agent: { id: codex, session: \"b1c2d3e4-conv\" }\nlanguage: ko";
    write_entry(&journal_root, rel2, fm2, "[x] body\n");

    // 대화 id 를 모르는 에이전트 — 줄 자체가 없다.
    let rel3 = "20260524/Chores/1002_chore_noconv.md";
    let fm3 = "schema_version: 1\ntype: chore\nslug: noconv\nstatus: done\n\
               created_at: \"2026-05-24T10:02:00+09:00\"\nsession_id: \"20260524-001\"\n\
               agent: { id: manual }\nlanguage: ko";
    write_entry(&journal_root, rel3, fm3, "[x] body\n");

    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();

    let cache = JournalCache::new(&db);
    let a = cache.get_entry(1, rel).await.unwrap().expect("row");
    assert_eq!(
        a.frontmatter.agent.session.as_deref(),
        Some("6a994a30-conv")
    );
    assert_eq!(a.frontmatter.agent.version.as_deref(), Some("Opus 5"));

    let b = cache.get_entry(1, rel2).await.unwrap().expect("row");
    assert_eq!(
        b.frontmatter.agent.session.as_deref(),
        Some("b1c2d3e4-conv")
    );
    // 작업 시간대는 같지만 대화는 다르다 — 이 구별이 이 칸의 존재 이유다.
    assert_eq!(a.frontmatter.session_id, b.frontmatter.session_id);
    assert_ne!(a.frontmatter.agent.session, b.frontmatter.agent.session);

    let c = cache.get_entry(1, rel3).await.unwrap().expect("row");
    assert!(c.frontmatter.agent.session.is_none(), "모르면 None");
}

/// 이미 캐시에 있던 행(본문 해시 그대로)도 새 칸을 채운다 — `COERCION_VERSION`
/// 재투영 경로. 이게 없으면 037 은 **앞으로 쓸 일지에만** 걸리고 기존 일지는
/// 영원히 NULL 로 남는다.
#[tokio::test]
async fn agent_session_backfills_rows_cached_before_the_column_existed() {
    let (db, dir) = fresh_db().await;
    let journal_root = dir.path().join("journal");
    let rel = "20260524/Bugs/0925_bug_backfill.md";
    let fm = "schema_version: 1\ntype: bug\nslug: backfill\nstatus: done\n\
              created_at: \"2026-05-24T09:25:13+09:00\"\nsession_id: \"20260524-001\"\n\
              agent: { id: claude-code, session: \"old-conv\" }\nlanguage: ko";
    write_entry(&journal_root, rel, fm, "[x] body\n");

    JournalCache::with_redaction(&db, default_redact())
        .reindex_full(1, &journal_root)
        .await
        .unwrap();

    // 037 이전의 DB 를 흉내낸다: 칸을 비우고 재투영 도장을 옛 버전으로 되돌린다.
    db.conn()
        .call(|c| {
            c.execute(
                "UPDATE oculpm_journal SET agent_session = NULL, coercion_version = 1",
                [],
            )?;
            Ok::<_, tokio_rusqlite::Error>(())
        })
        .await
        .unwrap();
    assert!(JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .unwrap()
        .frontmatter
        .agent
        .session
        .is_none());

    // 본문은 한 글자도 안 바뀌었지만(= 전면 재작성 경로가 아니다) 재색인이 낫는다.
    JournalCache::with_redaction(&db, default_redact())
        .reindex_incremental(1, &journal_root)
        .await
        .unwrap();

    let healed = JournalCache::new(&db)
        .get_entry(1, rel)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        healed.frontmatter.agent.session.as_deref(),
        Some("old-conv")
    );
}
