//! 실제 `lldb-dap` 과의 왕복 — 단위 테스트가 못 잡는 것을 잡는다.
//!
//! `protocol`/`registry`/`spec` 단위 테스트는 전부 **우리가 만든 입력**을 검사한다.
//! 진짜 어댑터가 우리 `initialize` 를 받아들이는지, 중단점이 정말 걸리는지,
//! `initialized` 가 언제 오든 상태 기계가 안 갇히는지는 실제 프로세스로만 확인된다.
//!
//! 설계 문서(#no-order, #path-format)의 두 결정이 바로 이 왕복에서 나왔다.
//!
//! 어댑터나 `rustc` 가 없으면 **건너뛴다** — 그 도구가 없는 기기에서 전체
//! 스위트가 빨개지면 안 된다 (건너뛸 때는 그 사실을 출력한다).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ocul_pm_lib::dap::client::{initialize_arguments, AdapterNotice, DapClient};
use ocul_pm_lib::dap::registry::{adapter_by_id, resolve_adapter, AdapterCommand};
use ocul_pm_lib::dap::spec::{
    breakpoints_from_json, frames_from_json, scopes_from_json, variables_from_json, wire_id,
};

/// 디버그 심벌이 든 최소 바이너리. 의존성이 없어 오프라인에서도 빌드된다.
fn build_demo(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let src = dir.join("demo.rs");
    std::fs::write(
        &src,
        "fn add(a: i64, b: i64) -> i64 {\n    let sum = a + b;\n    sum\n}\n\
         fn main() {\n    let 값 = add(2, 40);\n    println!(\"{}\", 값);\n}\n",
    )
    .ok()?;
    let out = dir.join("demo");
    let status = std::process::Command::new("rustc")
        .args(["-g", "-o"])
        .arg(&out)
        .arg(&src)
        .status()
        .ok()?;
    status.success().then_some((src, out))
}

async fn adapter() -> Option<AdapterCommand> {
    resolve_adapter(adapter_by_id("rust")?).await
}

/// 이벤트를 모으는 싱크 + "그 이벤트가 왔나" 폴링.
#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<(String, serde_json::Value)>>>);

impl Events {
    fn sink(&self) -> Arc<dyn Fn(AdapterNotice) + Send + Sync> {
        let log = self.0.clone();
        Arc::new(move |notice| {
            if let AdapterNotice::Event { event, body } = notice {
                log.lock().unwrap().push((event, body));
            }
        })
    }

    /// **이미 온 것도 센다** — 순서를 가정하지 않는 것이 이 테스트의 요점이다.
    async fn wait(&self, name: &str, from: usize) -> Option<(serde_json::Value, usize)> {
        for _ in 0..300 {
            {
                let log = self.0.lock().unwrap();
                if let Some(i) = log.iter().skip(from).position(|(e, _)| e == name) {
                    return Some((log[from + i].1.clone(), log.len()));
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        None
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn lldb_dap_runs_a_whole_session() {
    let Some(cmd) = adapter().await else {
        eprintln!("lldb-dap 이 없어 건너뜁니다 (xcode-select --install)");
        return;
    };
    let tmp = tempfile::TempDir::new().unwrap();
    let Some((src, program)) = build_demo(tmp.path()) else {
        eprintln!("rustc 가 없어 건너뜁니다");
        return;
    };

    let events = Events::default();
    let client = DapClient::start(
        "lldb-dap".to_string(),
        &cmd,
        tmp.path(),
        std::env::var("PATH").unwrap_or_default(),
        events.sink(),
    )
    .await
    .expect("어댑터 기동");

    // ── initialize ──────────────────────────────────────────────────────────
    // `pathFormat` 이 빠지면 lldb-dap 이 success:false 로 답한다 (#path-format).
    let caps = client
        .request("initialize", Some(initialize_arguments("lldb")))
        .await
        .expect("initialize");
    assert_eq!(
        caps.get("supportsConfigurationDoneRequest")
            .and_then(|v| v.as_bool()),
        Some(true),
        "능력 협상이 실제로 왔다"
    );

    // ── launch 는 응답을 기다리지 않고 보낸다 (#no-order) ────────────────────
    let launch = {
        let client = client.clone();
        let program = program.clone();
        tokio::spawn(async move {
            client
                .request_with_timeout(
                    "launch",
                    Some(serde_json::json!({
                        "program": program.to_string_lossy(),
                        "stopOnEntry": false,
                    })),
                    Duration::from_secs(60),
                )
                .await
        })
    };

    // `initialized` 는 launch 응답보다 **먼저 올 수도, 나중에 올 수도** 있다.
    // 실측에서 같은 어댑터가 실행마다 달랐다 — 그래서 순서를 안 가정한다.
    let (_, mark) = events
        .wait("initialized", 0)
        .await
        .expect("initialized 이벤트");

    // ── 중단점 → configurationDone ──────────────────────────────────────────
    let body = client
        .request(
            "setBreakpoints",
            Some(serde_json::json!({
                "source": { "path": src.to_string_lossy() },
                "breakpoints": [{ "line": 2 }],
            })),
        )
        .await
        .expect("setBreakpoints");
    let confirmed = breakpoints_from_json(&body, "demo.rs", &[2]);
    assert_eq!(confirmed.len(), 1);
    assert!(confirmed[0].verified, "2행에는 코드가 있다: {confirmed:?}");
    assert_eq!(confirmed[0].line, 2, "1-based 그대로");

    client.request("configurationDone", None).await.ok();
    launch.await.expect("launch 작업").expect("launch 성공");

    // ── 멈춤 → 스택 → 스코프 → 변수 ─────────────────────────────────────────
    let (stopped, mark) = events.wait("stopped", mark).await.expect("stopped 이벤트");
    assert_eq!(
        stopped.get("reason").and_then(|v| v.as_str()),
        Some("breakpoint")
    );
    let thread_id = stopped
        .get("threadId")
        .and_then(|v| v.as_i64())
        .expect("threadId");

    let body = client
        .request(
            "stackTrace",
            Some(serde_json::json!({ "threadId": thread_id, "startFrame": 0, "levels": 8 })),
        )
        .await
        .expect("stackTrace");
    // 프로젝트 루트를 tmp 로 주면 demo.rs 가 "안" 으로, 표준 라이브러리가 "밖" 으로 갈린다.
    let frames = frames_from_json(&body, tmp.path());
    assert!(!frames.is_empty());
    assert_eq!(frames[0].line, 2, "멈춘 줄이 그대로 온다 (1-based)");
    assert_eq!(frames[0].path.as_deref(), Some("demo.rs"), "{frames:?}");
    assert!(
        frames.iter().any(|f| f.path.is_none()),
        "표준 라이브러리 프레임은 프로젝트 밖으로 갈린다: {frames:?}"
    );

    let body = client
        // 핸들은 정수로 되돌려 보내야 한다 — `3.0` 이면 어댑터가 거절한다.
        .request(
            "scopes",
            Some(serde_json::json!({ "frameId": wire_id(frames[0].id) })),
        )
        .await
        .expect("scopes");
    let scopes = scopes_from_json(&body);
    let locals = scopes
        .iter()
        .find(|s| s.variables_reference != 0.0)
        .expect("펼칠 수 있는 스코프");

    let body = client
        .request(
            "variables",
            Some(serde_json::json!({ "variablesReference": wire_id(locals.variables_reference) })),
        )
        .await
        .expect("variables");
    let vars = variables_from_json(&body);
    let a = vars
        .iter()
        .find(|v| v.name == "a")
        .expect("인자 a: {vars:?}");
    assert_eq!(a.value, "2");
    assert_eq!(
        vars.iter()
            .find(|v| v.name == "b")
            .map(|v| v.value.as_str()),
        Some("40")
    );

    // ── 스텝 → 계속 → 종료 ──────────────────────────────────────────────────
    client
        .request("next", Some(serde_json::json!({ "threadId": thread_id })))
        .await
        .expect("next");
    let (stopped, mark) = events.wait("stopped", mark).await.expect("스텝 후 stopped");
    assert_eq!(stopped.get("reason").and_then(|v| v.as_str()), Some("step"));

    client
        .request(
            "continue",
            Some(serde_json::json!({ "threadId": thread_id })),
        )
        .await
        .expect("continue");
    assert!(
        events.wait("terminated", mark).await.is_some(),
        "프로그램이 끝나면 terminated 가 온다 — 이게 없으면 UI 가 Running 에 갇힌다"
    );

    let _ = client
        .request(
            "disconnect",
            Some(serde_json::json!({ "terminateDebuggee": true })),
        )
        .await;
    client.kill().await;
}

/// 없는 프로그램으로 launch 하면 **오류가 응답으로** 온다 (전송 실패가 아니라).
/// `success: false` 를 오류로 승격하는 상관 코드가 실제로 도는지 본다.
#[tokio::test(flavor = "multi_thread")]
async fn a_bad_program_fails_as_a_response_not_a_hang() {
    let Some(cmd) = adapter().await else {
        eprintln!("lldb-dap 이 없어 건너뜁니다");
        return;
    };
    let tmp = tempfile::TempDir::new().unwrap();
    let events = Events::default();
    let client = DapClient::start(
        "lldb-dap".to_string(),
        &cmd,
        tmp.path(),
        std::env::var("PATH").unwrap_or_default(),
        events.sink(),
    )
    .await
    .expect("어댑터 기동");

    client
        .request("initialize", Some(initialize_arguments("lldb")))
        .await
        .expect("initialize");
    let err = client
        .request_with_timeout(
            "launch",
            Some(serde_json::json!({ "program": tmp.path().join("does-not-exist") })),
            Duration::from_secs(30),
        )
        .await
        .unwrap_err();
    // 시간 초과가 아니라 어댑터가 준 이유여야 한다.
    assert!(
        !err.contains("시간을 넘겼습니다"),
        "매달리지 않고 즉시 이유를 돌려줘야 한다: {err}"
    );
    client.kill().await;
}
