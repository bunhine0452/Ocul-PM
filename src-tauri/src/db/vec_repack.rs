//! vec0 파티션 다지기 — 색인이 돌 때마다 스스로 (`{#vec0-holes}` 후속, 2026-10-18).
//!
//! sqlite-vec 는 새 벡터를 파티션의 **마지막** 청크(1024칸)에만 넣고, 지운 칸은
//! 다시 쓰지 않는다 (`vec0Update_InsertNextAvailableStep`). 청크가 통째로 비어야
//! 그 청크를 지운다. 증분 색인은 저장할 때마다 파일의 청크를 지우고 다시 넣으므로
//! 옛 청크에 구멍만 쌓인다. `compact()`(진단 탭 버튼 · 프로젝트 삭제)가 다시 짓지만
//! 아무도 누르지 않는다 — 설치본 사본(2026-10-18): 파티션 29 의 칸 251,904 중
//! 살아 있는 벡터 19,609(7.8%), 벡터 블롭 550MB 중 ~400MB 가 죽은 칸이었고,
//! KNN 은 죽은 칸까지 훑어 한 번에 116ms 였다(다진 뒤 12ms, 결과 top-20 동일).
//!
//! 그래서 적재 직후 그 파티션이 성기면 **가장 빈 청크부터** 산 벡터를 지웠다
//! 다시 넣어 마지막 청크로 옮긴다 — 옛 청크는 비어서 sqlite-vec 가 지우고, 그
//! 페이지는 freelist 로 가 다음 성장에 다시 쓰인다(파일이 더 자라지 않는다).
//! DB 연결이 하나라 한 걸음을 짧게 끊는다: 걸음마다 청크 [`STEP_MAX_CHUNKS`] 개 ·
//! 행 [`STEP_MAX_ROWS`] 개까지, 걸음 사이에 다른 호출이 끼어든다. 사본에서 한
//! 걸음이 최악 0.9s(32청크)였다 — 지운 청크 하나가 1.5MB 블롭이라 비용은 행보다
//! 비우는 청크 수를 따른다.

use super::*;

/// vec0 의 청크 칸 수 — 032 의 정의(기본값)와 같다. 검사는 `size` 열을 직접 읽는다.
const SLOTS_PER_CHUNK: i64 = 1024;
/// 이만큼(청크 4개 · 6MB) 죽은 칸이 쌓이기 전에는 건드리지 않는다.
const MIN_DEAD_SLOTS: i64 = 4 * SLOTS_PER_CHUNK;
/// 한 걸음에 비우는 청크·옮기는 행의 상한.
const STEP_MAX_CHUNKS: usize = 16;
const STEP_MAX_ROWS: i64 = 2048;
/// 이보다 찬 청크는 옮기지 않는다 — 옮겨도 칸이 거의 안 돌아온다.
const MOVE_BELOW: i64 = SLOTS_PER_CHUNK * 3 / 4;
/// 한 번 부를 때 걸음 수 상한 (안전판 — 정상이면 판정이 먼저 멈춘다).
const MAX_STEPS: usize = 64;

impl Db {
    /// 파티션 `project_id` 가 성기면(산 벡터가 칸의 절반 미만 · 죽은 칸
    /// [`MIN_DEAD_SLOTS`] 이상) 다진다. 옮긴 벡터 수를 돌려준다 — 성기지 않으면
    /// 0 (판정 쿼리 하나, 사본에서 0.6ms).
    pub async fn repack_vec0_if_sparse(&self, project_id: u32) -> Result<u32> {
        let mut moved = 0u32;
        for _ in 0..MAX_STEPS {
            let n = self
                .conn
                .call(move |c| repack_step(c, project_id as i64))
                .await?;
            if n == 0 {
                break;
            }
            moved += n;
        }
        if moved > 0 {
            info!(project_id, moved, "vec0 partition repacked");
        }
        Ok(moved)
    }
}

/// 한 걸음 — 한 트랜잭션. 옮길 게 없으면 0.
fn repack_step(c: &mut rusqlite::Connection, project_id: i64) -> rusqlite::Result<u32> {
    let tx = c.transaction()?;
    let slots: i64 = tx.query_row(
        "SELECT COALESCE(SUM(size), 0) FROM chunk_embeddings_chunks WHERE partition00 = ?1",
        [project_id],
        |r| r.get(0),
    )?;
    if slots < MIN_DEAD_SLOTS {
        return Ok(0);
    }
    // 산 벡터 = 이 프로젝트의 청크 행 (트리거가 둘을 같이 지운다). 커버링 인덱스 둘.
    let live: i64 = tx.query_row(
        "SELECT COUNT(*) FROM chunks c JOIN files f ON f.id = c.file_id WHERE f.project_id = ?1",
        [project_id],
        |r| r.get(0),
    )?;
    if live * 2 >= slots || slots - live < MIN_DEAD_SLOTS {
        return Ok(0);
    }
    // 마지막 청크는 넣는 자리라 옮기지 않는다.
    let mut stmt = tx.prepare(
        "SELECT r.chunk_id, COUNT(*) AS n
           FROM chunk_embeddings_rowids r
           JOIN chunk_embeddings_chunks k ON k.chunk_id = r.chunk_id
          WHERE k.partition00 = ?1
            AND r.chunk_id <> (SELECT MAX(chunk_id) FROM chunk_embeddings_chunks
                                WHERE partition00 = ?1)
          GROUP BY r.chunk_id
          ORDER BY n",
    )?;
    let occupancy: Vec<(i64, i64)> = stmt
        .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let mut pick = Vec::new();
    let mut rows = 0i64;
    for (chunk, n) in occupancy {
        if n >= MOVE_BELOW
            || pick.len() >= STEP_MAX_CHUNKS
            || (!pick.is_empty() && rows + n > STEP_MAX_ROWS)
        {
            break;
        }
        pick.push(chunk);
        rows += n;
    }
    if pick.is_empty() {
        return Ok(0);
    }
    let ids: Vec<i64> = {
        let mut stmt = tx.prepare_cached(
            "SELECT rowid FROM chunk_embeddings_rowids WHERE chunk_id = ?1 ORDER BY rowid",
        )?;
        let mut ids = Vec::new();
        for chunk in &pick {
            let found = stmt.query_map([chunk], |r| r.get(0))?;
            for id in found {
                ids.push(id?);
            }
        }
        ids
    };
    {
        let mut read =
            tx.prepare_cached("SELECT embedding FROM chunk_embeddings WHERE chunk_id = ?1")?;
        let mut delete = tx.prepare_cached("DELETE FROM chunk_embeddings WHERE chunk_id = ?1")?;
        let mut insert = tx.prepare_cached(
            "INSERT INTO chunk_embeddings (chunk_id, project_id, embedding) VALUES (?1, ?2, ?3)",
        )?;
        for id in &ids {
            let embedding: Vec<u8> = read.query_row([id], |r| r.get(0))?;
            delete.execute([id])?;
            insert.execute(params![id, project_id, embedding])?;
        }
    }
    tx.commit()?;
    Ok(ids.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 벡터는 행마다 다르다(거리 동점이 없어야 KNN 비교가 안정적이다).
    fn rows(n: usize, seed: usize) -> Vec<ChunkInsert> {
        (0..n)
            .map(|i| {
                let mut v = vec![0f32; 384];
                v[i % 384] = 1.0 + (i + seed * 2000) as f32;
                ChunkInsert {
                    kind: "lines".into(),
                    start_line: i as u32,
                    end_line: i as u32 + 1,
                    content: format!("c{i}"),
                    embedding: v.iter().flat_map(|f| f.to_le_bytes()).collect(),
                }
            })
            .collect()
    }

    async fn slots_and_live(db: &Db, p: u32) -> (i64, i64) {
        db.conn()
            .call(move |c| -> Result<(i64, i64)> {
                Ok((
                    c.query_row(
                        "SELECT COALESCE(SUM(size), 0) FROM chunk_embeddings_chunks
                          WHERE partition00 = ?1",
                        [p as i64],
                        |r| r.get(0),
                    )?,
                    c.query_row(
                        "SELECT COUNT(*) FROM chunk_embeddings WHERE project_id = ?1",
                        [p as i64],
                        |r| r.get(0),
                    )?,
                ))
            })
            .await
            .unwrap()
    }

    /// 파일 8개가 vec0 청크 8개를 하나씩 꽉 채운 뒤 파일마다 1000행을 지우면
    /// 청크마다 24칸만 산다(증분 색인이 남기는 모양). 다진 뒤 칸이 한 청크로 줄고,
    /// 산 벡터 수와 KNN 이 돌려주는 chunk_id 는 그대로다.
    #[tokio::test]
    async fn repack_shrinks_sparse_partition_and_keeps_vectors() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let p = db
            .create_project("p".into(), "/tmp/p".into())
            .await
            .unwrap();
        let other = db
            .create_project("q".into(), "/tmp/q".into())
            .await
            .unwrap();
        // 청크 1024칸이 파일 하나로 꽉 차게, 파일 8개.
        let mut files = Vec::new();
        for i in 0..8 {
            let (f, _) = db
                .upsert_file(p, format!("f{i}.rs"), format!("h{i}"), 1, 1, None)
                .await
                .unwrap();
            db.insert_chunks_with_embeddings(p, f, rows(1024, i))
                .await
                .unwrap();
            files.push(f);
        }
        let (of, _) = db
            .upsert_file(other, "o.rs".into(), "o".into(), 1, 1, None)
            .await
            .unwrap();
        db.insert_chunks_with_embeddings(other, of, rows(10, 99))
            .await
            .unwrap();
        // 파일마다 앞 1000개를 지운다 → 청크 8개에 각 24개만 산다.
        for f in &files {
            db.conn()
                .call({
                    let f = *f as i64;
                    move |c| -> Result<()> {
                        c.execute(
                            "DELETE FROM chunks WHERE file_id = ?1 AND start_line < 1000",
                            [f],
                        )?;
                        Ok(())
                    }
                })
                .await
                .unwrap();
        }
        let (slots, live) = slots_and_live(&db, p).await;
        assert_eq!((slots, live), (8 * 1024, 8 * 24));

        let probe = rows(1, 0).remove(0).embedding;
        let before = knn(&db, p, probe.clone()).await;

        let moved = db.repack_vec0_if_sparse(p).await.unwrap();
        assert!(moved > 0);
        let (slots_after, live_after) = slots_and_live(&db, p).await;
        assert_eq!(live_after, live);
        assert!(slots_after <= 2 * 1024, "slots after repack: {slots_after}");
        assert_eq!(knn(&db, p, probe).await, before);
        // 다른 파티션은 그대로.
        assert_eq!(slots_and_live(&db, other).await, (1024, 10));
        // 이미 다졌으면 아무것도 안 한다.
        assert_eq!(db.repack_vec0_if_sparse(p).await.unwrap(), 0);
    }

    async fn knn(db: &Db, p: u32, probe: Vec<u8>) -> Vec<i64> {
        db.conn()
            .call(move |c| -> Result<Vec<i64>> {
                let mut s = c.prepare(
                    "SELECT chunk_id FROM chunk_embeddings
                      WHERE embedding MATCH ?1 AND project_id = ?2 AND k = 50
                      ORDER BY distance",
                )?;
                let ids = s
                    .query_map(params![probe, p as i64], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<i64>>>()?;
                Ok(ids)
            })
            .await
            .unwrap()
    }

    /// 죽은 칸이 [`MIN_DEAD_SLOTS`] 미만이면 손대지 않는다 (작은 프로젝트).
    #[tokio::test]
    async fn repack_leaves_small_partitions_alone() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let p = db
            .create_project("p".into(), "/tmp/p".into())
            .await
            .unwrap();
        let (f, _) = db
            .upsert_file(p, "a.rs".into(), "h".into(), 1, 1, None)
            .await
            .unwrap();
        db.insert_chunks_with_embeddings(p, f, rows(3, 0))
            .await
            .unwrap();
        assert_eq!(db.repack_vec0_if_sparse(p).await.unwrap(), 0);
    }
}
