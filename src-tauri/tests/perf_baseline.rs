//! Phase 0 측정 하니스 — v2.42.0 `{#measure-once}` / `{#perf-baseline}`.
//!
//! v3-round 감사는 **앱을 한 번도 실행하지 않고** 코드만 읽어서 나왔다. 그래서
//! 그 성능 주장은 전부 구조적 추정이다. 이 파일은 그중 **백엔드 쪽 추정을
//! 숫자로 바꾼다** — 고칠 것을 정하려는 게 아니라 *고칠 값어치가 있는지*를
//! 정하려는 것이다.
//!
//! 전부 `#[ignore]` 다. 측정은 게이트가 아니다: 러너 부하에 따라 값이 흔들리고,
//! 값이 흔들린다고 CI 가 붉어질 이유가 없다. 다음 라운드가 같은 방법으로 재려면
//!
//! ```text
//! cargo test --test perf_baseline -- --ignored --nocapture
//! ```
//!
//! 기준값은 `docs/20260904_v242-load-bearing/perf-baseline.md` 에 있다.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher as _};
use notify_debouncer_full::{new_debouncer, DebounceEventResult};

/// 이 저장소의 루트 (`src-tauri/..`).
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("git {args:?}: {e}"));
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// 워처가 쓰는 것과 같은 디바운스 창 (`automation::tiers::os_debounce_ms` 의
/// `balanced`). 여기서 상수로 고정하는 이유는 측정이 설정에 흔들리면 다음
/// 라운드가 비교할 수 없기 때문이다.
const DEBOUNCE_MS: u64 = 1000;

/// `watcher.rs:785-790` 의 해시 상한과 같은 값.
const HASH_BYTE_CAP: u64 = 8 * 1024 * 1024;

// ─── M2 — 브랜치 전환이 워처에 쏟는 양 ───────────────────────────────────────
//
// `{#watcher-bounded}` 가 묻는 것: unbounded 채널이 실제로 위험한가. 답은
// "한 번의 체크아웃이 몇 개의 이벤트를 만드는가" 다.

#[test]
#[ignore = "측정 전용 — cargo test --test perf_baseline -- --ignored --nocapture"]
fn m2_branch_switch_watcher_volume() {
    let tmp = tempfile::tempdir().unwrap();
    let clone = tmp.path().join("repo");
    let root = repo_root();

    // --local 은 하드링크라 64MB .git 도 순식간이다.
    git(
        &root,
        &[
            "clone",
            "--local",
            "--quiet",
            root.to_str().unwrap(),
            clone.to_str().unwrap(),
        ],
    );
    // 워크트리를 옛 지점에 두고 → 최신으로 되돌아오는 것이 "브랜치 전환" 이다.
    let base = git(&root, &["rev-parse", "HEAD~50"]).trim().to_string();
    let head = git(&root, &["rev-parse", "HEAD"]).trim().to_string();
    git(&clone, &["checkout", "--quiet", "--detach", &base]);

    let changed = git(&clone, &["diff", "--name-only", &base, &head]);
    let changed_files = changed.lines().filter(|l| !l.is_empty()).count();

    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(Duration::from_millis(DEBOUNCE_MS), None, move |res| {
        let _ = tx.send(res);
    })
    .unwrap();
    debouncer
        .watcher()
        .watch(&clone, RecursiveMode::Recursive)
        .unwrap();
    // OS 워처가 자리를 잡을 시간.
    std::thread::sleep(Duration::from_millis(500));

    let t0 = Instant::now();
    git(&clone, &["checkout", "--quiet", "--detach", &head]);
    let checkout_ms = t0.elapsed().as_millis();

    // 디바운스 창 + 여유. 마지막 배치가 올 때까지 조용해질 때까지 받는다.
    let mut batches = 0usize;
    let mut events = 0usize;
    let mut paths = std::collections::BTreeSet::new();
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS * 3)) {
            Ok(Ok(evs)) => {
                batches += 1;
                events += evs.len();
                for e in &evs {
                    for p in &e.paths {
                        paths.insert(p.clone());
                    }
                }
            }
            Ok(Err(errs)) => {
                batches += 1;
                eprintln!("  (watch errors: {})", errs.len());
            }
            Err(_) => break, // 조용해졌다
        }
    }
    let drain_ms = t0.elapsed().as_millis();

    println!("\n== M2 브랜치 전환 워처 유입량 ==");
    println!("  git diff --name-only 파일 수 : {changed_files}");
    println!("  git checkout 소요            : {checkout_ms} ms");
    println!("  디바운스 배치 수             : {batches}");
    println!("  디바운스된 이벤트 수         : {events}");
    println!("  고유 경로 수                 : {}", paths.len());
    println!("  체크아웃~정적화              : {drain_ms} ms");
    println!(
        "  → 배치당 평균 이벤트         : {}",
        events.checked_div(batches).unwrap_or(0)
    );

    // M2b — classify 의 read+blake3 를 같은 경로 집합에 그대로 재현한다
    // (`watcher.rs:785-790`). 지금 이 일은 tokio 런타임 워커 위에서 돈다.
    let mut hashed = 0usize;
    let mut skipped = 0usize;
    let mut bytes = 0u64;
    let t1 = Instant::now();
    for p in &paths {
        let Ok(meta) = std::fs::metadata(p) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() <= HASH_BYTE_CAP {
            if let Ok(b) = std::fs::read(p) {
                bytes += b.len() as u64;
                let _ = blake3::hash(&b);
                hashed += 1;
            }
        } else {
            skipped += 1;
        }
    }
    let hash_us = t1.elapsed().as_micros();

    println!("\n== M2b classify read+blake3 (런타임 워커 점유) ==");
    println!("  해시한 파일 : {hashed} (상한 초과로 건너뜀 {skipped})");
    println!("  읽은 바이트 : {bytes}");
    println!("  총 소요     : {} ms ({hash_us} us)", hash_us / 1000);

    assert!(changed_files > 0, "측정 대상 diff 가 비어 있다");
}

// ─── M3 — index_project 의 CPU 심이 얼마나 오래 워커를 잡는가 ────────────────
//
// `{#index-project-blocking}` 이 묻는 것: walk·read·hash·tree-sitter 가
// `spawn_blocking` 밖에서 도는 게 실제로 얼마나 긴가.

#[test]
#[ignore = "측정 전용 — cargo test --test perf_baseline -- --ignored --nocapture"]
fn m3_index_project_cpu_shim() {
    let root = repo_root();
    let config = ocul_pm_lib::indexer::IndexConfig::default();

    let t0 = Instant::now();
    let files = ocul_pm_lib::indexer::walk_text_files(&root, &config);
    let walk_ms = t0.elapsed().as_millis();

    let t1 = Instant::now();
    let mut read_bytes = 0u64;
    let mut chunks = 0usize;
    let mut symbols = 0usize;
    let mut parsed = 0usize;
    for f in &files {
        let Ok(content) = std::fs::read_to_string(f) else {
            continue;
        };
        read_bytes += content.len() as u64;
        let _ = blake3::hash(content.as_bytes());
        let (cs, ast) = ocul_pm_lib::indexer::chunk_file(f, &content, &config);
        chunks += cs.len();
        if let Some(a) = ast {
            parsed += 1;
            symbols += a.symbols.len();
        }
    }
    let work_ms = t1.elapsed().as_millis();

    println!("\n== M3 index_project CPU 심 (지금 tokio 워커 위) ==");
    println!("  walk_text_files : {} 파일, {walk_ms} ms", files.len());
    println!("  read+hash+chunk : {work_ms} ms ({read_bytes} bytes)");
    println!("  tree-sitter 파싱: {parsed} 파일, 심볼 {symbols}");
    println!("  청크            : {chunks}");
    println!("  → 워커 1개 점유 총합: {} ms", walk_ms + work_ms);

    assert!(!files.is_empty(), "walk 가 아무 파일도 못 찾았다");
}

// ─── M4 — 단일 연결 DB 액터의 처리량 ────────────────────────────────────────
//
// 워처가 파일당 스케줄하는 색인은 전부 이 한 줄 큐를 지난다. 브랜치 전환
// 한 번이 M2 의 경로 수만큼 이 큐에 실린다.

#[test]
#[ignore = "측정 전용 — cargo test --test perf_baseline -- --ignored --nocapture"]
fn m4_db_actor_queue_latency() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let tmp = tempfile::tempdir().unwrap();
        let db = std::sync::Arc::new(
            ocul_pm_lib::db::Db::open(tmp.path().join("perf.db"))
                .await
                .expect("open db"),
        );
        let pid = db
            .create_project("perf".into(), tmp.path().display().to_string())
            .await
            .expect("create project");

        const N: u32 = 500;
        let t0 = Instant::now();
        for i in 0..N {
            db.upsert_file(
                pid,
                format!("src/f{i}.rs"),
                format!("blake3:{i:064x}"),
                100,
                0,
                Some("rust".into()),
            )
            .await
            .expect("upsert");
        }
        let seq_ms = t0.elapsed().as_millis();

        // 동시 호출 — 액터가 한 줄이므로 동시성은 지연을 줄이지 못하고
        // **대기열 길이**로 나타난다. 브랜치 전환 한 번이 M2 의 경로 수만큼
        // 이 큐에 실린다.
        let t1 = Instant::now();
        let mut set = tokio::task::JoinSet::new();
        for i in 0..N {
            let db = db.clone();
            set.spawn(async move {
                let _ = db
                    .upsert_file(
                        pid,
                        format!("src/g{i}.rs"),
                        format!("blake3:{i:064x}"),
                        100,
                        0,
                        Some("rust".into()),
                    )
                    .await;
            });
        }
        while set.join_next().await.is_some() {}
        let par_ms = t1.elapsed().as_millis();

        println!("\n== M4 DB 액터 큐 ==");
        println!(
            "  순차 {N} upsert : {seq_ms} ms  ({:.2} ms/op)",
            seq_ms as f64 / f64::from(N)
        );
        println!("  동시 {N} upsert : {par_ms} ms  (마지막 대기자의 총 지연)");
    });
}

/// M5 — `compact()` 가 라이브 DB 사본에서 실제로 돌려주는 바이트
/// (`{#vec0-holes}` · `{#snapshot-git-dup}`, 2026-09-12).
///
/// ```bash
/// cp "<앱데이터>/ocul-pm.db" /tmp/snap.db && cp "<앱데이터>/ocul-pm.db-wal" /tmp/snap.db-wal
/// OCULPM_DB_SNAPSHOT=/tmp/snap.db cargo test --release --test perf_baseline m5 -- --ignored --nocapture
/// ```
/// 앱이 도는 중에도 된다 — 사본을 열지 원본을 열지 않는다. 설정 안 하면 건너뛴다.
#[test]
#[ignore = "측정 전용 — OCULPM_DB_SNAPSHOT=<사본> 필요"]
fn m5_compact_reclaims_on_live_snapshot() {
    let Ok(path) = std::env::var("OCULPM_DB_SNAPSHOT") else {
        println!("OCULPM_DB_SNAPSHOT 미설정 — 건너뜀");
        return;
    };
    let path = PathBuf::from(path);
    let size = |p: &Path| {
        std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(format!("{}-wal", p.display()))
                .map(|m| m.len())
                .unwrap_or(0)
    };
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let db = ocul_pm_lib::db::Db::open(path.clone()).await.expect("open");
        let before = size(&path);
        async fn stat(db: &ocul_pm_lib::db::Db) -> (i64, i64, i64) {
            db.conn()
                .call(|c| {
                    let live: i64 =
                        c.query_row("SELECT COUNT(*) FROM chunk_embeddings", [], |r| r.get(0))?;
                    let blocks: i64 =
                        c.query_row("SELECT COUNT(*) FROM chunk_embeddings_chunks", [], |r| {
                            r.get(0)
                        })?;
                    let snaps: i64 =
                        c.query_row("SELECT COUNT(*) FROM file_snapshots", [], |r| r.get(0))?;
                    Ok::<_, tokio_rusqlite::Error>((live, blocks, snaps))
                })
                .await
                .unwrap()
        }
        let (live, blocks, snaps) = stat(&db).await;
        let t0 = Instant::now();
        db.compact().await.expect("compact");
        let ms = t0.elapsed().as_millis();
        let (live2, blocks2, _) = stat(&db).await;
        let after = size(&path);
        println!("\n== M5 compact (라이브 사본) ==");
        println!(
            "  벡터 {live} → {live2} · vec0 블록 {blocks} (슬롯 {}) → {blocks2} (슬롯 {})",
            blocks * 1024,
            blocks2 * 1024
        );
        println!("  file_snapshots {snaps}행 (색인이 돌기 전이라 그대로)");
        println!(
            "  파일 {:.1} MB → {:.1} MB  (−{:.1} MB, {ms} ms)",
            before as f64 / 1048576.0,
            after as f64 / 1048576.0,
            (before as f64 - after as f64) / 1048576.0
        );
    });
}

/// M6 — 임베딩 한 판이 남기는 RSS (`{#ort-arena}`, 2026-09-12).
///
/// ORT 의 CPU 아레나는 추론 피크만큼 자라고 세션이 살아 있는 한 줄지 않는다.
/// 라이브 앱은 32분 만에 RSS 1.9GB(MALLOC_LARGE 1.5GB) 였다. 이 테스트는 같은
/// 모델로 2KB 짜리 코드 청크 N 개를 임베딩한 뒤 RSS 를 찍고, 모델을 drop 한 뒤
/// 다시 찍는다 — 앞의 값이 (max_length, batch) 가 정하는 상주량, 뒤의 값이
/// 유휴 언로드가 되돌려주는 양이다.
///
/// ```bash
/// OCULPM_EMBED_MAXLEN=512 OCULPM_EMBED_BATCH=32 cargo test --release --test perf_baseline m6 -- --ignored --nocapture
/// OCULPM_EMBED_MAXLEN=256 OCULPM_EMBED_BATCH=8  cargo test --release --test perf_baseline m6 -- --ignored --nocapture
/// ```
/// 모델 캐시는 앱 데이터의 `fastembed_cache` 를 그대로 쓴다 (없으면 내려받는다).
#[test]
#[ignore = "측정 전용 — 프로세스 하나에 설정 하나"]
fn m6_embedding_arena_rss() {
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    let env_usize = |k: &str, d: usize| {
        std::env::var(k)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(d)
    };
    let max_len = env_usize("OCULPM_EMBED_MAXLEN", 256);
    let batch = env_usize("OCULPM_EMBED_BATCH", 8);
    let n = env_usize("OCULPM_EMBED_N", 256);
    let cache = std::env::var("OCULPM_EMBED_CACHE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs_fallback()
                .join("Library/Application Support/com.kimhyunbin.ocul-pm/fastembed_cache")
        });
    fn dirs_fallback() -> PathBuf {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
    }
    // `ps rss` 는 macOS 에서 free 된 큰 블록(MADV_FREE)을 커널이 회수하기 전까지
    // 그대로 센다 — drop 뒤에도 안 줄어 보인다. 물리 풋프린트가 실제 점유다.
    fn rss_mb() -> String {
        let pid = std::process::id().to_string();
        let out = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid])
            .output()
            .unwrap();
        let rss = String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
            / 1024.0;
        let out = std::process::Command::new("vmmap")
            .args(["--summary", &pid])
            .output()
            .unwrap();
        let fp = String::from_utf8_lossy(&out.stdout)
            .lines()
            .find(|l| l.starts_with("Physical footprint:"))
            .map(|l| {
                l.trim_start_matches("Physical footprint:")
                    .trim()
                    .to_string()
            })
            .unwrap_or_else(|| "?".into());
        format!("rss {rss:.0} MB / footprint {fp}")
    }
    // 2KB 남짓의 코드 조각 — 라이브 DB 청크의 상위 6,000개가 이 크기다.
    let line = "    let value = compute_something(index, &buffer).unwrap_or_default(); // 처리\n";
    let text: String = std::iter::repeat_n(line, 26).collect();
    let texts: Vec<String> = (0..n)
        .map(|i| format!("fn f{i}() {{\n{text}}}\n"))
        .collect();

    let cache2 = cache.clone();
    let base = rss_mb();
    let mut model = TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::ParaphraseMLMiniLML12V2Q)
            .with_cache_dir(cache)
            .with_max_length(max_len)
            .with_show_download_progress(false),
    )
    .expect("model");
    let loaded = rss_mb();
    let t0 = Instant::now();
    for chunk in texts.chunks(batch) {
        model.embed(chunk, None).expect("embed");
    }
    let ms = t0.elapsed().as_millis();
    let after = rss_mb();
    drop(model);
    let dropped = rss_mb();
    // 되돌아온 것이 OS 로 갔는지, malloc 이 쥐고 있는지 — 압력 완화를 부른 뒤 다시.
    #[cfg(target_os = "macos")]
    let relieved = {
        extern "C" {
            fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
        }
        // SAFETY: NULL zone = 모든 zone, goal 0 = 가능한 만큼. 부작용은 페이지 반환뿐.
        let n = unsafe { malloc_zone_pressure_relief(std::ptr::null_mut(), 0) };
        format!(
            "{} (relief 가 돌려준 {:.0} MB)",
            rss_mb(),
            n as f64 / 1048576.0
        )
    };
    #[cfg(not(target_os = "macos"))]
    let relieved = String::from("-");
    // 두 번째 사이클 — 누수(두 배로 늚)인지 재사용(그대로)인지 가른다.
    let mut model2 = TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::ParaphraseMLMiniLML12V2Q)
            .with_cache_dir(cache2)
            .with_max_length(max_len)
            .with_show_download_progress(false),
    )
    .expect("model");
    let loaded2 = rss_mb();
    for chunk in texts.chunks(batch) {
        model2.embed(chunk, None).expect("embed");
    }
    let after2 = rss_mb();
    drop(model2);
    let dropped2 = rss_mb();
    println!("\n== M6 임베딩 아레나 (max_length={max_len}, batch={batch}, n={n}) ==");
    println!("  기준      {base}");
    println!("  모델 로드 {loaded}");
    println!("  임베딩 뒤 {after}");
    println!("  drop 뒤   {dropped}");
    println!("  relief 뒤 {relieved}");
    println!("  2차 로드  {loaded2}");
    println!("  2차 임베딩 {after2}");
    println!("  2차 drop  {dropped2}");
    println!("  임베딩 {n}건 {ms} ms ({:.1} ms/건)", ms as f64 / n as f64);
}

/// M6b — 같은 모델 파일을 ORT 세션으로 직접 열 때 최적화 단계별 상주 풋프린트.
/// fastembed 는 Level3 를 고정한다 (`impl.rs:87`). 로드만으로 637MB 인 이유가
/// 그래프 최적화(프리패킹·융합 사본)인지 파일 자체인지를 가른다.
///
/// ```bash
/// OCULPM_ORT_LEVEL=0|1|2|3 cargo test --release --test perf_baseline m6b -- --ignored --nocapture
/// ```
#[test]
#[ignore = "측정 전용 — 프로세스 하나에 단계 하나"]
fn m6b_session_footprint_by_optimization_level() {
    use ort::session::{builder::GraphOptimizationLevel, Session};
    let level = std::env::var("OCULPM_ORT_LEVEL")
        .ok()
        .and_then(|v| v.parse::<u8>().ok())
        .unwrap_or(3);
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    let cache = home.join("Library/Application Support/com.kimhyunbin.ocul-pm/fastembed_cache");
    let Some(model) = walkdir::WalkDir::new(&cache)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .find(|p| {
            p.extension().is_some_and(|x| x == "onnx")
                && p.to_string_lossy().contains("MiniLM-L12-v2-onnx-Q")
        })
    else {
        println!("모델 캐시 없음 — 건너뜀");
        return;
    };
    fn footprint() -> String {
        let out = std::process::Command::new("vmmap")
            .args(["--summary", &std::process::id().to_string()])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let pick = |prefix: &str| {
            text.lines()
                .find(|l| l.starts_with(prefix))
                .map(|l| l.split_whitespace().take(4).collect::<Vec<_>>().join(" "))
                .unwrap_or_default()
        };
        format!(
            "{} | {} | {} | {}",
            pick("Physical footprint:"),
            pick("MALLOC_LARGE "),
            pick("MALLOC_SMALL "),
            pick("mapped file")
        )
    }
    let opt = match level {
        0 => GraphOptimizationLevel::Disable,
        1 => GraphOptimizationLevel::Level1,
        2 => GraphOptimizationLevel::Level2,
        _ => GraphOptimizationLevel::Level3,
    };
    // OCULPM_ORT_OPTS=noprepack,devalloc,nomempat,threads1,memory — 세션 옵션 조합.
    let opts = std::env::var("OCULPM_ORT_OPTS").unwrap_or_default();
    let has = |k: &str| opts.split(',').any(|o| o == k);
    let base = footprint();
    let t0 = Instant::now();
    let mut b = Session::builder()
        .unwrap()
        .with_optimization_level(opt)
        .unwrap();
    if has("noprepack") {
        b = b.with_prepacking(false).unwrap();
    }
    if has("devalloc") {
        b = b
            .with_config_entry("session.use_device_allocator_for_initializers", "1")
            .unwrap();
    }
    if has("nomempat") {
        b = b.with_memory_pattern(false).unwrap();
    }
    if has("threads1") {
        b = b.with_intra_threads(1).unwrap();
    }
    let session = if has("memory") {
        let bytes = std::fs::read(&model).unwrap();
        b.commit_from_memory(&bytes).expect("session")
    } else {
        b.commit_from_file(&model).expect("session")
    };
    let ms = t0.elapsed().as_millis();
    let loaded = footprint();
    if std::env::var("OCULPM_ORT_FULL").is_ok() {
        let out = std::process::Command::new("vmmap")
            .args(["--summary", &std::process::id().to_string()])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let start = text.find("REGION TYPE").unwrap_or(0);
        println!("{}", &text[start..]);
    }
    drop(session);
    let dropped = footprint();
    extern "C" {
        fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
        fn malloc_default_zone() -> *mut std::ffi::c_void;
    }
    // SAFETY: 기본 zone 에 압력 완화 — 부작용은 free 된 페이지 반환뿐.
    let (relief_all, relief_default) = unsafe {
        (
            malloc_zone_pressure_relief(std::ptr::null_mut(), 0),
            malloc_zone_pressure_relief(malloc_default_zone(), 0),
        )
    };
    let relieved = footprint();
    println!(
        "  relief: all-zones {:.0} MB · default-zone {:.0} MB → {relieved}",
        relief_all as f64 / 1048576.0,
        relief_default as f64 / 1048576.0
    );
    println!(
        "\n== M6b ORT 세션 (level={level}, opts=[{opts}], {}) ==",
        model.file_name().unwrap().to_string_lossy()
    );
    println!(
        "  파일 {:.0} MB",
        std::fs::metadata(&model).map(|m| m.len()).unwrap_or(0) as f64 / 1048576.0
    );
    println!("  기준 {base} → 로드 {loaded} ({ms} ms) → drop {dropped}");
}

/// M7 — 디바운서 `FileIdMap` 이 Create 마다 쌓는 메모리 (`{#fileidmap-growth}`).
///
/// 워처는 `debouncer.watcher().watch(root)` 만 부르고 `cache().add_root` 는 안
/// 부르므로 시작 시 캐시는 비어 있다. 그러나 Create 이벤트마다 `add_path` 가
/// 경로→FileId 를 넣고 Remove 에서만 뺀다 — `target/`·`node_modules/` 처럼 우리
/// 사전 필터 **앞**에서 일어나는 일이라 무시 경로도 전부 쌓인다. `cargo build`
/// 한 번을 흉내 내(파일 N 개 생성) 두 캐시의 풋프린트 차이를 잰다.
///
/// ```bash
/// OCULPM_WATCH_CACHE=fileid OCULPM_WATCH_N=20000 cargo test --release --test perf_baseline m7 -- --ignored --nocapture
/// OCULPM_WATCH_CACHE=none   OCULPM_WATCH_N=20000 cargo test --release --test perf_baseline m7 -- --ignored --nocapture
/// ```
#[test]
#[ignore = "측정 전용 — 프로세스 하나에 캐시 하나"]
fn m7_debouncer_file_id_cache_growth() {
    use notify_debouncer_full::{new_debouncer_opt, FileIdMap, NoCache};
    let n: usize = std::env::var("OCULPM_WATCH_N")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let use_fileid = std::env::var("OCULPM_WATCH_CACHE")
        .map(|v| v != "none")
        .unwrap_or(true);
    fn footprint_mb() -> f64 {
        let out = std::process::Command::new("vmmap")
            .args(["--summary", &std::process::id().to_string()])
            .output()
            .unwrap();
        let line = String::from_utf8_lossy(&out.stdout)
            .lines()
            .find(|l| l.starts_with("Physical footprint:"))
            .map(|l| {
                l.trim_start_matches("Physical footprint:")
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();
        let num: f64 = line
            .trim_end_matches(|c: char| c.is_alphabetic())
            .parse()
            .unwrap_or(0.0);
        if line.ends_with('K') {
            num / 1024.0
        } else if line.ends_with('G') {
            num * 1024.0
        } else {
            num
        }
    }
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("proj");
    std::fs::create_dir_all(root.join("target/debug/deps")).unwrap();
    let (tx, rx) = mpsc::channel::<usize>();
    let handler = move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let _ = tx.send(events.len());
        }
    };
    let base = footprint_mb();
    let mut fileid = None;
    let mut nocache = None;
    if use_fileid {
        let mut d = new_debouncer_opt::<_, notify::RecommendedWatcher, _>(
            Duration::from_millis(500),
            None,
            handler,
            FileIdMap::new(),
            notify::Config::default(),
        )
        .unwrap();
        d.watcher().watch(&root, RecursiveMode::Recursive).unwrap();
        fileid = Some(d);
    } else {
        let mut d = new_debouncer_opt::<_, notify::RecommendedWatcher, _>(
            Duration::from_millis(500),
            None,
            handler,
            NoCache,
            notify::Config::default(),
        )
        .unwrap();
        d.watcher().watch(&root, RecursiveMode::Recursive).unwrap();
        nocache = Some(d);
    }
    std::thread::sleep(Duration::from_millis(300));
    let armed = footprint_mb();
    let t0 = Instant::now();
    for i in 0..n {
        let dir = root.join(format!("target/debug/deps/crate{}", i % 200));
        if i < 200 {
            std::fs::create_dir_all(&dir).unwrap();
        }
        std::fs::write(dir.join(format!("obj-{i:06}.o")), b"x").unwrap();
    }
    let wrote_ms = t0.elapsed().as_millis();
    // 이벤트가 다 흘러나올 때까지.
    let mut seen = 0usize;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(1500)) {
            Ok(k) => seen += k,
            Err(_) => break,
        }
    }
    let after = footprint_mb();
    drop(fileid);
    drop(nocache);
    println!(
        "\n== M7 디바운서 캐시 ({}, 파일 {n}개 생성 {wrote_ms} ms, 이벤트 {seen}) ==",
        if use_fileid { "FileIdMap" } else { "NoCache" }
    );
    println!(
        "  풋프린트 기준 {base:.1} MB → 감시 {armed:.1} MB → 생성 뒤 {after:.1} MB  (Δ {:.1} MB)",
        after - armed
    );
}
