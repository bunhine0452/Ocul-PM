//! Local embedding via fastembed (ONNX Runtime). The model is loaded lazily on
//! first use and downloaded into an absolute, writable cache dir supplied by the
//! caller (the app data dir). fastembed's default cache is relative
//! (`./.fastembed_cache`), which breaks the packaged .app — its CWD is `/`, so
//! the model can't be written/read and `embed` fails with
//! "Failed to retrieve onnx/model.onnx".

use std::path::PathBuf;
use std::sync::Arc;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use tokio::sync::Mutex as AsyncMutex;
use tracing::info;

/// Active embedding model. Stays fixed for the lifetime of the DB schema —
/// changing it requires recreating the `chunk_embeddings` virtual table.
const MODEL: EmbeddingModel = EmbeddingModel::MultilingualE5Small;
#[allow(dead_code)]
pub const EMBEDDING_DIM: usize = 384;

type SharedModel = Arc<std::sync::Mutex<TextEmbedding>>;

pub struct Embedder {
    /// Absolute directory the ONNX model is downloaded to / loaded from. Must be
    /// writable independent of the process CWD (see module docs).
    cache_dir: PathBuf,
    inner: Arc<AsyncMutex<Option<SharedModel>>>,
}

impl Embedder {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            inner: Arc::new(AsyncMutex::new(None)),
        }
    }

    async fn ensure_loaded(&self) -> Result<SharedModel, String> {
        let mut guard = self.inner.lock().await;
        if let Some(model) = guard.as_ref() {
            return Ok(model.clone());
        }
        info!(
            "loading embedding model: {:?} (cache: {})",
            MODEL,
            self.cache_dir.display()
        );
        let cache_dir = self.cache_dir.clone();
        let model = tokio::task::spawn_blocking(move || {
            // hf-hub populates this on first run; create it so the download has
            // a writable target even on a brand-new install.
            let _ = std::fs::create_dir_all(&cache_dir);
            TextEmbedding::try_new(
                InitOptions::new(MODEL)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(true),
            )
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        let shared = Arc::new(std::sync::Mutex::new(model));
        *guard = Some(shared.clone());
        Ok(shared)
    }

    pub async fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let model = self.ensure_loaded().await?;
        tokio::task::spawn_blocking(move || {
            let mut guard = model.lock().map_err(|e| e.to_string())?;
            guard.embed(texts, None).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// Convert an embedding vector into the little-endian byte layout sqlite-vec
/// stores. Length must equal `EMBEDDING_DIM`.
pub fn vec_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(embedding.len() * 4);
    for v in embedding {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}
