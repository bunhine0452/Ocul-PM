//! 청크 적재 — 같은 내용은 다시 임베딩하지 않는다 (2026-10-08 검토 `{#idx-low-value}`).
//!
//! 세 색인 경로(전체 색인 `run_index` · 워처 증분 [`super::reindex_single_file`] ·
//! 일지 `reindex_journal_file`)가 저마다 "청크를 8개씩 임베딩해 끼워 넣는" 고리를
//! 들고 있었다. 여기로 모으면서 두 가지가 바뀌었다.
//!
//! 1. **재사용.** 임베딩 전에 이 파일의 지금 청크, 그리고 내용이 같은(같은
//!    `files.hash`) 다른 파일 하나의 청크에서 내용이 같은 벡터를 가져온다. 저장할
//!    때마다 바뀐 함수 하나만 다시 임베딩하고, 통째로 복사된 폴더는 한 번도 다시
//!    임베딩하지 않는다. 판정은 청크 문자열의 완전 일치라 충돌이 없다. 모델은 하나
//!    (`embedding.rs` `MODEL`)이고 바뀌면 017 처럼 청크를 비우므로, DB 의 벡터는
//!    모두 같은 모델의 것이다. 벡터는 **복사**한다 — 공유하면 vec0 의 프로젝트
//!    파티션과 KNN 의 행 단위 `k` 가 함께 흔들린다.
//! 2. **통째로 바꾸기 + CAS.** 옛 청크를 지우고 새 청크를 넣는 일을 한 트랜잭션에서,
//!    `files.hash` 가 아직 이번 내용일 때만 한다. 예전에는 `upsert_file` 이 먼저
//!    지우고 배치마다 덧붙였는데, 워처 증분은 `changed=false`(안 지웠다)여도 그냥
//!    덧붙였다 — 같은 파일의 증분 둘이 겹치면(퍼밋 2개 · 해시 없는 이벤트) 사본이
//!    쌓여, 설치본 청크의 17.8%(19,987)가 같은 파일·같은 범위·같은 내용이었다
//!    (041 이 걷는다).

use std::collections::{HashMap, HashSet};
use std::future::Future;

use crate::db::{ChunkInsert, Db};
use crate::embedding::{vec_to_bytes, Embedder};

use super::EMBED_BATCH;

/// 텍스트 묶음을 임베딩한다 — 실물은 [`Embedder`], 테스트는 호출을 세는 가짜.
pub trait EmbedTexts: Sync {
    fn embed_texts(
        &self,
        texts: Vec<String>,
    ) -> impl Future<Output = Result<Vec<Vec<f32>>, String>> + Send;
}

impl EmbedTexts for Embedder {
    fn embed_texts(
        &self,
        texts: Vec<String>,
    ) -> impl Future<Output = Result<Vec<Vec<f32>>, String>> + Send {
        self.embed(texts)
    }
}

/// 임베딩 전의 청크 한 개.
pub struct PendingChunk {
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
}

impl From<super::Chunk> for PendingChunk {
    fn from(c: super::Chunk) -> Self {
        Self {
            kind: c.kind.to_string(),
            start_line: c.start_line,
            end_line: c.end_line,
            content: c.content,
        }
    }
}

/// 적재 결과 — `embedded` 는 실제로 모델을 부른 고유 텍스트 수 (나머지는 재사용).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Stored {
    pub inserted: u32,
    pub embedded: u32,
}

/// `file_id` 의 청크를 `chunks` 로 통째로 바꾼다 — 빈 목록이면 옛 청크만 지운다.
///
/// 호출자는 방금 `upsert_file` 이 `changed=true` 를 돌려준 파일과 그 해시를 넘긴다.
/// 그 사이 다른 색인이 파일을 다른 내용으로 갱신했다면(`files.hash` 가 다르면)
/// 아무것도 쓰지 않는다 — 더 새 내용을 가진 쪽이 쓴다.
pub async fn store_file_chunks(
    db: &Db,
    embedder: &impl EmbedTexts,
    project_id: u32,
    file_id: u32,
    file_hash: &str,
    chunks: Vec<PendingChunk>,
) -> Result<Stored, String> {
    let mut known: HashMap<String, Vec<u8>> = if chunks.is_empty() {
        HashMap::new()
    } else {
        db.reusable_embeddings(file_id, file_hash.to_string())
            .await
            .map_err(|e| e.to_string())?
    };
    // 모르는 내용만, 파일 안에서도 한 번씩.
    let mut seen = HashSet::new();
    let todo: Vec<String> = chunks
        .iter()
        .filter(|c| !known.contains_key(&c.content) && seen.insert(c.content.as_str()))
        .map(|c| c.content.clone())
        .collect();
    for batch in todo.chunks(EMBED_BATCH) {
        let vectors = embedder.embed_texts(batch.to_vec()).await?;
        if vectors.len() != batch.len() {
            return Err(format!(
                "embedder returned {} vectors for {} texts",
                vectors.len(),
                batch.len()
            ));
        }
        for (text, v) in batch.iter().zip(vectors) {
            known.insert(text.clone(), vec_to_bytes(&v));
        }
    }
    let rows: Vec<ChunkInsert> = chunks
        .into_iter()
        .filter_map(|c| {
            let embedding = known.get(&c.content)?.clone();
            Some(ChunkInsert {
                kind: c.kind,
                start_line: c.start_line,
                end_line: c.end_line,
                content: c.content,
                embedding,
            })
        })
        .collect();
    let written = db
        .replace_file_chunks(project_id, file_id, file_hash.to_string(), rows)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Stored {
        inserted: written.unwrap_or(0) as u32,
        embedded: todo.len() as u32,
    })
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
