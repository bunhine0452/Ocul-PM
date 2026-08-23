//! 디버그 어댑터 프로세스 하나 — spawn · 요청 상관 · 이벤트 라우팅.
//!
//! `lsp/client.rs` 와 골격은 같지만(프레이밍은 `crate::framing` 공용) 두 가지가
//! 다르다:
//!
//! 1. **상관 키가 `request_seq`** 이고 실패가 `success: false` 다 (#envelope).
//! 2. **순서를 가정하지 않는다** (#no-order). `initialized` 가 `launch` 응답보다
//!    먼저 올 수도, 나중에 올 수도 있다 — 같은 어댑터가 실행마다 달랐다. 그래서
//!    이벤트는 싱크로 흘려보내고, 세션이 상태 기계로 받는다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

use crate::framing::{encode_frame, parse_frame, Frame};

use super::protocol::{parse_incoming, request, response, Incoming};
use super::registry::AdapterCommand;

/// 요청 하나의 상한. 디버거는 사람의 조작에 붙어 있어 오래 붙들면 UI 가 멎는다.
/// 포기해도 세션은 살아 있고 다음 조작은 다시 시도된다.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// `launch`/`attach` 는 더 후하게 — 프로그램을 실제로 띄우는 단계다.
pub const LAUNCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// 어댑터가 먼저 거는 말.
#[derive(Debug, Clone)]
pub enum AdapterNotice {
    Event { event: String, body: Value },
    /// 프로세스가 끝났다 (크래시 포함). 마지막 stderr 를 함께 준다 — 어댑터가
    /// 기동 직후 죽으면 그 줄이 유일한 진단이다 (LSP 에서 배운 것).
    Exited { detail: Option<String> },
}

type NoticeSink = Arc<dyn Fn(AdapterNotice) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>;

pub struct DapClient {
    label: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_seq: AtomicI64,
    pending: Pending,
    last_stderr: Arc<Mutex<String>>,
}

impl DapClient {
    /// 어댑터를 띄운다. `initialize` 는 **부르지 않는다** — 그건 세션의 일이다
    /// (능력 협상 결과를 세션이 들고 상태 기계를 돌려야 하므로).
    pub async fn start(
        label: String,
        adapter: &AdapterCommand,
        cwd: &Path,
        path_env: String,
        on_notice: NoticeSink,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = tokio::process::Command::new(&adapter.program);
        cmd.args(&adapter.args)
            .current_dir(cwd)
            .env("PATH", path_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // 파이프를 열고 안 읽으면 어댑터가 stderr 를 채우다 블록된다.
            .stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            format!("{} 를 띄우지 못했습니다: {e}", adapter.program.display())
        })?;
        let stdin = child.stdin.take().ok_or("stdin 파이프 없음")?;
        let stdout = child.stdout.take().ok_or("stdout 파이프 없음")?;
        let last_stderr = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            spawn_stderr_drain(label.clone(), stderr, last_stderr.clone());
        }

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let client = Arc::new(Self {
            label,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            // DAP 의 seq 는 1부터 단조 증가한다.
            next_seq: AtomicI64::new(1),
            pending: pending.clone(),
            last_stderr: last_stderr.clone(),
        });

        spawn_read_loop(stdout, pending, on_notice, last_stderr, client.clone());
        Ok(client)
    }

    pub async fn request(&self, command: &str, arguments: Option<Value>) -> Result<Value, String> {
        self.request_with_timeout(command, arguments, REQUEST_TIMEOUT).await
    }

    pub async fn request_with_timeout(
        &self,
        command: &str,
        arguments: Option<Value>,
        timeout: std::time::Duration,
    ) -> Result<Value, String> {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(seq, tx);

        if let Err(e) = self.send(&request(seq, command, arguments)).await {
            self.pending.lock().await.remove(&seq);
            return Err(e);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            // 읽기 루프가 끝났다 = 어댑터가 죽었다.
            Ok(Err(_)) => Err(self.exit_message().await),
            Err(_) => {
                self.pending.lock().await.remove(&seq);
                Err(format!("{command} 요청이 시간을 넘겼습니다"))
            }
        }
    }

    /// 어댑터가 우리에게 건 요청에 답한다. v1 은 전부 거절이지만 **답은 한다** —
    /// 무시하면 어댑터가 응답을 기다리며 영영 멈춘다.
    pub async fn reply_reverse(&self, request_seq: i64, command: &str, message: &str) {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let _ = self
            .send(&response(seq, request_seq, command, false, message))
            .await;
    }

    async fn send(&self, body: &str) -> Result<(), String> {
        let bytes = encode_frame(body);
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|e| format!("디버그 어댑터로 쓰지 못했습니다: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("디버그 어댑터 플러시 실패: {e}"))
    }

    async fn exit_message(&self) -> String {
        let stderr = self.last_stderr.lock().await.clone();
        let base = format!("{} 가 응답 전에 종료됐습니다", self.label);
        if stderr.trim().is_empty() {
            base
        } else {
            format!("{base} — {}", stderr.trim())
        }
    }

    /// 프로세스를 정리한다. `disconnect` 는 세션이 먼저 보낸다 — 여기는 마지막 수단.
    pub async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
    }
}

fn spawn_stderr_drain(
    label: String,
    stderr: tokio::process::ChildStderr,
    last: Arc<Mutex<String>>,
) {
    tauri::async_runtime::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                *last.lock().await = line.clone();
            }
            tracing::debug!(target: "dap", adapter = %label, "{line}");
        }
    });
}

/// stdout 읽기 루프 — 프레임을 떼어 응답은 대기자에게, 이벤트는 싱크로.
fn spawn_read_loop(
    mut stdout: tokio::process::ChildStdout,
    pending: Pending,
    on_notice: NoticeSink,
    last_stderr: Arc<Mutex<String>>,
    client: Arc<DapClient>,
) {
    tauri::async_runtime::spawn(async move {
        let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
        let mut chunk = [0u8; 8192];
        loop {
            let n = match stdout.read(&mut chunk).await {
                Ok(0) | Err(_) => break, // EOF 또는 파이프 오류 = 어댑터 종료
                Ok(n) => n,
            };
            buf.extend_from_slice(&chunk[..n]);
            loop {
                match parse_frame(&buf) {
                    Frame::Message { body, consumed } => {
                        buf.drain(..consumed);
                        route(&body, &pending, &on_notice, &client).await;
                    }
                    Frame::Incomplete => break,
                    Frame::Invalid(why) => {
                        tracing::warn!(target: "dap", why, "프레이밍 위반 — 연결을 끊는다");
                        buf.clear();
                        break;
                    }
                }
            }
        }
        // 종료 — 대기 중인 요청을 전부 깨운다. 안 그러면 호출자가 타임아웃까지
        // 붙들려 있는다.
        let detail = {
            let s = last_stderr.lock().await.clone();
            (!s.trim().is_empty()).then(|| s.trim().to_string())
        };
        for (_, tx) in pending.lock().await.drain() {
            let _ = tx.send(Err("디버그 어댑터가 종료됐습니다".to_string()));
        }
        on_notice(AdapterNotice::Exited { detail });
    });
}

async fn route(raw: &[u8], pending: &Pending, on_notice: &NoticeSink, client: &Arc<DapClient>) {
    let Some(incoming) = parse_incoming(raw) else {
        // 메시지 하나가 이상하다고 세션 전체를 끊지 않는다.
        tracing::warn!(target: "dap", "읽을 수 없는 메시지 — 버린다");
        return;
    };
    match incoming {
        Incoming::Response { request_seq, command, success, message, body } => {
            if let Some(tx) = pending.lock().await.remove(&request_seq) {
                let result = if success {
                    Ok(body)
                } else {
                    // `success: false` 는 전송 오류가 아니라 "그 요청을 못 했다".
                    Err(message.unwrap_or_else(|| format!("{command} 요청이 거절됐습니다")))
                };
                let _ = tx.send(result);
            }
        }
        Incoming::Event { event, body } => on_notice(AdapterNotice::Event { event, body }),
        Incoming::ReverseRequest { seq, command, .. } => {
            // v1 은 `runInTerminal` 류를 지원하지 않는다. 거절도 응답이다.
            client
                .reply_reverse(seq, &command, "ocul-pm 은 이 요청을 지원하지 않습니다")
                .await;
        }
    }
}

/// `initialize` 인자. `pathFormat` 은 **반드시** 보낸다 — 빼면 lldb-dap 이
/// `success: false` 로 답하고 이후가 전부 조용히 망가진다 (실측, #path-format).
/// 줄·열은 1-based 로 협상한다 — CodeMirror 와 같은 규약이라 변환이 없다.
pub fn initialize_arguments(adapter_id: &str) -> Value {
    serde_json::json!({
        "clientID": "ocul-pm",
        "clientName": "Ocul-PM",
        "adapterID": adapter_id,
        "locale": "en",
        "linesStartAt1": true,
        "columnsStartAt1": true,
        "pathFormat": "path",
        "supportsVariableType": true,
        "supportsVariablePaging": false,
        "supportsRunInTerminalRequest": false,
        "supportsProgressReporting": false,
    })
}

/// 프로그램 경로가 실제로 붙일 수 있는 것인지. 없는 경로로 `launch` 하면
/// 어댑터마다 다른 방식으로 실패해 메시지가 제각각이라, 먼저 우리가 말한다.
pub fn check_program(program: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(program)
        .map_err(|_| format!("실행 파일을 찾지 못했습니다: {}", program.display()))?;
    if !meta.is_file() {
        return Err(format!("실행 파일이 아닙니다: {}", program.display()));
    }
    Ok(())
}

/// 디버그 대상 경로를 프로젝트 루트 기준으로 푼다 (절대경로면 그대로).
pub fn resolve_program(root: &Path, program: &str) -> PathBuf {
    let p = Path::new(program);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_always_carries_path_format_and_one_based_lines() {
        let args = initialize_arguments("lldb");
        // 실측: pathFormat 이 없으면 lldb-dap 이 initialize 를 거절한다.
        assert_eq!(args["pathFormat"], "path");
        // 1-based 협상 — CodeMirror 의 line.number 와 같은 규약이라 변환이 없다.
        assert_eq!(args["linesStartAt1"], true);
        assert_eq!(args["columnsStartAt1"], true);
        // 지원하지 않는 역방향 요청은 애초에 광고하지 않는다.
        assert_eq!(args["supportsRunInTerminalRequest"], false);
        assert_eq!(args["adapterID"], "lldb");
    }

    #[test]
    fn resolves_program_paths_against_the_project_root() {
        let root = Path::new("/proj");
        assert_eq!(resolve_program(root, "target/debug/app"), Path::new("/proj/target/debug/app"));
        assert_eq!(resolve_program(root, "/usr/bin/ls"), Path::new("/usr/bin/ls"));
    }

    #[test]
    fn check_program_says_what_is_wrong() {
        let tmp = tempfile::TempDir::new().unwrap();
        let missing = tmp.path().join("nope");
        let err = check_program(&missing).unwrap_err();
        assert!(err.contains("찾지 못했습니다"), "{err}");

        // 디렉터리를 가리키면 그렇다고 말한다 (launch 가 알 수 없는 오류를
        // 내기 전에).
        let err = check_program(tmp.path()).unwrap_err();
        assert!(err.contains("실행 파일이 아닙니다"), "{err}");

        std::fs::write(tmp.path().join("app"), b"x").unwrap();
        assert!(check_program(&tmp.path().join("app")).is_ok());
    }
}
