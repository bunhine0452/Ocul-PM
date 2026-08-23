//! 언어 서버 하나와의 연결 — 프로세스 수명 · JSON-RPC 상관 · 알림 라우팅.
//!
//! 구조는 ACP 어댑터와 같은 모양이다: stdin/stdout 파이프를 잡고, 읽기 루프를
//! tokio 태스크로 돌리며, 요청은 id→oneshot 으로 상관시킨다. 다른 점은
//! 프레이밍(`crate::framing` — DAP 와 공용)과, 서버가 먼저 말을 건다는 것(진단은 요청에 대한
//! 응답이 아니라 **알림**으로 온다) 뿐이다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

use crate::framing::{encode_frame, parse_frame, Frame};
use super::registry::{path_to_uri, ServerSpec};

/// 요청 하나가 이 시간을 넘기면 포기한다. rust-analyzer 는 인덱싱 중에 완성
/// 요청을 붙들고 있을 수 있는데, 무한정 기다리면 그 편집 세션이 통째로 멎는다.
/// 포기해도 서버는 살아 있고 다음 요청은 다시 시도된다.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// `initialize` 는 더 후하게 — 첫 기동에 크레이트 메타데이터를 읽는다.
const INIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// 서버가 보내온 알림. 요청-응답이 아니라 서버가 먼저 거는 말이다.
#[derive(Debug, Clone)]
pub enum ServerNotice {
    /// `textDocument/publishDiagnostics`
    Diagnostics { uri: String, diagnostics: Value },
    /// `$/progress` — rust-analyzer 의 인덱싱 진행. 이게 없으면 "진단이 아직
    /// 안 온 것" 과 "서버가 죽은 것" 을 사용자가 구별할 수 없다.
    Progress { title: String, done: bool },
    /// 프로세스가 끝났다 (크래시 포함).
    Exited { code: Option<i32> },
}

type NoticeSink = Arc<dyn Fn(ServerNotice) + Send + Sync>;

pub struct LspClient {
    spec: &'static ServerSpec,
    root: PathBuf,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>,
    /// 서버가 광고한 능력. 지원하지 않는 기능을 부르지 않기 위해 들고 있는다.
    capabilities: Value,
}

impl LspClient {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn language_id(&self) -> &'static str {
        self.spec.language_id
    }

    /// 서버가 이 기능을 광고했는가 (`completionProvider` 등).
    pub fn supports(&self, capability: &str) -> bool {
        !matches!(
            self.capabilities.get(capability),
            None | Some(Value::Null) | Some(Value::Bool(false))
        )
    }

    /// 서버를 띄우고 `initialize` 핸드셰이크까지 마친다.
    ///
    /// `binary` 는 호출자가 `acp::env::resolve_binary` 로 찾아 넘긴다 — 여기서
    /// 다시 찾지 않는 이유는, 못 찾았을 때의 안내(설치 방법)가 이 층의 일이
    /// 아니기 때문이다.
    pub async fn start(
        spec: &'static ServerSpec,
        binary: &Path,
        root: PathBuf,
        path_env: String,
        on_notice: NoticeSink,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = tokio::process::Command::new(binary);
        cmd.args(spec.args)
            .current_dir(&root)
            .env("PATH", path_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // stderr 를 버리지 않고 파이프로 잡되 읽어서 로그로 흘린다 —
            // 파이프를 열고 안 읽으면 서버가 stderr 를 채우다 블록된다.
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            // 앱이 죽어도 언어 서버가 유령으로 남지 않게 새 프로세스 그룹에 두지
            // **않는다** — 부모와 함께 정리되는 편이 안전하다.
            cmd.kill_on_drop(true);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("{} 를 띄우지 못했습니다: {e}", spec.command))?;
        let stdin = child.stdin.take().ok_or("stdin 파이프 없음")?;
        let stdout = child.stdout.take().ok_or("stdout 파이프 없음")?;
        // 마지막 stderr 줄을 붙들어 둔다. 서버가 기동 직후 죽으면 **그 줄이
        // 유일한 진단**이다 — 도그푸딩에서 `~/.cargo/bin/rust-analyzer` 가
        // 컴포넌트 미설치 rustup 심이라 즉시 종료했는데, 그때 사용자에게
        // 필요한 문장("Unknown binary 'rust-analyzer' in official toolchain")은
        // 오직 stderr 에만 있었다. 로그로만 흘리면 사용자는 "종료됐습니다" 라는
        // 쓸모없는 문장만 본다.
        let last_stderr = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            spawn_stderr_drain(spec.language_id, stderr, last_stderr.clone());
        }

        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let client = Arc::new(Self {
            spec,
            root: root.clone(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next_id: AtomicI64::new(1),
            pending: pending.clone(),
            capabilities: Value::Null,
        });

        spawn_read_loop(stdout, pending, on_notice);

        // initialize → initialized. 여기까지 와야 문서를 열 수 있다.
        let init = match client
            .request_with_timeout("initialize", initialize_params(&root), INIT_TIMEOUT)
            .await
        {
            Ok(v) => v,
            Err(e) => return Err(with_stderr_hint(&e, &last_stderr).await),
        };
        let capabilities = init.get("capabilities").cloned().unwrap_or(Value::Null);
        client.notify("initialized", json!({})).await?;

        // `capabilities` 는 생성 후에 채워야 해서 한 번 다시 만든다 — Arc 안의
        // 필드를 나중에 바꾸느니(Mutex 한 겹 추가) 이쪽이 단순하다.
        let LspClient {
            spec,
            root,
            child,
            stdin,
            next_id,
            pending,
            ..
        } = Arc::try_unwrap(client).map_err(|_| "initialize 중 클라이언트가 공유됐다")?;
        Ok(Arc::new(Self {
            spec,
            root,
            child,
            stdin,
            next_id,
            pending,
            capabilities,
        }))
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, REQUEST_TIMEOUT).await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: std::time::Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.send(&msg).await {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            // 읽기 루프가 끝났다 = 서버가 죽었다.
            Ok(Err(_)) => Err(format!("{} 가 응답 전에 종료됐습니다", self.spec.command)),
            Err(_) => {
                // 시간 초과 — 대기 항목을 걷어내야 맵이 새지 않는다.
                self.pending.lock().await.remove(&id);
                Err(format!("{method} 요청이 시간을 넘겼습니다"))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    async fn send(&self, msg: &Value) -> Result<(), String> {
        let bytes = encode_frame(&msg.to_string());
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|e| format!("언어 서버로 쓰지 못했습니다: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("언어 서버 플러시 실패: {e}"))
    }

    // ── 문서 동기 ───────────────────────────────────────────────────────────
    // full sync 로 간다 (설계 SSOT §문서 동기). 증분은 CM6 ChangeSet 을 LSP
    // range 로 번역해야 하고, 그 번역이 틀리면 서버 문서가 조용히 어긋나
    // 진단이 엉뚱한 줄에 붙는다.

    pub async fn did_open(&self, path: &Path, text: &str, version: i64) -> Result<(), String> {
        self.notify(
            "textDocument/didOpen",
            json!({ "textDocument": {
                "uri": path_to_uri(path),
                "languageId": self.spec.language_id,
                "version": version,
                "text": text,
            }}),
        )
        .await
    }

    pub async fn did_change(&self, path: &Path, text: &str, version: i64) -> Result<(), String> {
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": path_to_uri(path), "version": version },
                "contentChanges": [{ "text": text }],
            }),
        )
        .await
    }

    pub async fn did_close(&self, path: &Path) -> Result<(), String> {
        self.notify(
            "textDocument/didClose",
            json!({ "textDocument": { "uri": path_to_uri(path) } }),
        )
        .await
    }

    /// `shutdown` → `exit` 순서를 지킨다. 바로 kill 하면 서버가 캐시를 저장하지
    /// 못해 다음 기동의 인덱싱이 처음부터 다시 돈다.
    pub async fn stop(&self) {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            self.request("shutdown", json!(null)),
        )
        .await;
        let _ = self.notify("exit", json!(null)).await;
        let mut child = self.child.lock().await;
        // 예의를 갖춘 종료를 기다리되, 안 죽으면 죽인다.
        match tokio::time::timeout(std::time::Duration::from_secs(3), child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = child.kill().await;
            }
        }
    }
}

/// stdout 읽기 루프 — 프레임을 떼어 응답은 대기자에게, 알림은 싱크로.
fn spawn_read_loop(
    mut stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>,
    on_notice: NoticeSink,
) {
    tauri::async_runtime::spawn(async move {
        let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
        let mut chunk = [0u8; 8192];
        loop {
            let n = match stdout.read(&mut chunk).await {
                Ok(0) | Err(_) => break, // EOF 또는 파이프 오류 = 서버 종료
                Ok(n) => n,
            };
            buf.extend_from_slice(&chunk[..n]);

            // 한 번의 read 에 여러 메시지가 들어 있을 수 있다.
            loop {
                match parse_frame(&buf) {
                    Frame::Message { body, consumed } => {
                        buf.drain(..consumed);
                        if let Ok(msg) = serde_json::from_slice::<Value>(&body) {
                            route_message(msg, &pending, &on_notice).await;
                        }
                    }
                    Frame::Incomplete => break,
                    Frame::Invalid(why) => {
                        tracing::warn!(target: "lsp", why, "프레이밍 위반 — 연결을 끊는다");
                        buf.clear();
                        break;
                    }
                }
            }
        }
        // 종료 — 대기 중인 요청을 전부 깨운다. 안 그러면 호출자가 타임아웃까지
        // 붙들려 있는다.
        let mut map = pending.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(Err("언어 서버가 종료됐습니다".to_string()));
        }
        on_notice(ServerNotice::Exited { code: None });
    });
}

async fn route_message(
    msg: Value,
    pending: &Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>,
    on_notice: &NoticeSink,
) {
    // 응답: id 가 있고 method 가 없다.
    if let Some(id) = msg.get("id").and_then(Value::as_i64) {
        if msg.get("method").is_none() {
            if let Some(tx) = pending.lock().await.remove(&id) {
                let result = match msg.get("error") {
                    Some(e) => Err(error_message(e)),
                    None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = tx.send(result);
            }
            return;
        }
        // id + method = 서버→클라이언트 **요청**. 우리는 어떤 것도 광고하지
        // 않았으므로 지금은 무시한다 (응답을 안 주면 서버가 기다릴 수 있으나,
        // 광고 안 한 기능을 서버가 요청하는 것은 프로토콜 위반이다).
        return;
    }

    let Some(method) = msg.get("method").and_then(Value::as_str) else { return };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "textDocument/publishDiagnostics" => {
            if let Some(uri) = params.get("uri").and_then(Value::as_str) {
                on_notice(ServerNotice::Diagnostics {
                    uri: uri.to_string(),
                    diagnostics: params.get("diagnostics").cloned().unwrap_or(json!([])),
                });
            }
        }
        "$/progress" => {
            if let Some(n) = progress_notice(&params) {
                on_notice(n);
            }
        }
        // window/logMessage · window/showMessage 등은 로그로만.
        _ => tracing::trace!(target: "lsp", method, "서버 알림 (무시)"),
    }
}

/// `$/progress` 의 value 에서 제목과 종료 여부를 꺼낸다. 순수 함수 — 테스트 대상.
pub fn progress_notice(params: &Value) -> Option<ServerNotice> {
    let value = params.get("value")?;
    let kind = value.get("kind").and_then(Value::as_str)?;
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    Some(ServerNotice::Progress {
        title,
        done: kind == "end",
    })
}

/// JSON-RPC 오류 객체를 사람이 읽는 한 줄로.
fn error_message(err: &Value) -> String {
    let msg = err
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("알 수 없는 오류");
    match err.get("code").and_then(Value::as_i64) {
        Some(code) => format!("{msg} (code {code})"),
        None => msg.to_string(),
    }
}

/// 기동 실패 메시지에 서버가 stderr 로 한 말을 덧붙인다.
///
/// 파이프가 아직 흐르는 중일 수 있어 아주 짧게 기다린 뒤 읽는다 — 죽는 순간의
/// 마지막 줄이 대개 진짜 이유다.
async fn with_stderr_hint(err: &str, last_stderr: &Arc<Mutex<String>>) -> String {
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let hint = last_stderr.lock().await.clone();
    if hint.trim().is_empty() {
        err.to_string()
    } else {
        format!("{err} — {}", hint.trim())
    }
}

/// stderr 를 읽어 로그로 흘리고, 마지막 줄을 `last` 에 남긴다.
///
/// **반드시 읽어야 한다** — 파이프를 열어 두고 안 읽으면 서버가 stderr 버퍼를
/// 채우다 통째로 블록된다 (조용히 멎는 고전적 원인).
fn spawn_stderr_drain(
    language_id: &'static str,
    stderr: tokio::process::ChildStderr,
    last: Arc<Mutex<String>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut reader = stderr;
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&chunk[..n]);
                    for line in text.lines().filter(|l| !l.trim().is_empty()) {
                        tracing::debug!(target: "lsp", server = language_id, "{line}");
                        *last.lock().await = line.to_string();
                    }
                }
            }
        }
    });
}

fn initialize_params(root: &Path) -> Value {
    json!({
        // 프로세스 id 를 주면 서버가 우리가 죽었을 때 스스로 종료한다 (유령 방지).
        "processId": std::process::id(),
        "rootUri": path_to_uri(root),
        "workspaceFolders": [{ "uri": path_to_uri(root), "name": root.file_name().and_then(|s| s.to_str()).unwrap_or("workspace") }],
        "capabilities": {
            "textDocument": {
                // 위치 인코딩을 명시하지 않는다 = 기본값 UTF-16. 프런트(JS)가
                // 이미 UTF-16 이라 변환 지점이 없는 것이 이 설계의 요점이다.
                "synchronization": { "dynamicRegistration": false },
                "publishDiagnostics": { "relatedInformation": false },
                "completion": {
                    "completionItem": {
                        "snippetSupport": false,
                        "documentationFormat": ["plaintext", "markdown"],
                    },
                    "contextSupport": true,
                },
                "hover": { "contentFormat": ["markdown", "plaintext"] },
                "definition": { "linkSupport": false },
            },
            "window": { "workDoneProgress": true },
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_end_is_distinguished_from_progress_start() {
        let begin = json!({ "value": { "kind": "begin", "title": "Indexing" } });
        let Some(ServerNotice::Progress { title, done }) = progress_notice(&begin) else {
            panic!("begin 을 못 읽었다")
        };
        assert_eq!(title, "Indexing");
        assert!(!done);

        let end = json!({ "value": { "kind": "end" } });
        let Some(ServerNotice::Progress { done, .. }) = progress_notice(&end) else {
            panic!("end 를 못 읽었다")
        };
        assert!(done, "end 를 진행 중으로 읽으면 상태줄이 영원히 '인덱싱 중'이 된다");
    }

    #[test]
    fn progress_falls_back_to_message_when_title_is_absent() {
        // rust-analyzer 의 report 단계는 title 없이 message 만 준다.
        let report = json!({ "value": { "kind": "report", "message": "247/1000" } });
        let Some(ServerNotice::Progress { title, done }) = progress_notice(&report) else {
            panic!("report 를 못 읽었다")
        };
        assert_eq!(title, "247/1000");
        assert!(!done);
    }

    #[test]
    fn progress_ignores_shapes_it_cannot_read() {
        assert!(progress_notice(&json!({})).is_none());
        assert!(progress_notice(&json!({ "value": {} })).is_none());
    }

    #[test]
    fn error_objects_become_one_readable_line() {
        assert_eq!(
            error_message(&json!({ "code": -32601, "message": "method not found" })),
            "method not found (code -32601)"
        );
        assert_eq!(error_message(&json!({ "message": "boom" })), "boom");
        assert_eq!(error_message(&json!({})), "알 수 없는 오류");
    }

    #[test]
    fn initialize_params_point_at_the_server_root_not_the_cwd() {
        let params = initialize_params(Path::new("/w/ai-pm/src-tauri"));
        assert_eq!(params["rootUri"], "file:///w/ai-pm/src-tauri");
        assert_eq!(params["workspaceFolders"][0]["name"], "src-tauri");
        // processId 를 줘야 우리가 죽었을 때 서버가 스스로 끝난다.
        assert!(params["processId"].is_number());
    }
}
