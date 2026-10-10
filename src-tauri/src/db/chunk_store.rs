//! 청크 적재의 DB 쪽 — 재사용할 벡터 찾기와 파일 청크 통째로 바꾸기
//! (`indexer::store`, 2026-10-08 검토 `{#idx-low-value}`).

use std::collections::HashMap;

use super::*;

impl Db {
    /// 다시 임베딩하지 않아도 되는 벡터 — 내용 → 임베딩 바이트.
    ///
    /// 후보는 둘이다: 이 파일의 **지금** 청크(저장할 때 안 바뀐 함수들), 그리고
    /// 내용이 같은(`files.hash`, `idx_files_hash`) 다른 파일 하나의 청크(복사된
    /// 폴더). 설치본에서 파일 사이 사본의 79%(13,947 / 17,728)가 통째 사본이었다 —
    /// 나머지(부분 사본, 청크의 3.4%)는 청크마다 내용 해시 열이 있어야 잡히는데,
    /// 그 열을 채우려면 청크 11만 행(본문 182MB)을 통째로 다시 써야 한다.
    pub async fn reusable_embeddings(
        &self,
        file_id: u32,
        file_hash: String,
    ) -> Result<HashMap<String, Vec<u8>>> {
        let found = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT c.content, ce.embedding
                       FROM chunks c
                       JOIN chunk_embeddings ce ON ce.chunk_id = c.id
                      WHERE c.file_id IN (?1, (SELECT f.id FROM files f
                                                WHERE f.hash = ?2 AND f.id <> ?1
                                                  AND EXISTS (SELECT 1 FROM chunks x
                                                               WHERE x.file_id = f.id)
                                                LIMIT 1))",
                )?;
                let rows = stmt.query_map(params![file_id as i64, &file_hash], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
                })?;
                let mut out = HashMap::new();
                for row in rows {
                    let (content, embedding) = row?;
                    out.insert(content, embedding);
                }
                Ok(out)
            })
            .await?;
        Ok(found)
    }

    /// `file_id` 의 청크를 `rows` 로 통째로 바꾼다 — `files.hash` 가 아직
    /// `file_hash` 일 때만 (CAS). 바꿨으면 `Some(행 수)`, 그 사이 파일이 다른
    /// 내용으로 갱신됐거나 지워졌으면 `None` (아무것도 쓰지 않는다).
    pub async fn replace_file_chunks(
        &self,
        project_id: u32,
        file_id: u32,
        file_hash: String,
        rows: Vec<ChunkInsert>,
    ) -> Result<Option<usize>> {
        let written = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                let current: Option<String> = tx
                    .query_row(
                        "SELECT hash FROM files WHERE id = ?1",
                        [file_id as i64],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.as_deref() != Some(file_hash.as_str()) {
                    return Ok(None);
                }
                tx.execute("DELETE FROM chunks WHERE file_id = ?1", [file_id as i64])?;
                insert_chunk_rows(&tx, project_id, file_id, &rows)?;
                tx.commit()?;
                Ok(Some(rows.len()))
            })
            .await?;
        Ok(written)
    }
}

/// 청크+임베딩 행들을 열린 트랜잭션에 넣는다 — `prepare_cached` 로 문장은 한 번만
/// 파싱한다. `project_id` 는 vec0 partition key (032): KNN 이 이 프로젝트 파티션만 돈다.
pub(super) fn insert_chunk_rows(
    tx: &rusqlite::Transaction<'_>,
    project_id: u32,
    file_id: u32,
    rows: &[ChunkInsert],
) -> rusqlite::Result<()> {
    let mut insert_chunk = tx.prepare_cached(
        "INSERT INTO chunks (file_id, kind, start_line, end_line, content)
         VALUES (?, ?, ?, ?, ?)",
    )?;
    let mut insert_embedding = tx.prepare_cached(
        "INSERT INTO chunk_embeddings (chunk_id, project_id, embedding)
         VALUES (?, ?, ?)",
    )?;
    for row in rows {
        insert_chunk.execute(params![
            file_id as i64,
            &row.kind,
            row.start_line as i64,
            row.end_line as i64,
            &row.content,
        ])?;
        let chunk_id = tx.last_insert_rowid();
        insert_embedding.execute(params![chunk_id, project_id as i64, &row.embedding])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(content: &str, line: u32) -> ChunkInsert {
        let mut v = vec![0f32; 384];
        v[line as usize] = 1.0;
        ChunkInsert {
            kind: "lines".into(),
            start_line: line,
            end_line: line + 1,
            content: content.into(),
            embedding: v.iter().flat_map(|f| f.to_le_bytes()).collect(),
        }
    }

    /// 041 — 같은 파일 · 같은 범위 · 같은 내용의 사본은 하나만 남고, 벡터도 따라
    /// 지워진다. 다른 파일의 같은 내용(복사된 폴더)과 같은 파일의 다른 범위는 남는다.
    #[tokio::test]
    async fn migration_041_keeps_one_row_per_duplicate_group() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let p = db
            .create_project("p".into(), "/tmp/p".into())
            .await
            .unwrap();
        let (a, _) = db
            .upsert_file(p, "a.rs".into(), "h".into(), 1, 1, None)
            .await
            .unwrap();
        let (b, _) = db
            .upsert_file(p, "copy/a.rs".into(), "h".into(), 1, 1, None)
            .await
            .unwrap();
        for _ in 0..3 {
            db.insert_chunks_with_embeddings(p, a, vec![row("fn a() {}", 1), row("}", 2)])
                .await
                .unwrap();
        }
        db.insert_chunks_with_embeddings(p, a, vec![row("}", 9)])
            .await
            .unwrap();
        db.insert_chunks_with_embeddings(p, b, vec![row("fn a() {}", 1)])
            .await
            .unwrap();

        let counts = db
            .conn()
            .call(|c| -> Result<(i64, i64)> {
                c.execute_batch(include_str!(
                    "../../migrations/041_purge_duplicate_chunks.sql"
                ))?;
                Ok((
                    c.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))?,
                    c.query_row("SELECT COUNT(*) FROM chunk_embeddings", [], |r| r.get(0))?,
                ))
            })
            .await
            .unwrap();
        // a: fn a()@1 · }@2 · }@9, copy/a.rs: fn a()@1
        assert_eq!(counts, (4, 4));
    }
}
