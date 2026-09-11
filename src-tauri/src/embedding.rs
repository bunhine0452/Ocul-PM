//! Local embedding via fastembed (ONNX Runtime). The model is loaded lazily on
//! first use and downloaded into an absolute, writable cache dir supplied by the
//! caller (the app data dir). fastembed's default cache is relative
//! (`./.fastembed_cache`), which breaks the packaged .app — its CWD is `/`, so
//! the model can't be written/read and `embed` fails with
//! "Failed to retrieve onnx/model.onnx".
//!
//! The first-run download has no UI of its own (fastembed only prints a progress
//! bar to stdout, invisible in a packaged app). We detect the cache-miss and emit
//! `embedding-model-download` events so the frontend can show a progress banner —
//! otherwise the first semantic index just looks frozen while ~135MB downloads.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use tracing::info;

/// Active embedding model. Stays fixed for the lifetime of the DB schema —
/// changing it requires re-indexing (see migration 017, which clears the code
/// index on the upgrade that introduced this model). Quantized + multilingual
/// (paraphrase-multilingual-MiniLM-L12-v2, int8) — ~135MB vs the old fp32 e5
/// model's ~480MB, same 384 dims.
const MODEL: EmbeddingModel = EmbeddingModel::ParaphraseMLMiniLML12V2Q;
#[allow(dead_code)]
pub const EMBEDDING_DIM: usize = 384;

/// Rough on-disk size of the quantized model, used only to render a progress bar
/// before the real total is known. The bar is clamped to 99% until `done`.
const MODEL_EST_BYTES: u64 = 135_000_000;
const DOWNLOAD_EVENT: &str = "embedding-model-download";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    /// "start" | "progress" | "done" | "error"
    status: &'static str,
    downloaded: u64,
    total: u64,
}

type SharedModel = Arc<std::sync::Mutex<TextEmbedding>>;

pub struct Embedder {
    /// Handle used to emit model-download progress to the UI.
    app: AppHandle,
    /// Absolute directory the ONNX model is downloaded to / loaded from. Must be
    /// writable independent of the process CWD (see module docs).
    cache_dir: PathBuf,
    inner: Arc<AsyncMutex<Option<SharedModel>>>,
    /// 모델은 한 번에 한 호출만 쓸 수 있다 (`embed` 가 `&mut self`). 그 **줄서기를
    /// 어디서 하느냐**가 이 필드의 전부다.
    ///
    /// 예전엔 모든 호출자가 곧장 `spawn_blocking` 에 들어가 그 안의 std 뮤텍스에서
    /// 파킹했다 — N 개의 동시 호출자가 N 개의 blocking OS 스레드를 점유한 채 줄을
    /// 선다는 뜻이다. 그 풀은 git·히스토리·코드 검색과 공유하므로, 임베딩이 밀리면
    /// 무관한 기능이 스레드를 못 얻어 굶는다.
    ///
    /// 이제는 여기서 **비동기로** 기다린 뒤에야 blocking 풀에 들어간다. 직렬성은
    /// 그대로(퍼밋 1개)이고, 바뀐 것은 대기 장소뿐이다.
    turnstile: Arc<Semaphore>,
}

impl Embedder {
    pub fn new(app: AppHandle, cache_dir: PathBuf) -> Self {
        Self {
            app,
            cache_dir,
            inner: Arc::new(AsyncMutex::new(None)),
            turnstile: Arc::new(Semaphore::new(1)),
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

        // Cache-miss → this call will download the model. Emit progress so the UI
        // can show a "first-time download" banner instead of appearing frozen.
        let first_download = !model_cached(&self.cache_dir);
        let poller = if first_download {
            let _ = self.app.emit(
                DOWNLOAD_EVENT,
                DownloadProgress {
                    status: "start",
                    downloaded: 0,
                    total: MODEL_EST_BYTES,
                },
            );
            let app = self.app.clone();
            let dir = self.cache_dir.clone();
            Some(tokio::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                    let downloaded = dir_size(&dir);
                    let total = downloaded.max(MODEL_EST_BYTES);
                    let _ = app.emit(
                        DOWNLOAD_EVENT,
                        DownloadProgress {
                            status: "progress",
                            downloaded,
                            total,
                        },
                    );
                }
            }))
        } else {
            None
        };

        let cache_dir = self.cache_dir.clone();
        let loaded = tokio::task::spawn_blocking(move || {
            // hf-hub populates this on first run; create it so the download has
            // a writable target even on a brand-new install.
            let _ = std::fs::create_dir_all(&cache_dir);
            TextEmbedding::try_new(
                InitOptions::new(MODEL)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(true),
            )
        })
        .await;

        if let Some(p) = poller {
            p.abort();
        }

        let model = match loaded {
            Ok(Ok(m)) => m,
            Ok(Err(e)) => {
                if first_download {
                    let _ = self.app.emit(
                        DOWNLOAD_EVENT,
                        DownloadProgress {
                            status: "error",
                            downloaded: 0,
                            total: 0,
                        },
                    );
                }
                return Err(e.to_string());
            }
            Err(e) => {
                if first_download {
                    let _ = self.app.emit(
                        DOWNLOAD_EVENT,
                        DownloadProgress {
                            status: "error",
                            downloaded: 0,
                            total: 0,
                        },
                    );
                }
                return Err(e.to_string());
            }
        };

        if first_download {
            let _ = self.app.emit(
                DOWNLOAD_EVENT,
                DownloadProgress {
                    status: "done",
                    downloaded: MODEL_EST_BYTES,
                    total: MODEL_EST_BYTES,
                },
            );
        }

        let shared = Arc::new(std::sync::Mutex::new(model));
        *guard = Some(shared.clone());
        Ok(shared)
    }

    pub async fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let model = self.ensure_loaded().await?;
        // 줄서기는 blocking 풀 **밖**에서 (필드 주석 참고). 기다리는 호출자는
        // tokio 태스크로 잠들 뿐 OS 스레드를 쥐지 않는다.
        let permit = self
            .turnstile
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        tokio::task::spawn_blocking(move || {
            // 퍼밋을 클로저 안까지 들고 들어간다 — 호출자가 취소돼도 반납은
            // **실제 추론이 끝난 뒤**에 일어나야 다음 사람이 std 뮤텍스에서
            // 파킹하지 않는다.
            let _permit = permit;
            let mut guard = model.lock().map_err(|e| e.to_string())?;
            guard.embed(texts, None).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// The model cache is "warm" if a reasonably-sized `.onnx` already exists under
/// `dir` — then `try_new` loads from disk instead of downloading.
/// hf-hub 가 `models--{owner}--{name}` 로 만드는 캐시 디렉터리 이름.
fn hf_dir_name(model_code: &str) -> String {
    format!("models--{}", model_code.replace('/', "--"))
}

/// 활성 모델이 아닌 모델 캐시를 지운다 (감사 라운드 2026-09-11 D2).
///
/// 2026-06-08 에 e5-small(fp32, 465MB) 에서 양자화 MiniLM 으로 바꿨을 때
/// 마이그레이션 017 은 색인만 비우고 옛 모델 디렉터리는 그대로 뒀다 — 앱
/// 데이터의 705MB 중 465MB 가 두 번 다시 안 읽힐 파일이었다. 기동 때 한 번,
/// `models--*` 중 활성 모델의 것이 아니면 지운다. 지운 바이트 수를 돌려준다.
pub fn prune_retired_model_caches(cache_dir: &Path) -> u64 {
    let Ok(info) = TextEmbedding::get_model_info(&MODEL) else {
        return 0;
    };
    let keep = hf_dir_name(&info.model_code);
    let Ok(rd) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    let mut freed = 0u64;
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !p.is_dir() || !name.starts_with("models--") || name == keep {
            continue;
        }
        let size = dir_size(&p);
        match std::fs::remove_dir_all(&p) {
            Ok(()) => {
                freed += size;
                info!(dir = %p.display(), bytes = size, "retired embedding model cache removed");
            }
            Err(e) => {
                tracing::warn!(dir = %p.display(), error = %e, "retired model cache: remove failed")
            }
        }
    }
    freed
}

fn model_cached(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if model_cached(&p) {
                return true;
            }
        } else if p.extension().map(|e| e == "onnx").unwrap_or(false)
            && entry
                .metadata()
                .map(|m| m.len() > 1_000_000)
                .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

/// Recursively sum file sizes under `dir` — used to estimate download progress.
fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(m) = entry.metadata() {
                total += m.len();
            }
        }
    }
    total
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hf_dir_name_matches_hub_layout() {
        assert_eq!(
            hf_dir_name("intfloat/multilingual-e5-small"),
            "models--intfloat--multilingual-e5-small"
        );
    }

    /// D2 — 활성 모델의 디렉터리는 남고, 다른 `models--*` 만 사라진다. 모델
    /// 폴더가 아닌 것(로그 등)은 손대지 않는다.
    #[test]
    fn prune_removes_only_other_model_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let keep = hf_dir_name(&TextEmbedding::get_model_info(&MODEL).unwrap().model_code);
        for d in [
            keep.as_str(),
            "models--intfloat--multilingual-e5-small",
            "not-a-model",
        ] {
            std::fs::create_dir_all(dir.path().join(d)).unwrap();
            std::fs::write(dir.path().join(d).join("x.bin"), vec![0u8; 1024]).unwrap();
        }
        let freed = prune_retired_model_caches(dir.path());
        assert_eq!(freed, 1024);
        assert!(dir.path().join(&keep).exists());
        assert!(dir.path().join("not-a-model").exists());
        assert!(!dir
            .path()
            .join("models--intfloat--multilingual-e5-small")
            .exists());
    }
}
