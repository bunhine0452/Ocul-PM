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

// 테스트 픽스처의 git·셸·자식 프로세스 — 앱이 띄우는 프로세스가 아니라 proc.rs
// 창구 규칙(clippy.toml disallowed-methods) 밖이다.
#![allow(clippy::disallowed_methods)]

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

/// `watcher/handle.rs` 의 해시 상한(`HASH_BYTE_CAP`)과 같은 값.
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
    // (`watcher/handle.rs` `classify`). 지금 이 일은 tokio 런타임 워커 위에서 돈다.
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

    // M2c — **실제 워처**의 스케줄링 계측 (`{#scheduling-telemetry}`). 위의
    // 날것 디바운서는 그대로 두고(측정이 바뀌면 안 된다), 그것을 내린 뒤 같은
    // 파일 집합을 **반대 방향**으로 되돌리는 체크아웃을 `ProjectWatcher` 에
    // 흘린다. 큐가 얼마나 찼는지·처리기가 얼마나 오래 워커를 잡았는지가
    // `WatcherStatus.sched` 로 나온다 — 다음 기준선이 이 줄들을 견준다.
    drop(debouncer);
    let sched = {
        use ocul_pm_lib::oculpm::index::IndexWriter;
        use ocul_pm_lib::oculpm::paths::WorkdayResolver;
        use ocul_pm_lib::oculpm::session::SessionActor;
        use ocul_pm_lib::oculpm::spec::OculpmConfig;
        use ocul_pm_lib::oculpm::watcher::ProjectWatcher;
        use std::sync::Arc;

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
            let writer = Arc::new(IndexWriter::new(clone.clone(), resolver.clone()));
            let mut cfg = OculpmConfig::default_for_new_project();
            cfg.watcher.debounce_ms = u32::try_from(DEBOUNCE_MS).unwrap();
            let actor = SessionActor::spawn(1, resolver, writer.clone(), cfg.session.clone(), None);
            let watcher = ProjectWatcher::start(1, clone.clone(), actor.clone(), cfg, None)
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(500)).await;

            let t2 = Instant::now();
            git(&clone, &["checkout", "--quiet", "--detach", &base]);
            // 정착 = 처리기에 넘긴 수가 디바운스 창 2배 동안 안 늘어남. 보고하는
            // 시각은 **마지막으로 늘어난 순간**이다 — 기다린 창은 빼야 M2 의
            // "체크아웃~정적화" 와 같은 뜻이 된다. 세션 액터가 5초 뒤에 쓰는
            // `sessions.json` 도 `.oculpm/index/` 아래라 큐를 한 번 지나가는데,
            // 그건 홍수가 아니라 장부라 여기서 기다리지 않는다.
            let mut last = 0u32;
            let mut last_change = Instant::now();
            let deadline = t2 + Duration::from_secs(12);
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                let now = watcher.sched_stats().events_total;
                if now != last {
                    last = now;
                    last_change = Instant::now();
                } else if now > 0 && last_change.elapsed() >= Duration::from_millis(DEBOUNCE_MS * 2)
                {
                    break;
                }
                if Instant::now() >= deadline {
                    break;
                }
            }
            let settle_ms = last_change.duration_since(t2).as_millis();
            let sched = watcher.sched_stats();
            watcher.stop().await.unwrap();
            actor.shutdown().await.unwrap();
            (sched, settle_ms)
        })
    };
    let (sched, settle_ms) = sched;
    println!("\n== M2c 실제 워처 스케줄링 계측 (역방향 체크아웃, 같은 파일 집합) ==");
    println!("  events_total     : {}", sched.events_total);
    println!("  dropped_total    : {}", sched.dropped_total);
    println!("  queue_high_water : {}", sched.queue_high_water);
    println!("  handle_ms_total  : {} ms", sched.handle_ms_total);
    println!("  handle_max_ms    : {} ms", sched.handle_max_ms);
    println!("  체크아웃~정착     : {settle_ms} ms");

    assert!(changed_files > 0, "측정 대상 diff 가 비어 있다");
}

// ─── M4 — 단일 연결 DB 액터의 처리량 ────────────────────────────────────────
//
// 워처가 파일당 스케줄하는 diff 기준선 동기는 전부 이 한 줄 큐를 지난다 (4.0
// 전엔 코드 색인이었다). 브랜치 전환 한 번이 M2 의 경로 수만큼 이 큐에 실린다.
// (M3 색인 CPU 심 · M5 vec0 정리 · M6 임베딩 아레나는 색인과 함께 걷었다.)

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
            db.upsert_file_snapshot(
                pid,
                format!("src/f{i}.rs"),
                b"fn f() {}\n".to_vec(),
                format!("{i:064x}"),
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
                    .upsert_file_snapshot(
                        pid,
                        format!("src/g{i}.rs"),
                        b"fn g() {}\n".to_vec(),
                        format!("{i:064x}"),
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
