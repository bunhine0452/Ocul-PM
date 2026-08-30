//! 디버그 세션 하나 — **이벤트 구동 상태 기계**
//! (docs/dap/00-master-plan.md #lifecycle #no-order).
//!
//! LSP 와 가장 크게 다른 부분이다. 언어 서버는 `(project, language, root)` 로
//! 하나가 오래 살지만, 디버그 세션은 **실행 한 번**이다: 떴다가, 멈췄다가, 죽는다.
//!
//! 그리고 순서를 가정할 수 없다. 실측에서 같은 어댑터가 실행마다 다르게 답했다:
//!
//! ```text
//! run A: initialize응답 → launch응답 → initialized
//! run B: initialize응답 → module → module → launch응답 → initialized
//! run C: initialize응답 → initialized → launch응답
//! ```
//!
//! 그래서 `launch` 응답을 기다리지 않고 보낸 뒤, `initialized` 를 **이미 왔는지
//! 까지 보고** 기다린다. 순차 스크립트로 짜면 run A/B 에서 영영 멈춘다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{Mutex, Notify};

use super::client::{
    check_program, initialize_arguments, resolve_program, AdapterNotice, DapClient, LAUNCH_TIMEOUT,
};
use super::registry::AdapterSpec;
use super::spec::{breakpoints_from_json, DapBreakpoint, DapSessionInfo, DapState};

/// 세션이 밖으로 내보내는 신호. 커맨드 층이 Tauri 이벤트로 바꿔 프런트에 올린다.
#[derive(Debug, Clone)]
pub enum SessionSignal {
    State(DapSessionInfo),
    Output(super::spec::DapOutput),
    /// 중단점 확정 상태가 바뀌었다 (어댑터가 옮겼거나 못 걸었거나).
    Breakpoints(Vec<DapBreakpoint>),
}

pub type SignalSink = Arc<dyn Fn(SessionSignal) + Send + Sync>;

/// 순서를 가정하지 않기 위한 한 칸짜리 걸쇠.
///
/// "아직 안 왔으면 기다리고, 이미 왔으면 즉시 통과" 가 필요한데 `oneshot` 은
/// 소비되면 끝이라 재확인이 안 되고, 순수 `Notify` 는 **먼저 온 알림을 잃는다**.
/// 둘을 합쳐 둔다.
#[derive(Default)]
struct Latch {
    fired: Mutex<bool>,
    notify: Notify,
}

impl Latch {
    async fn fire(&self) {
        *self.fired.lock().await = true;
        self.notify.notify_waiters();
    }

    async fn wait(&self, timeout: std::time::Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if *self.fired.lock().await {
                return true;
            }
            // notified() 를 먼저 만들어야 검사와 대기 사이의 알림을 놓치지 않는다.
            let notified = self.notify.notified();
            if *self.fired.lock().await {
                return true;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return false;
            }
        }
    }
}

/// 중단점 저장소 — **세션보다 오래 산다** (#breakpoints).
/// 세션이 죽어도 찍어 둔 자리는 남아야 한다.
#[derive(Default)]
pub struct BreakpointStore {
    /// 프로젝트 상대 경로 → 줄(1-based) 집합. 정렬을 위해 BTree.
    by_file: BTreeMap<String, Vec<u32>>,
}

impl BreakpointStore {
    /// 한 줄을 켜고 끈다. 결과(그 파일의 최종 목록)를 돌려준다.
    pub fn toggle(&mut self, path: &str, line: u32) -> Vec<u32> {
        let lines = self.by_file.entry(path.to_string()).or_default();
        match lines.iter().position(|&l| l == line) {
            Some(i) => {
                lines.remove(i);
            }
            None => {
                lines.push(line);
                lines.sort_unstable();
            }
        }
        let out = lines.clone();
        if out.is_empty() {
            self.by_file.remove(path);
        }
        out
    }

    pub fn lines_for(&self, path: &str) -> Vec<u32> {
        self.by_file.get(path).cloned().unwrap_or_default()
    }

    pub fn files(&self) -> Vec<(String, Vec<u32>)> {
        self.by_file
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn clear(&mut self) {
        self.by_file.clear();
    }

    /// 파일이 옮겨졌다 — 찍어 둔 자리가 따라간다 (탭·버퍼와 같은 정합 규칙).
    pub fn rename_path(&mut self, from: &str, to: &str, is_dir: bool) {
        let keys: Vec<String> = self
            .by_file
            .keys()
            .filter(|k| *k == from || (is_dir && k.starts_with(&format!("{from}/"))))
            .cloned()
            .collect();
        for key in keys {
            let Some(lines) = self.by_file.remove(&key) else {
                continue;
            };
            let next = if key == from {
                to.to_string()
            } else {
                format!("{to}{}", &key[from.len()..])
            };
            self.by_file.insert(next, lines);
        }
    }
}

/// 실행 구성 — 무엇을 어떻게 띄울지 (#dap-config).
#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub language_id: String,
    /// 프로젝트 상대 또는 절대 경로.
    pub program: String,
    pub args: Vec<String>,
    /// 시작하자마자 첫 줄에서 멈출지.
    pub stop_on_entry: bool,
    /// 작업 디렉터리 (비면 프로젝트 루트).
    pub cwd: Option<String>,
}

pub struct DapSession {
    spec: &'static AdapterSpec,
    project_root: PathBuf,
    program_label: String,
    client: Arc<DapClient>,
    sink: SignalSink,
    /// `initialized` 이벤트 걸쇠 — 순서를 가정하지 않기 위한 것.
    initialized: Arc<Latch>,
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    state: DapState,
    stopped_reason: Option<String>,
    thread_id: Option<i64>,
    detail: Option<String>,
}

impl DapSession {
    /// 어댑터를 띄우고 `initialize` 까지. 아직 프로그램은 안 돈다.
    pub async fn start(
        spec: &'static AdapterSpec,
        adapter: &super::registry::AdapterCommand,
        project_root: PathBuf,
        config: &LaunchConfig,
        path_env: String,
        sink: SignalSink,
    ) -> Result<Arc<Self>, String> {
        let program = resolve_program(&project_root, &config.program);
        check_program(&program)?;

        let initialized = Arc::new(Latch::default());
        let inner = Arc::new(Mutex::new(Inner {
            state: DapState::Starting,
            ..Default::default()
        }));

        let cwd = config
            .cwd
            .as_deref()
            .filter(|c| !c.trim().is_empty())
            .map(|c| resolve_program(&project_root, c))
            .unwrap_or_else(|| project_root.clone());

        // 이벤트 싱크는 클라이언트를 만들기 전에 필요하므로 상태를 먼저 묶는다.
        let notice_sink = {
            let initialized = initialized.clone();
            let inner = inner.clone();
            let sink = sink.clone();
            let spec_lang = spec.language_id;
            let label = config.program.clone();
            let root = project_root.clone();
            Arc::new(move |notice: AdapterNotice| {
                let initialized = initialized.clone();
                let inner = inner.clone();
                let sink = sink.clone();
                let label = label.clone();
                let root = root.clone();
                tauri::async_runtime::spawn(async move {
                    handle_notice(
                        notice,
                        spec_lang,
                        &label,
                        &root,
                        &initialized,
                        &inner,
                        &sink,
                    )
                    .await;
                });
            })
        };

        let client = DapClient::start(
            format!("{} 디버그 어댑터", spec.language_id),
            adapter,
            &cwd,
            path_env,
            notice_sink,
        )
        .await?;

        let session = Arc::new(Self {
            spec,
            project_root,
            program_label: config.program.clone(),
            client,
            sink,
            initialized,
            inner,
        });
        session.emit_state().await;

        session
            .client
            .request("initialize", Some(initialize_arguments(spec.adapter_id)))
            .await?;
        Ok(session)
    }

    /// `launch` → `initialized` → 중단점 → `configurationDone`.
    ///
    /// **`launch` 응답을 기다리지 않고 보낸다** (#no-order). 어댑터에 따라
    /// `configurationDone` 을 받아야 launch 가 끝나므로, 기다리면 교착이다.
    pub async fn launch(
        self: &Arc<Self>,
        config: &LaunchConfig,
        breakpoints: Vec<(String, Vec<u32>)>,
    ) -> Result<(), String> {
        let program = resolve_program(&self.project_root, &config.program);
        let args = json!({
            "program": program.to_string_lossy(),
            "args": config.args,
            "stopOnEntry": config.stop_on_entry,
            "cwd": config.cwd.clone().unwrap_or_else(|| self.project_root.to_string_lossy().to_string()),
        });

        let client = self.client.clone();
        let launch = tauri::async_runtime::spawn(async move {
            client
                .request_with_timeout("launch", Some(args), LAUNCH_TIMEOUT)
                .await
        });

        if !self.initialized.wait(LAUNCH_TIMEOUT).await {
            return Err("어댑터가 initialized 이벤트를 보내지 않았습니다".to_string());
        }
        self.set_state(DapState::Configuring, None).await;

        for (path, lines) in breakpoints {
            // 하나가 실패해도 나머지는 건다 — 파일 하나 때문에 세션 전체를
            // 포기하는 것이 더 나쁘다.
            if let Err(e) = self.push_breakpoints(&path, &lines).await {
                tracing::warn!(target: "dap", path, error = %e, "중단점을 걸지 못했다");
            }
        }
        self.client.request("configurationDone", None).await.ok();

        match launch.await {
            Ok(Ok(_)) => {
                self.set_state(DapState::Running, None).await;
                Ok(())
            }
            Ok(Err(e)) => {
                self.set_state(DapState::Ended, Some(e.clone())).await;
                Err(e)
            }
            Err(e) => Err(format!("launch 작업이 끊겼습니다: {e}")),
        }
    }

    /// 한 파일의 중단점을 **전량 교체**한다 — DAP 에 증분이 없다 (#breakpoints).
    pub async fn push_breakpoints(&self, path: &str, lines: &[u32]) -> Result<(), String> {
        let abs = self.project_root.join(path);
        let body = self
            .client
            .request(
                "setBreakpoints",
                Some(json!({
                    "source": { "path": abs.to_string_lossy() },
                    "breakpoints": lines.iter().map(|l| json!({ "line": l })).collect::<Vec<_>>(),
                })),
            )
            .await?;
        (self.sink)(SessionSignal::Breakpoints(breakpoints_from_json(
            &body, path, lines,
        )));
        Ok(())
    }

    pub async fn request(&self, command: &str, arguments: Option<Value>) -> Result<Value, String> {
        self.client.request(command, arguments).await
    }

    pub async fn info(&self) -> DapSessionInfo {
        let inner = self.inner.lock().await;
        DapSessionInfo {
            state: inner.state,
            language_id: self.spec.language_id.to_string(),
            program: self.program_label.clone(),
            stopped_reason: inner.stopped_reason.clone(),
            // 내부는 i64, IPC 는 f64 (spec.rs 주석).
            thread_id: inner.thread_id.map(|t| t as f64),
            detail: inner.detail.clone(),
        }
    }

    pub async fn state(&self) -> DapState {
        self.inner.lock().await.state
    }

    pub async fn thread_id(&self) -> Option<i64> {
        self.inner.lock().await.thread_id
    }

    /// 정리 — `disconnect` 를 예의 있게 보내고, 안 되면 죽인다.
    pub async fn stop(&self) {
        let _ = self
            .client
            .request("disconnect", Some(json!({ "terminateDebuggee": true })))
            .await;
        self.client.kill().await;
        self.set_state(DapState::Ended, None).await;
    }

    async fn set_state(&self, state: DapState, detail: Option<String>) {
        {
            let mut inner = self.inner.lock().await;
            inner.state = state;
            if detail.is_some() {
                inner.detail = detail;
            }
            if state != DapState::Stopped {
                inner.stopped_reason = None;
            }
        }
        self.emit_state().await;
    }

    async fn emit_state(&self) {
        (self.sink)(SessionSignal::State(self.info().await));
    }
}

/// 어댑터가 먼저 건 말을 상태 기계에 반영한다.
async fn handle_notice(
    notice: AdapterNotice,
    language_id: &'static str,
    program: &str,
    _root: &Path,
    initialized: &Arc<Latch>,
    inner: &Arc<Mutex<Inner>>,
    sink: &SignalSink,
) {
    let emit = |inner_snapshot: Inner| {
        (sink)(SessionSignal::State(DapSessionInfo {
            state: inner_snapshot.state,
            language_id: language_id.to_string(),
            program: program.to_string(),
            stopped_reason: inner_snapshot.stopped_reason.clone(),
            thread_id: inner_snapshot.thread_id.map(|t| t as f64),
            detail: inner_snapshot.detail.clone(),
        }));
    };
    let snapshot = |i: &Inner| Inner {
        state: i.state,
        stopped_reason: i.stopped_reason.clone(),
        thread_id: i.thread_id,
        detail: i.detail.clone(),
    };

    match notice {
        AdapterNotice::Event { event, body } => match event.as_str() {
            "initialized" => initialized.fire().await,
            "stopped" => {
                let mut i = inner.lock().await;
                i.state = DapState::Stopped;
                i.stopped_reason = body
                    .get("reason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                // threadId 가 없는 어댑터도 있다 — 그때는 직전 값을 유지한다.
                if let Some(t) = body.get("threadId").and_then(Value::as_i64) {
                    i.thread_id = Some(t);
                }
                let s = snapshot(&i);
                drop(i);
                emit(s);
            }
            "continued" => {
                let mut i = inner.lock().await;
                i.state = DapState::Running;
                i.stopped_reason = None;
                let s = snapshot(&i);
                drop(i);
                emit(s);
            }
            "output" => {
                if let Some(out) = super::spec::output_from_json(&body) {
                    (sink)(SessionSignal::Output(out));
                }
            }
            "terminated" | "exited" => {
                let mut i = inner.lock().await;
                i.state = DapState::Ended;
                i.stopped_reason = None;
                if event == "exited" {
                    if let Some(code) = body.get("exitCode").and_then(Value::as_i64) {
                        i.detail = Some(format!("종료 코드 {code}"));
                    }
                }
                let s = snapshot(&i);
                drop(i);
                emit(s);
            }
            // thread·module·breakpoint 이벤트는 v1 에서 상태를 바꾸지 않는다.
            _ => {}
        },
        AdapterNotice::Exited { detail } => {
            let mut i = inner.lock().await;
            i.state = DapState::Ended;
            i.stopped_reason = None;
            if detail.is_some() {
                i.detail = detail;
            }
            let s = snapshot(&i);
            drop(i);
            emit(s);
            // 걸쇠를 풀어 준다 — launch 가 initialized 를 기다리다 갇히지 않게.
            initialized.fire().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breakpoints_toggle_and_stay_sorted() {
        let mut store = BreakpointStore::default();
        assert_eq!(store.toggle("src/a.rs", 10), vec![10]);
        assert_eq!(store.toggle("src/a.rs", 3), vec![3, 10]);
        assert_eq!(store.toggle("src/a.rs", 7), vec![3, 7, 10]);
        // 같은 줄을 다시 누르면 꺼진다.
        assert_eq!(store.toggle("src/a.rs", 7), vec![3, 10]);
        assert_eq!(store.lines_for("src/a.rs"), vec![3, 10]);
        assert!(store.lines_for("src/other.rs").is_empty());
    }

    #[test]
    fn a_file_with_no_breakpoints_left_disappears() {
        // 빈 목록을 남기면 세션 시작 때 빈 setBreakpoints 를 파일마다 쏜다.
        let mut store = BreakpointStore::default();
        store.toggle("src/a.rs", 1);
        store.toggle("src/a.rs", 1);
        assert!(store.files().is_empty());
    }

    #[test]
    fn breakpoints_follow_a_renamed_file_and_folder() {
        let mut store = BreakpointStore::default();
        store.toggle("src/a.rs", 5);
        store.toggle("src/deep/b.rs", 9);
        store.toggle("src-old/c.rs", 1);

        store.rename_path("src/a.rs", "src/z.rs", false);
        assert_eq!(store.lines_for("src/z.rs"), vec![5]);
        assert!(store.lines_for("src/a.rs").is_empty());

        store.rename_path("src", "lib", true);
        assert_eq!(store.lines_for("lib/deep/b.rs"), vec![9]);
        // 접두사만 겹치는 형제는 안 건드린다.
        assert_eq!(store.lines_for("src-old/c.rs"), vec![1]);
    }

    /// 걸쇠는 **먼저 온 알림도 잡아야** 한다 — 이게 이 라운드의 핵심 함정이다
    /// (`initialized` 가 `launch` 응답보다 먼저 오는 실행이 있다).
    #[tokio::test]
    async fn latch_passes_when_the_signal_arrived_first() {
        let latch = Latch::default();
        latch.fire().await;
        assert!(latch.wait(std::time::Duration::from_millis(50)).await);
    }

    #[tokio::test]
    async fn latch_waits_for_a_later_signal() {
        let latch = Arc::new(Latch::default());
        let l = latch.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            l.fire().await;
        });
        assert!(latch.wait(std::time::Duration::from_secs(2)).await);
    }

    #[tokio::test]
    async fn latch_gives_up_rather_than_hanging() {
        let latch = Latch::default();
        assert!(!latch.wait(std::time::Duration::from_millis(30)).await);
    }
}
