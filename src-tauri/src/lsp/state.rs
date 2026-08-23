//! 서버 인스턴스 관리 — `(project_id, language, root)` 하나당 하나.
//!
//! 루트가 키에 들어가는 이유는 모노레포다: `packages/web` 과 `packages/api` 는
//! 각자의 tsconfig 를 가진 별개 워크스페이스라 서버도 따로 떠야 한다
//! (설계 SSOT §서버 루트).
//!
//! 동시성 — 코드 화면에서 파일을 빠르게 넘기면 `lsp_open` 이 연달아 온다.
//! 맵 전체를 잠근 채 spawn+initialize(수 초)를 기다리면 다른 언어까지 멎고,
//! 잠그지 않으면 같은 서버가 두 번 뜬다. 그래서 **맵 락은 짧게 잡아 키별
//! 락(Arc<Mutex<Slot>>)을 꺼내고, 느린 작업은 그 키 락 안에서** 한다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::Mutex;

use super::client::{LspClient, ServerNotice};
use super::registry::{find_root, spec_for_path, uri_to_path, ServerSpec};
use super::spec::{
    diagnostics_from_json, LspDiagnostic, LspServerInfo, LspServerState,
};

/// 진단이 갱신됐다. 창을 가리지 않고 전역으로 나가고, 코드 화면이
/// `project_id` + `path` 로 거른다 (OculpmFileChanged 와 같은 방식).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, Event)]
pub struct LspDiagnosticsPublished {
    pub project_id: u32,
    /// 프로젝트 상대 경로.
    pub path: String,
    pub diagnostics: Vec<LspDiagnostic>,
}

/// 서버 상태가 바뀌었다. 상태줄이 이걸 읽는다 — "인덱싱 중" 을 밝히지 않으면
/// 진단이 안 오는 동안 사용자는 고장으로 읽는다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, Event)]
pub struct LspServerStateChanged {
    pub project_id: u32,
    pub language_id: String,
    pub state: LspServerState,
    pub detail: Option<String>,
}

struct Slot {
    client: Option<Arc<LspClient>>,
    state: LspServerState,
    detail: Option<String>,
}

impl Slot {
    fn new() -> Self {
        Self { client: None, state: LspServerState::Stopped, detail: None }
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ServerKey {
    project_id: u32,
    language_id: &'static str,
    root: PathBuf,
}

/// 파일별 **원본** 진단 JSON. 좁은 타입으로 바꾸기 전의 것을 그대로 들고 있는
/// 이유는 코드 액션 때문이다 — `textDocument/codeAction` 의 `context.diagnostics`
/// 에 서버가 준 객체를 **그대로** 돌려줘야 서버가 자기 `data` 필드를 알아보고
/// quick fix 를 내놓는다. 우리 타입으로 갈아서 보내면 "가져오기 추가" 류가 통째로
/// 사라진다.
type RawDiagnostics = Arc<Mutex<HashMap<PathBuf, Value>>>;

#[derive(Default)]
pub struct LspState {
    servers: Mutex<HashMap<ServerKey, Arc<Mutex<Slot>>>>,
    /// 열린 문서의 버전. LSP 는 didChange 마다 단조 증가하는 버전을 요구한다.
    versions: Mutex<HashMap<PathBuf, i64>>,
    raw_diagnostics: RawDiagnostics,
    /// 마지막 `lsp_code_actions` 응답 (파일별). 적용은 인덱스로 참조한다 —
    /// 원본 액션 객체(서버별 `data` 포함)를 프런트로 왕복시키지 않기 위해서다.
    code_actions: Mutex<HashMap<PathBuf, Vec<Value>>>,
}

impl LspState {
    /// 이 파일을 담당할 서버를 확보한다 (없으면 띄운다).
    ///
    /// `Ok(None)` = 이 파일은 LSP 대상이 아니다 (css·md 등). 오류가 아니다.
    pub async fn ensure_for_file(
        &self,
        app: &AppHandle,
        db: &crate::db::Db,
        project_id: u32,
        project_root: &Path,
        file: &Path,
    ) -> Result<Option<Arc<LspClient>>, String> {
        let Some(spec) = spec_for_path(file) else { return Ok(None) };
        // 사용자가 이 언어를 껐다 (#lsp-settings-screen). 이미 떠 있는 서버까지
        // 여기서 죽이지는 않는다 — 설정 화면이 "서버 다시 시작" 으로 정리한다.
        if is_language_disabled(db, spec.language_id).await {
            return Ok(None);
        }
        let Some(root) = find_root(spec, file, project_root) else {
            // 루트를 모르면 안 띄운다 — 엉뚱한 루트로 뜬 서버는 조용히 빈
            // 진단을 내며 고장처럼 보인다. 왜 안 붙었는지 말해 준다.
            emit_state(
                app,
                project_id,
                spec.language_id,
                LspServerState::Failed,
                Some(format!(
                    "{} 을(를) 찾지 못해 언어 서버를 띄우지 않았습니다",
                    spec.root_markers.join(" / ")
                )),
            );
            return Ok(None);
        };

        let key = ServerKey { project_id, language_id: spec.language_id, root: root.clone() };
        // 맵 락은 여기까지만 — 슬롯 Arc 만 꺼내고 바로 놓는다.
        let slot = {
            let mut map = self.servers.lock().await;
            map.entry(key).or_insert_with(|| Arc::new(Mutex::new(Slot::new()))).clone()
        };

        let mut guard = slot.lock().await;
        if let Some(client) = &guard.client {
            return Ok(Some(client.clone()));
        }
        // 직전에 실패했으면 매 키 입력마다 재시도하지 않는다 (미설치 서버에
        // 대해 초당 여러 번 spawn 을 시도하게 된다).
        if matches!(guard.state, LspServerState::Missing | LspServerState::Failed) {
            return Ok(None);
        }

        guard.state = LspServerState::Starting;
        emit_state(app, project_id, spec.language_id, LspServerState::Starting, None);

        match start_server(
            app,
            project_id,
            spec,
            command_override(db, spec.language_id).await.as_deref(),
            &root,
            project_root,
            self.raw_diagnostics.clone(),
        )
        .await
        {
            Ok(client) => {
                guard.client = Some(client.clone());
                guard.state = LspServerState::Ready;
                guard.detail = None;
                emit_state(app, project_id, spec.language_id, LspServerState::Ready, None);
                Ok(Some(client))
            }
            Err((state, detail)) => {
                guard.state = state;
                guard.detail = Some(detail.clone());
                emit_state(app, project_id, spec.language_id, state, Some(detail));
                Ok(None)
            }
        }
    }

    /// 다음 문서 버전 (LSP 는 단조 증가를 요구한다).
    pub async fn next_version(&self, file: &Path) -> i64 {
        let mut map = self.versions.lock().await;
        let v = map.entry(file.to_path_buf()).or_insert(0);
        *v += 1;
        *v
    }

    pub async fn forget_document(&self, file: &Path) {
        self.versions.lock().await.remove(file);
        self.raw_diagnostics.lock().await.remove(file);
        self.code_actions.lock().await.remove(file);
    }

    /// 이 범위와 겹치는 **원본** 진단 (코드 액션 context 용).
    ///
    /// 서버가 준 객체를 그대로 돌려줘야 자기 `data` 필드를 알아본다 — 우리
    /// 타입으로 갈아 보내면 "가져오기 추가" 류 quick fix 가 통째로 사라진다.
    pub async fn diagnostics_overlapping(
        &self,
        file: &Path,
        start_line: u32,
        end_line: u32,
    ) -> Value {
        let map = self.raw_diagnostics.lock().await;
        let Some(all) = map.get(file).and_then(Value::as_array) else {
            return Value::Array(Vec::new());
        };
        let hit: Vec<Value> = all
            .iter()
            .filter(|d| {
                let Some(range) = d.get("range") else { return false };
                let s = range
                    .get("start")
                    .and_then(|p| p.get("line"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let e = range
                    .get("end")
                    .and_then(|p| p.get("line"))
                    .and_then(Value::as_u64)
                    .unwrap_or(s as u64) as u32;
                // 줄 단위로만 겹침을 본다 — 열까지 따지면 커서가 진단 범위
                // 한 칸 밖일 때 fix 가 사라진다.
                s <= end_line && e >= start_line
            })
            .cloned()
            .collect();
        Value::Array(hit)
    }

    pub async fn set_code_actions(&self, file: &Path, actions: Vec<Value>) {
        self.code_actions.lock().await.insert(file.to_path_buf(), actions);
    }

    /// 마지막 목록에서 `index` 번째 액션. 목록이 없거나 인덱스가 벗어나면 `None`
    /// — 파일을 다시 열었거나 목록이 갱신된 뒤 오래된 인덱스로 부른 경우다.
    pub async fn code_action_at(&self, file: &Path, index: usize) -> Option<Value> {
        self.code_actions.lock().await.get(file)?.get(index).cloned()
    }

    /// 이 프로젝트의 서버 상태 일람 (설치 여부 포함).
    pub async fn status(&self, project_id: u32, project_root: &Path) -> Vec<LspServerInfo> {
        let map = self.servers.lock().await;
        let mut out = Vec::new();
        for spec in super::registry::SERVERS {
            // 이미 뜬 인스턴스가 있으면 그 상태를 그대로.
            let running: Vec<_> = map
                .iter()
                .filter(|(k, _)| k.project_id == project_id && k.language_id == spec.language_id)
                .collect();
            if running.is_empty() {
                let installed = crate::acp::env::resolve_binary(spec.command).await.is_some();
                out.push(LspServerInfo {
                    language_id: spec.language_id.to_string(),
                    command: spec.command.to_string(),
                    state: if installed { LspServerState::Stopped } else { LspServerState::Missing },
                    root: None,
                    detail: (!installed).then(|| format!("{} 가 PATH 에 없습니다", spec.command)),
                });
                continue;
            }
            for (key, slot) in running {
                let s = slot.lock().await;
                out.push(LspServerInfo {
                    language_id: spec.language_id.to_string(),
                    command: spec.command.to_string(),
                    state: s.state,
                    root: key
                        .root
                        .strip_prefix(project_root)
                        .ok()
                        .map(|p| p.to_string_lossy().to_string()),
                    detail: s.detail.clone(),
                });
            }
        }
        out
    }

    /// 지금 **떠 있는** 서버들. 워크스페이스 심볼처럼 파일에 매이지 않은 요청이
    /// 쓴다 — 새로 띄우지 않는 것이 요점이다. 팔레트에 글자를 칠 때마다
    /// rust-analyzer 가 기동하면 안 된다.
    pub async fn running_clients(&self, project_id: u32) -> Vec<Arc<LspClient>> {
        let slots: Vec<_> = {
            let map = self.servers.lock().await;
            map.iter()
                .filter(|(k, _)| k.project_id == project_id)
                .map(|(_, slot)| slot.clone())
                .collect()
        };
        let mut out = Vec::new();
        for slot in slots {
            if let Some(client) = slot.lock().await.client.clone() {
                out.push(client);
            }
        }
        out
    }

    /// 프로젝트의 서버를 전부 정리한다 (프로젝트 닫기 / 앱 종료).
    pub async fn stop_project(&self, project_id: u32) {
        let slots: Vec<_> = {
            let mut map = self.servers.lock().await;
            let keys: Vec<_> = map
                .keys()
                .filter(|k| k.project_id == project_id)
                .cloned()
                .collect();
            keys.iter().filter_map(|k| map.remove(k)).collect()
        };
        for slot in slots {
            let mut guard = slot.lock().await;
            if let Some(client) = guard.client.take() {
                client.stop().await;
            }
            guard.state = LspServerState::Stopped;
        }
    }
}

/// 언어별 끄기 설정 키 (`code_lsp_off_rust` 등).
///
/// 타입 있는 `Settings` 객체에 넣지 않는 이유: 지원 언어가 늘 때마다 필드를
/// 늘려야 하고, 그건 레지스트리(`SERVERS`)와 두 벌의 진실이 된다. 언어 id 로
/// 파생되는 키가 레지스트리 하나만 보게 한다.
pub fn disabled_key(language_id: &str) -> String {
    format!("code_lsp_off_{language_id}")
}

/// 언어별 실행 명령 오버라이드 키 (`code_lsp_cmd_rust` 등).
pub fn command_key(language_id: &str) -> String {
    format!("code_lsp_cmd_{language_id}")
}

async fn is_language_disabled(db: &crate::db::Db, language_id: &str) -> bool {
    matches!(
        db.settings_get(disabled_key(language_id)).await,
        Ok(Some(v)) if v == "true"
    )
}

async fn command_override(db: &crate::db::Db, language_id: &str) -> Option<String> {
    let raw = db.settings_get(command_key(language_id)).await.ok()??;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// 바이너리를 찾고 프로세스를 띄운다. 실패는 (상태, 사람이 읽는 이유)로 돌려
/// 호출자가 그대로 사용자에게 전달할 수 있게 한다.
#[allow(clippy::too_many_arguments)]
async fn start_server(
    app: &AppHandle,
    project_id: u32,
    spec: &'static ServerSpec,
    // `override_command` — 설정 화면의 경로 오버라이드. PATH 에 없거나 여러
    // 버전을 쓰는 사용자용 (인자에는 doc comment 를 달 수 없다).
    override_command: Option<&str>,
    root: &Path,
    project_root: &Path,
    raw_diagnostics: RawDiagnostics,
) -> Result<Arc<LspClient>, (LspServerState, String)> {
    // 조달은 ACP 와 같은 기계 — 로그인 셸 PATH (패키징된 .app 은 Finder 의
    // 빈약한 PATH 로 뜬다는 그 함정). 오버라이드도 같은 경로로 푼다: 절대경로면
    // 그대로 쓰이고, 이름이면 PATH 에서 찾는다.
    let wanted = override_command.unwrap_or(spec.command);
    let Some((binary, _source)) = crate::acp::env::resolve_binary(wanted).await else {
        return Err((
            LspServerState::Missing,
            format!("{wanted} 를 PATH 에서 찾지 못했습니다. 설치한 뒤 다시 열면 붙습니다."),
        ));
    };
    let path_env = crate::acp::env::effective_path().await;

    let sink_app = app.clone();
    let sink_root = project_root.to_path_buf();
    let language_id = spec.language_id;
    let on_notice = Arc::new(move |notice: ServerNotice| {
        handle_notice(
            &sink_app,
            project_id,
            &sink_root,
            language_id,
            &raw_diagnostics,
            notice,
        );
    });

    LspClient::start(spec, &binary, root.to_path_buf(), path_env, on_notice)
        .await
        .map_err(|e| (LspServerState::Failed, e))
}

fn handle_notice(
    app: &AppHandle,
    project_id: u32,
    project_root: &Path,
    language_id: &'static str,
    raw_diagnostics: &RawDiagnostics,
    notice: ServerNotice,
) {
    match notice {
        ServerNotice::Diagnostics { uri, diagnostics } => {
            let Some(path) = uri_to_path(&uri) else { return };
            // 원본을 먼저 보관한다 (코드 액션의 context 로 쓴다). 여기는 동기
            // 콜백이라 blocking_lock 을 쓸 수 없어 tokio 태스크로 넘긴다.
            {
                let cache = raw_diagnostics.clone();
                let key = path.clone();
                let raw = diagnostics.clone();
                tauri::async_runtime::spawn(async move {
                    cache.lock().await.insert(key, raw);
                });
            }
            // 프로젝트 밖 파일(의존성 소스 등)의 진단은 버린다 — 열 수 없는
            // 파일에 밑줄을 그을 수 없다.
            let Ok(rel) = path.strip_prefix(project_root) else { return };
            let _ = LspDiagnosticsPublished {
                project_id,
                path: rel.to_string_lossy().to_string(),
                diagnostics: diagnostics_from_json(&diagnostics),
            }
            .emit(app);
        }
        ServerNotice::Progress { title, done } => {
            emit_state(
                app,
                project_id,
                language_id,
                if done { LspServerState::Ready } else { LspServerState::Indexing },
                (!done && !title.is_empty()).then_some(title),
            );
        }
        ServerNotice::Exited { code } => {
            emit_state(
                app,
                project_id,
                language_id,
                LspServerState::Failed,
                Some(match code {
                    Some(c) => format!("언어 서버가 종료됐습니다 (코드 {c})"),
                    None => "언어 서버가 종료됐습니다".to_string(),
                }),
            );
        }
    }
}

fn emit_state(
    app: &AppHandle,
    project_id: u32,
    language_id: &str,
    state: LspServerState,
    detail: Option<String>,
) {
    let _ = LspServerStateChanged {
        project_id,
        language_id: language_id.to_string(),
        state,
        detail,
    }
    .emit(app);
}

/// 서버 응답의 URI 를 프로젝트 상대 경로로. 정의로 이동(PR-LSP1)이 쓴다.
pub fn relative_path_of(uri: &str, project_root: &Path) -> Option<String> {
    let path = uri_to_path(uri)?;
    path.strip_prefix(project_root)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// LSP 위치 파라미터. **변환하지 않는다** — 프런트가 준 UTF-16 숫자를 그대로.
pub fn position_params(uri: String, line: u32, character: u32) -> Value {
    serde_json::json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": character },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_params_pass_utf16_numbers_through_untouched() {
        // 한글 주석이 있는 줄에서 프런트가 준 character 를 Rust 가 다시 세면
        // 어긋난다 — 통과만 시키는지 잠근다.
        let p = position_params("file:///a.rs".into(), 41, 17);
        assert_eq!(p["position"]["line"], 41);
        assert_eq!(p["position"]["character"], 17);
        assert_eq!(p["textDocument"]["uri"], "file:///a.rs");
    }

    #[test]
    fn relative_path_strips_the_project_root() {
        let root = Path::new("/w/ai-pm");
        assert_eq!(
            relative_path_of("file:///w/ai-pm/src-tauri/src/lib.rs", root).as_deref(),
            Some("src-tauri/src/lib.rs")
        );
        // 프로젝트 밖(의존성 소스)은 None — 열 수 없는 파일이다.
        assert!(relative_path_of("file:///Users/x/.cargo/registry/foo.rs", root).is_none());
        assert!(relative_path_of("https://example.com/a.rs", root).is_none());
    }

    #[tokio::test]
    async fn document_versions_increase_monotonically_per_file() {
        let state = LspState::default();
        let a = Path::new("/w/a.rs");
        let b = Path::new("/w/b.rs");
        assert_eq!(state.next_version(a).await, 1);
        assert_eq!(state.next_version(a).await, 2);
        // 파일마다 독립 — 공유하면 서버가 오래된 버전으로 보고 didChange 를 버린다.
        assert_eq!(state.next_version(b).await, 1);
        assert_eq!(state.next_version(a).await, 3);

        state.forget_document(a).await;
        assert_eq!(state.next_version(a).await, 1, "닫은 문서는 버전이 초기화된다");
    }
}
