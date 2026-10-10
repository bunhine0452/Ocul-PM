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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use fastembed::{
    EmbeddingModel, InitOptionsUserDefined, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use hf_hub::api::sync::ApiBuilder;
use hf_hub::{Cache, Repo};
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
pub const EMBEDDING_DIM: usize = 384;

/// 토크나이저 절단 길이 (`{#ort-arena}`, 2026-09-12). fastembed 기본은 512 인데
/// 이 모델(paraphrase-multilingual-MiniLM-L12-v2)은 128 토큰에서 학습됐다 —
/// 그 너머는 품질이 정의되지 않은 채 어텐션 메모리만 길이의 **제곱**으로 든다.
/// 청크 6,000개가 2KB 를 넘어 512 를 꽉 채우고 있었다. 256 이면 1KB 청크(전체의
/// 67%)는 온전히 들어가고, 아레나 피크는 4배 내려간다.
const MAX_TOKENS: usize = 256;

/// 이만큼 안 쓰이면 모델(=ORT 세션과 아레나)을 내린다 (`{#embed-unload}`).
///
/// 처음 재봤을 때는 넣지 않았다 — drop 이 아레나 300MB 만 돌려주고(940→647MB)
/// 모델 로드 ~640MB 는 남았으며 재로드마다 +140MB 가 더 남았다. 원인은 ORT 가
/// 아니라 macOS malloc 의 대형 블록 캐시였고(`main.rs` `reexec_with_malloc_tuning`),
/// 그걸 끄니 내린 뒤 **38MB**, 다시 올리면 247MB 다 (perf_baseline M6, 세션
/// 빌드 ~100ms). 색인·의미 검색이 없는 시간에 900MB 를 붙들 이유가 없다.
const IDLE_UNLOAD: Duration = Duration::from_secs(5 * 60);
const IDLE_SWEEP: Duration = Duration::from_secs(60);

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
    /// 마지막 `embed` 호출 시각 (`started` 기준 ms). 유휴 언로드의 잣대.
    last_used_ms: Arc<AtomicU64>,
    started: Instant,
}

impl Embedder {
    pub fn new(app: AppHandle, cache_dir: PathBuf) -> Self {
        let this = Self {
            app,
            cache_dir,
            inner: Arc::new(AsyncMutex::new(None)),
            turnstile: Arc::new(Semaphore::new(1)),
            last_used_ms: Arc::new(AtomicU64::new(0)),
            started: Instant::now(),
        };
        this.spawn_idle_unloader();
        this
    }

    /// 1분마다 보고, 마지막 사용에서 `IDLE_UNLOAD` 가 지났고 **지금 추론 중이
    /// 아니면** 내린다. 추론 중 판정은 회전문 퍼밋이 남아 있는가로 — 쥔 호출자가
    /// 있으면 다음 분에 다시 본다. 그 사이 `ensure_loaded` 로 Arc 를 복제해 둔
    /// 호출자가 있어도 안전하다: 그쪽 Arc 가 마지막 참조라 추론이 끝난 뒤 세션이
    /// 해제될 뿐이다.
    fn spawn_idle_unloader(&self) {
        let inner = self.inner.clone();
        let turnstile = self.turnstile.clone();
        let last_used = self.last_used_ms.clone();
        let started = self.started;
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(IDLE_SWEEP).await;
                let idle = elapsed_ms(started).saturating_sub(last_used.load(Ordering::Relaxed));
                if idle < IDLE_UNLOAD.as_millis() as u64 || turnstile.available_permits() == 0 {
                    continue;
                }
                let mut guard = inner.lock().await;
                let Some(model) = guard.take() else {
                    continue;
                };
                drop(guard);
                // ORT 세션 해제는 동기 — 런타임 워커 밖에서.
                let _ = tokio::task::spawn_blocking(move || drop(model)).await;
                info!(
                    "embedding model unloaded after {}s idle",
                    IDLE_UNLOAD.as_secs()
                );
            }
        });
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
            load_model(&cache_dir)
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
        self.last_used_ms
            .store(elapsed_ms(self.started), Ordering::Relaxed);
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

/// 토크나이저 파일 넷 — fastembed 의 `load_tokenizer_hf_hub` 가 읽는 것과 같다.
const TOKENIZER_FILES: [&str; 4] = [
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// 활성 모델이 로드에 쓰는 허브 파일 이름 전부 (onnx · 부속 · 토크나이저).
fn required_files() -> Result<(String, Vec<String>), String> {
    let info = TextEmbedding::get_model_info(&MODEL).map_err(|e| e.to_string())?;
    let mut files = vec![info.model_file.clone()];
    files.extend(info.additional_files.iter().cloned());
    files.extend(TOKENIZER_FILES.iter().map(|s| s.to_string()));
    Ok((info.model_code.clone(), files))
}

/// 캐시에서 `files` 를 전부 찾으면 로컬 경로를 돌려준다. 네트워크·토큰 무접촉.
fn resolve_cached(cache_dir: &Path, model_code: &str, files: &[String]) -> Option<Vec<PathBuf>> {
    let repo = Cache::new(cache_dir.to_path_buf()).repo(Repo::model(model_code.to_string()));
    files.iter().map(|f| repo.get(f)).collect()
}

/// 캐시에 없는 파일만 내려받는다 (`{#hf-token}`). fastembed 의 `try_new` 는
/// `ApiBuilder::new()` 라 `~/.cache/huggingface/token` 을 읽어 모든 요청에 Bearer 로
/// 붙였다. 공개 모델이라 토큰은 필요 없으니 `with_token(None)` 으로 명시한다 — 기본
/// 캐시 경로의 토큰 파일은 읽히지도 않는다 (`from_cache` 는 **넘긴** 캐시의 token 만
/// 본다). 엔드포인트 미러(`HF_ENDPOINT`)는 fastembed 가 그랬듯 존중한다.
fn download_missing(cache_dir: &Path, model_code: &str, files: &[String]) -> Result<(), String> {
    let mut builder = ApiBuilder::from_cache(Cache::new(cache_dir.to_path_buf()))
        .with_token(None)
        .with_progress(false);
    if let Ok(endpoint) = std::env::var("HF_ENDPOINT") {
        builder = builder.with_endpoint(endpoint);
    }
    let repo = builder
        .build()
        .map_err(|e| e.to_string())?
        .model(model_code.to_string());
    for f in files {
        repo.get(f)
            .map_err(|e| format!("Failed to retrieve {f}: {e}"))?;
    }
    Ok(())
}

/// 캐시가 온전하면 허브 클라이언트 없이 로컬 바이트로 로드하고, 아니면 토큰 없이
/// 받아 온 뒤 같은 길로 로드한다. 세션 옵션은 fastembed `try_new` 와 같다
/// (Level3 · 전체 코어 — `try_new_from_user_defined` 도 동일하게 만든다).
fn load_model(cache_dir: &Path) -> Result<TextEmbedding, String> {
    let (code, files) = required_files()?;
    let paths = match resolve_cached(cache_dir, &code, &files) {
        Some(p) => p,
        None => {
            download_missing(cache_dir, &code, &files)?;
            resolve_cached(cache_dir, &code, &files)
                .ok_or_else(|| "model cache incomplete after download".to_string())?
        }
    };
    let read = |i: usize| std::fs::read(&paths[i]).map_err(|e| format!("{}: {e}", files[i]));
    let info = TextEmbedding::get_model_info(&MODEL).map_err(|e| e.to_string())?;
    let n_extra = info.additional_files.len();
    let t = 1 + n_extra;
    let tokenizer_files = TokenizerFiles {
        tokenizer_file: read(t)?,
        config_file: read(t + 1)?,
        special_tokens_map_file: read(t + 2)?,
        tokenizer_config_file: read(t + 3)?,
    };
    let mut model = UserDefinedEmbeddingModel::new(read(0)?, tokenizer_files)
        .with_quantization(TextEmbedding::get_quantization_mode(&MODEL));
    if let Some(pooling) = TextEmbedding::get_default_pooling_method(&MODEL) {
        model = model.with_pooling(pooling);
    }
    model.output_key = info.output_key.clone();
    TextEmbedding::try_new_from_user_defined(
        model,
        InitOptionsUserDefined::new().with_max_length(MAX_TOKENS),
    )
    .map_err(|e| e.to_string())
}

fn elapsed_ms(since: Instant) -> u64 {
    since.elapsed().as_millis().min(u64::MAX as u128) as u64
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
    debug_assert_eq!(embedding.len(), EMBEDDING_DIM, "vec0 column is FLOAT[384]");
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

    /// `{#hf-token}` — 로드에 쓰는 파일 집합: onnx + 부속 + 토크나이저 넷.
    #[test]
    fn required_files_cover_onnx_and_tokenizer() {
        let (code, files) = required_files().unwrap();
        assert_eq!(
            code,
            TextEmbedding::get_model_info(&MODEL).unwrap().model_code
        );
        assert!(files[0].ends_with(".onnx"));
        for t in TOKENIZER_FILES {
            assert!(files.iter().any(|f| f == t), "{t}");
        }
    }

    /// 캐시 해석은 파일시스템만 본다 — 하나라도 없으면 None(=토큰 없는 다운로드로 넘어감),
    /// 다 있으면 로컬 경로. 임시 HF 레이아웃(refs/main + snapshots)으로 확인.
    #[test]
    fn resolve_cached_is_all_or_nothing_and_offline() {
        let dir = tempfile::tempdir().unwrap();
        // 같은 임시 폴더에 토큰 파일이 있어도 이 경로는 읽지 않는다 (읽는 코드가 없다).
        std::fs::write(dir.path().join("token"), "hf_secret").unwrap();
        let (code, files) = required_files().unwrap();
        assert!(resolve_cached(dir.path(), &code, &files).is_none());
        let root = dir.path().join(hf_dir_name(&code));
        std::fs::create_dir_all(root.join("refs")).unwrap();
        std::fs::write(root.join("refs/main"), "abc123").unwrap();
        let snap = root.join("snapshots/abc123");
        for f in &files {
            let p = snap.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            if f != &files[files.len() - 1] {
                std::fs::write(&p, b"x").unwrap();
            }
        }
        assert!(resolve_cached(dir.path(), &code, &files).is_none());
        std::fs::write(snap.join(&files[files.len() - 1]), b"x").unwrap();
        let got = resolve_cached(dir.path(), &code, &files).unwrap();
        assert_eq!(got.len(), files.len());
    }

    /// [`load_model`] 은 onnx 바이트만 넘기고 부속 파일(외부 초기화 데이터)은 넘기지 않는다.
    /// 부속 파일이 있는 모델로 바꾸면 여기서 먼저 깨진다 — 그때 `external_initializers` 를
    /// 잇는다 (`try_new` 는 같은 폴더에서 알아서 찾았다).
    #[test]
    fn active_model_has_no_additional_files() {
        let info = TextEmbedding::get_model_info(&MODEL).unwrap();
        assert!(
            info.additional_files.is_empty(),
            "{:?}",
            info.additional_files
        );
    }

    /// 실모델 오프라인 로드 — `OCULPM_TEST_MODEL_CACHE` 가 가리키는 **복사본**으로만.
    #[test]
    #[ignore]
    fn loads_from_local_cache_without_hub() {
        let dir = std::env::var("OCULPM_TEST_MODEL_CACHE").expect("set OCULPM_TEST_MODEL_CACHE");
        let mut m = load_model(Path::new(&dir)).unwrap();
        let v = m.embed(vec!["안녕하세요".to_string()], None).unwrap();
        assert_eq!(v[0].len(), EMBEDDING_DIM);
    }
}
