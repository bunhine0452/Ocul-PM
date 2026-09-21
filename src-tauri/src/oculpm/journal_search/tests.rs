//! 랭킹({#search-rank})과 캐시 조회({#search-cache})의 단위 테스트.
//!
//! 랭킹은 순수 함수라 파일도 DB 도 없이 문다. 캐시 조회는 마이그레이션 SQL 을
//! 그대로 먹인 임시 DB 위에서 문다 — 스키마가 바뀌면 여기가 먼저 깨진다.

use super::cache::{fetch_rows, SqlFilters};
use super::*;

use rusqlite::Connection;

fn row(path: &str, workday: &str, title: &str, body: &str) -> SearchRow {
    SearchRow {
        relative_path: path.to_string(),
        workday: workday.to_string(),
        type_token: "bug".to_string(),
        status_token: "done".to_string(),
        title: title.to_string(),
        slug: "slug".to_string(),
        tags: Vec::new(),
        files: Vec::new(),
        body: body.to_string(),
        file_hit: None,
    }
}

fn paths(hits: &[Scored]) -> Vec<&str> {
    hits.iter().map(|h| h.row.relative_path.as_str()).collect()
}

#[test]
fn tokenize_splits_on_whitespace_and_lowercases() {
    assert_eq!(tokenize(Some("  IME  버그 ")), vec!["ime", "버그"]);
    assert!(tokenize(Some("   ")).is_empty());
    assert!(tokenize(None).is_empty());
}

/// 이 라운드가 고치려는 결함 그 자체: 원인이 적힌 **오래된** 일지가 최근의
/// 우연한 본문 부분 일치 아래로 묻힌다.
#[test]
fn an_old_title_match_outranks_a_recent_body_match() {
    let rows = vec![
        row(
            "20260820/Chores/1000_chore_noise.md",
            "20260820",
            "캐시 정리",
            "mtime 을 비교한다.",
        ),
        row(
            "20260610/Bugs/0900_bug_terminal-ime.md",
            "20260610",
            "터미널 IME 입력 깨짐",
            "본문.",
        ),
    ];
    let hits = rank(rows, &tokenize(Some("ime")));
    assert_eq!(
        paths(&hits),
        vec![
            "20260610/Bugs/0900_bug_terminal-ime.md",
            "20260820/Chores/1000_chore_noise.md",
        ],
        "제목 매치가 두 달 더 오래됐어도 위여야 한다"
    );
    assert_eq!(hits[0].matched, MatchedIn::Title);
    assert_eq!(hits[0].why(), "title");
}

/// 필드 등급 전체 — 제목 > 태그 > 슬러그 > 경로 > 본문.
#[test]
fn field_weights_order_the_whole_ladder() {
    let mut tagged = row("20260601/Bugs/0900_bug_a.md", "20260601", "무관", "무관");
    tagged.tags = vec!["IME".to_string()];
    let mut slugged = row("20260602/Bugs/0900_bug_b.md", "20260602", "무관", "무관");
    slugged.slug = "ime-fix".to_string();
    let mut filed = row("20260603/Bugs/0900_bug_c.md", "20260603", "무관", "무관");
    filed.files = vec!["src/ime/input.rs".to_string()];
    let bodied = row(
        "20260604/Bugs/0900_bug_d.md",
        "20260604",
        "무관",
        "mtime 이야기",
    );
    let titled = row(
        "20260605/Bugs/0900_bug_e.md",
        "20260605",
        "IME 깨짐",
        "무관",
    );

    let hits = rank(
        vec![bodied, filed, slugged, tagged, titled],
        &tokenize(Some("ime")),
    );
    assert_eq!(
        paths(&hits),
        vec![
            "20260605/Bugs/0900_bug_e.md", // 제목
            "20260601/Bugs/0900_bug_a.md", // 태그 (가장 오래됐는데도 2위)
            "20260602/Bugs/0900_bug_b.md", // 슬러그
            "20260603/Bugs/0900_bug_c.md", // 파일 경로
            "20260604/Bugs/0900_bug_d.md", // 본문 (가장 최신인데도 꼴찌)
        ]
    );
    // 소문자 태그로 어디서 걸렸는지 밝힌다 (옛 도구 계약 그대로).
    assert_eq!(hits[1].why(), "tag:ime");
    assert_eq!(hits[3].why(), "path:src/ime/input.rs");
}

/// 최신성은 **가산**이지 등급이 아니다 — 같은 필드 안에서만 순서를 가른다.
#[test]
fn recency_breaks_ties_within_one_field_but_never_across_fields() {
    let old_body = row(
        "20260101/Bugs/0900_bug_a.md",
        "20260101",
        "무관",
        "ime 이야기",
    );
    let new_body = row(
        "20260901/Bugs/0900_bug_b.md",
        "20260901",
        "무관",
        "ime 이야기",
    );
    let hits = rank(vec![old_body, new_body], &tokenize(Some("ime")));
    assert_eq!(
        paths(&hits),
        vec!["20260901/Bugs/0900_bug_b.md", "20260101/Bugs/0900_bug_a.md"],
        "같은 본문 매치면 최신이 위"
    );
    assert!(
        hits[0].score - hits[1].score <= RECENCY_MAX,
        "최신성 가산이 상한을 넘었다"
    );
    // 가중치표의 불변식 — 최신성 가산이 **가장 좁은** 필드 간격보다 작아야
    // 등급이 안 뒤집힌다. 상수라 컴파일 시점에 못박는다.
    const _: () = assert!(RECENCY_MAX < W_PATH - W_BODY);
}

/// 다중 토큰은 토큰별 최고 필드를 합산한다 — 두 칸 다 걸린 쪽이 위.
#[test]
fn multi_token_scores_are_summed_per_token() {
    let both = row(
        "20260101/Bugs/0900_bug_both.md",
        "20260101",
        "무관",
        "터미널 이야기와 ime 이야기",
    );
    let one = row(
        "20260901/Bugs/0900_bug_one.md",
        "20260901",
        "무관",
        "ime 이야기만",
    );
    let hits = rank(vec![both, one], &tokenize(Some("터미널 ime")));
    assert_eq!(
        paths(&hits),
        vec!["20260101/Bugs/0900_bug_both.md"],
        "토큰 하나가 안 걸린 일지는 후보가 아니다 (AND)"
    );
}

/// 질의 전체가 한 필드에 통째로 걸리면 흩어져 걸린 쪽보다 위.
#[test]
fn a_whole_phrase_match_beats_two_scattered_tokens() {
    let phrase = row(
        "20260101/Bugs/0900_bug_p.md",
        "20260101",
        "무관",
        "터미널 ime 가 깨진다",
    );
    let scattered = row(
        "20260101/Bugs/0900_bug_s.md",
        "20260101",
        "무관",
        "ime 는 멀쩡하다. 터미널 도 멀쩡하다.",
    );
    let hits = rank(vec![scattered, phrase], &tokenize(Some("터미널 ime")));
    assert_eq!(paths(&hits)[0], "20260101/Bugs/0900_bug_p.md");
}

/// 질의가 없으면 필터 결과를 최신순으로 — 옛 도구의 계약 그대로.
#[test]
fn without_a_query_everything_stays_newest_first() {
    let hits = rank(
        vec![
            row("20260101/Bugs/0900_bug_a.md", "20260101", "가", "본문"),
            row("20260901/Bugs/0900_bug_b.md", "20260901", "나", "본문"),
            row("20260901/Bugs/1800_bug_c.md", "20260901", "다", "본문"),
        ],
        &[],
    );
    assert_eq!(
        paths(&hits),
        vec![
            "20260901/Bugs/1800_bug_c.md", // 같은 날이면 늦은 시각이 위
            "20260901/Bugs/0900_bug_b.md",
            "20260101/Bugs/0900_bug_a.md",
        ]
    );
    assert_eq!(hits[0].matched, MatchedIn::FilterOnly);
}

/// 본문 매치의 `why` 는 매치 **근방** 발췌다 — TSV 한 칸에 들어가야 하므로
/// 줄바꿈·탭이 없어야 한다.
#[test]
fn a_body_hit_carries_a_snippet_around_the_match() {
    let r = row(
        "20260101/Bugs/0900_bug_a.md",
        "20260101",
        "무관",
        "## 발생 원인\n\n키를\t정규화하지 않았다.\n",
    );
    let hits = rank(vec![r], &tokenize(Some("정규화")));
    let why = hits[0].why();
    assert!(why.contains("정규화"), "{why}");
    assert!(!why.contains('\t') && !why.contains('\n'), "{why}");
}

// ─── 캐시 조회 ───────────────────────────────────────────────────────────────

fn seeded_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(include_str!("../../../migrations/012_oculpm_journal.sql"))
        .unwrap();
    conn
}

fn insert(conn: &Connection, rel: &str, workday: &str, ty: &str, title: &str, body: &str) {
    conn.execute(
        "INSERT INTO oculpm_journal (project_id, relative_path, workday, type, slug, status,
             title, session_id, agent_id, language, created_at, file_mtime, body_markdown,
             body_md_hash, parse_ok)
         VALUES (1, ?1, ?2, ?3, 'slug', 'done', ?4, 'manual-1', 'claude-code', 'ko',
                 '2026-07-01T10:00:00+09:00', 0, ?5, 'h', 1)",
        rusqlite::params![rel, workday, ty, title, body],
    )
    .unwrap();
}

#[test]
fn cache_rows_carry_tags_and_files_and_respect_the_structural_filters() {
    let conn = seeded_db();
    insert(
        &conn,
        "20260701/Bugs/0900_bug_a.md",
        "20260701",
        "bug",
        "캐시 무효화",
        "키를 정규화하지 않았다.",
    );
    insert(
        &conn,
        "20260815/Features_to_add/1400_feature_b.md",
        "20260815",
        "feature",
        "워처 이벤트",
        "본문",
    );
    conn.execute(
        "INSERT INTO oculpm_journal_tags VALUES (1, '20260701/Bugs/0900_bug_a.md', 'cache')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO oculpm_journal_files VALUES (1, '20260815/Features_to_add/1400_feature_b.md',
         'src/oculpm/watcher.rs', 'update', NULL, NULL)",
        [],
    )
    .unwrap();

    let all = fetch_rows(&conn, 1, &SqlFilters::default()).unwrap();
    assert_eq!(all.len(), 2);

    let typed = fetch_rows(
        &conn,
        1,
        &SqlFilters {
            types: vec!["feature".to_string()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(typed.len(), 1);
    assert_eq!(typed[0].files, vec!["src/oculpm/watcher.rs"]);

    let tagged = fetch_rows(
        &conn,
        1,
        &SqlFilters {
            tags: vec!["cache".to_string()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(tagged.len(), 1);
    assert_eq!(tagged[0].tags, vec!["cache"]);

    let ranged = fetch_rows(
        &conn,
        1,
        &SqlFilters {
            since: Some("20260801".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(ranged.len(), 1);

    // file 필터는 어느 경로로 걸렸는지까지 남긴다.
    let filed = fetch_rows(
        &conn,
        1,
        &SqlFilters {
            file: Some("watcher.rs".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(filed.len(), 1);
    assert_eq!(filed[0].file_hit.as_deref(), Some("src/oculpm/watcher.rs"));
}

/// frontmatter 를 못 읽은 행의 종류는 파일명 토큰이 메운다 — 디스크 경로와
/// 같은 판정이어야 한다.
#[test]
fn an_unparseable_row_falls_back_to_the_filename_token() {
    let conn = seeded_db();
    insert(
        &conn,
        "20260805/Bugs/0800_bug_broken.md",
        "20260805",
        "chore",
        "망가진 일지",
        "터미널 IME 문제.",
    );
    conn.execute(
        "UPDATE oculpm_journal SET parse_ok = 0 WHERE relative_path = '20260805/Bugs/0800_bug_broken.md'",
        [],
    )
    .unwrap();
    let rows = fetch_rows(&conn, 1, &SqlFilters::default()).unwrap();
    assert_eq!(rows[0].type_token, "bug");
    assert_eq!(rows[0].status_token, "?");
}
