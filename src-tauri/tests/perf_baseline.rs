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
