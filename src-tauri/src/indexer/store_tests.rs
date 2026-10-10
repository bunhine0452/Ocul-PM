use std::sync::Mutex;

use super::*;
use crate::embedding::EMBEDDING_DIM;
use crate::indexer::{reindex_single_file, IndexConfig};

/// 텍스트마다 결정적인 단위 벡터를 주고, 모델에 넘어온 텍스트를 모두 적어 둔다.
#[derive(Default)]
struct CountingEmbedder {
    seen: Mutex<Vec<String>>,
}

impl CountingEmbedder {
    fn seen(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

impl EmbedTexts for CountingEmbedder {
    fn embed_texts(
        &self,
        texts: Vec<String>,
    ) -> impl Future<Output = Result<Vec<Vec<f32>>, String>> + Send {
        self.seen.lock().unwrap().extend(texts.iter().cloned());
        std::future::ready(Ok(texts.iter().map(|t| fake_vector(t)).collect()))
    }
}

fn fake_vector(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; EMBEDDING_DIM];
    let h = blake3::hash(text.as_bytes());
    v[usize::from(h.as_bytes()[0]) % EMBEDDING_DIM] = 1.0;
    v
}

fn chunk(content: &str, line: u32) -> PendingChunk {
    PendingChunk {
        kind: "lines".into(),
        start_line: line,
        end_line: line + 1,
        content: content.into(),
    }
}

async fn setup() -> (tempfile::TempDir, Db, u32) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("t.db")).await.unwrap();
    let p = db
        .create_project("p".into(), "/tmp/p".into())
        .await
        .unwrap();
    (dir, db, p)
}

async fn upsert(db: &Db, p: u32, path: &str, hash: &str) -> u32 {
    db.upsert_file(p, path.into(), hash.into(), 1, 1, None)
        .await
        .unwrap()
        .0
}

/// 파일의 청크 — (내용, 벡터) 를 줄 순서로.
async fn rows(db: &Db, file_id: u32) -> Vec<(String, Vec<u8>)> {
    db.conn()
        .call(move |c| -> crate::error::Result<Vec<(String, Vec<u8>)>> {
            let mut stmt = c.prepare(
                "SELECT c.content, ce.embedding FROM chunks c
                   JOIN chunk_embeddings ce ON ce.chunk_id = c.id
                  WHERE c.file_id = ?1 ORDER BY c.start_line, c.id",
            )?;
            let out = stmt
                .query_map([file_id as i64], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(out)
        })
        .await
        .unwrap()
}

fn contents(rows: &[(String, Vec<u8>)]) -> Vec<&str> {
    rows.iter().map(|(c, _)| c.as_str()).collect()
}

/// 저장할 때마다 파일 전체를 다시 임베딩하던 자리 — 바뀐 청크만 모델에 간다.
/// 남은 행은 새 목록 그대로(옛 행이 덧붙어 남지 않는다)이고, 가져온 벡터는
/// 원래 것과 바이트까지 같다.
#[tokio::test]
async fn a_save_reembeds_only_the_changed_chunk() {
    let (_dir, db, p) = setup().await;
    let emb = CountingEmbedder::default();
    let f = upsert(&db, p, "src/a.rs", "h1").await;
    let first = vec![
        chunk("fn a() {}", 1),
        chunk("fn b() {}", 3),
        chunk("fn c() {}", 5),
    ];
    let s = store_file_chunks(&db, &emb, p, f, "h1", first)
        .await
        .unwrap();
    assert_eq!(
        s,
        Stored {
            inserted: 3,
            embedded: 3
        }
    );

    upsert(&db, p, "src/a.rs", "h2").await;
    let second = vec![
        chunk("fn a() {}", 1),
        chunk("fn b2() {}", 3),
        chunk("fn c() {}", 5),
    ];
    let s = store_file_chunks(&db, &emb, p, f, "h2", second)
        .await
        .unwrap();
    assert_eq!(
        s,
        Stored {
            inserted: 3,
            embedded: 1
        }
    );
    assert_eq!(emb.seen().last().map(String::as_str), Some("fn b2() {}"));

    let got = rows(&db, f).await;
    assert_eq!(contents(&got), vec!["fn a() {}", "fn b2() {}", "fn c() {}"]);
    for (content, bytes) in &got {
        assert_eq!(bytes, &vec_to_bytes(&fake_vector(content)), "{content}");
    }
}

/// 통째로 복사된 폴더(설치본의 `ioreum` 세 벌) — 같은 내용의 파일은 모델을 부르지
/// 않고, 복사된 벡터로 두 파일 모두 의미 검색에 걸린다.
#[tokio::test]
async fn a_copied_file_borrows_its_twins_vectors() {
    let (_dir, db, p) = setup().await;
    let emb = CountingEmbedder::default();
    let body = || vec![chunk("fn a() {\n}", 1), chunk("fn b() {\n}", 4)];
    let a = upsert(&db, p, "app/a.rs", "same").await;
    store_file_chunks(&db, &emb, p, a, "same", body())
        .await
        .unwrap();
    let copy = upsert(&db, p, "app-copy/a.rs", "same").await;
    let s = store_file_chunks(&db, &emb, p, copy, "same", body())
        .await
        .unwrap();
    assert_eq!(
        s,
        Stored {
            inserted: 2,
            embedded: 0
        }
    );
    assert_eq!(emb.seen().len(), 2);

    let hits = db
        .search_chunks(p, vec_to_bytes(&fake_vector("fn a() {\n}")), 2, false, true)
        .await
        .unwrap();
    let mut paths: Vec<String> = hits.into_iter().map(|h| h.file_path).collect();
    paths.sort();
    assert_eq!(paths, vec!["app-copy/a.rs", "app/a.rs"]);
}

#[tokio::test]
async fn repeated_text_inside_one_file_is_embedded_once() {
    let (_dir, db, p) = setup().await;
    let emb = CountingEmbedder::default();
    let f = upsert(&db, p, "a.rs", "h").await;
    let list = vec![chunk("}", 1), chunk("fn x() {}", 2), chunk("}", 3)];
    let s = store_file_chunks(&db, &emb, p, f, "h", list).await.unwrap();
    assert_eq!(
        s,
        Stored {
            inserted: 3,
            embedded: 2
        }
    );
}

/// 같은 파일의 증분 둘이 겹칠 때 — 늦게 끝난 옛 내용이 새 내용 위에 덧붙지 않는다.
#[tokio::test]
async fn a_writer_holding_an_old_hash_writes_nothing() {
    let (_dir, db, p) = setup().await;
    let emb = CountingEmbedder::default();
    let f = upsert(&db, p, "a.rs", "old").await;
    upsert(&db, p, "a.rs", "new").await;
    let stale = store_file_chunks(&db, &emb, p, f, "old", vec![chunk("old body", 1)])
        .await
        .unwrap();
    assert_eq!(stale.inserted, 0);
    store_file_chunks(&db, &emb, p, f, "new", vec![chunk("new body", 1)])
        .await
        .unwrap();
    assert_eq!(contents(&rows(&db, f).await), vec!["new body"]);
}

#[tokio::test]
async fn an_empty_chunk_list_clears_the_old_rows() {
    let (_dir, db, p) = setup().await;
    let emb = CountingEmbedder::default();
    let f = upsert(&db, p, "a.rs", "h1").await;
    store_file_chunks(&db, &emb, p, f, "h1", vec![chunk("x", 1)])
        .await
        .unwrap();
    upsert(&db, p, "a.rs", "h2").await;
    store_file_chunks(&db, &emb, p, f, "h2", Vec::new())
        .await
        .unwrap();
    assert!(rows(&db, f).await.is_empty());
}

/// 설치본 17.8% 사본의 원인 — 워처 증분이 `changed=false` 를 무시하고 청크·심볼을
/// 또 넣었다. 같은 내용으로 두 번 오면 두 번째는 아무것도 하지 않는다.
#[tokio::test]
async fn reindexing_unchanged_content_adds_nothing() {
    let (dir, db, p) = setup().await;
    let root = dir.path().join("proj");
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("src/a.rs"),
        "fn a() {\n    1;\n}\n\nfn b() {\n    2;\n}\n",
    )
    .unwrap();
    let emb = CountingEmbedder::default();
    let cfg = IndexConfig::default();
    let first = reindex_single_file(&db, &emb, p, &root, &cfg, "src/a.rs")
        .await
        .unwrap();
    assert!(first.0 > 0);
    let embedded = emb.seen().len();
    let again = reindex_single_file(&db, &emb, p, &root, &cfg, "src/a.rs")
        .await
        .unwrap();
    assert_eq!(again, (0, 0));
    assert_eq!(emb.seen().len(), embedded);
    assert_eq!(db.count_chunks(p).await.unwrap(), first.0);
}
