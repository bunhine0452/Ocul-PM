//! 앱이 띄운 ACP 대화의 **기록 신원**과 **기록 도구 부착 결과** (플랜
//! `v3-record-integrity` · {#acp-sid-map} · {#mcp-missing-visible}).
//!
//! 두 가지 침묵을 없앤다.
//!
//! **① 누가 썼는지가 안 남는다.** 앱 안에서 도는 Claude Code·Codex 대화가
//! `journal_write` 로 남긴 일지는 `agent.session` 이 늘 비어 있었다. MCP 서버에
//! 넘어가는 환경변수가 [`AGENT_ID_ENV`](crate::oculpm::mcp::tools::AGENT_ID_ENV)
//! 하나뿐이었기 때문이다 — 그 순간 앱은 ACP 대화의 신원을 손에 쥐고 있으면서
//! 그냥 버렸다.
//!
//! **② 기록 도구 없이 대화가 열린다.** 사이드카 바이너리를 못 찾으면 예전에는
//! 빈 `Vec` 을 돌려주고 아무 일 없다는 듯 세션을 열었다. 에이전트에게는 일지
//! 도구가 아예 없고, 사용자는 그걸 모른다. 여기서는 **찾아본 자리 목록**을
//! 함께 들고 나가 화면이 읽을 수 있게 한다.
//!
//! ## 이름 공간이 둘이다
//!
//! ACP 의 대화 id 는 어댑터가 발급하는 UUID 고, ocul-pm 의 세션 id 는
//! [`SessionId`](crate::oculpm::session_id::SessionId) 방언이다. 둘은 서로
//! 다른 이름 공간이라 어느 한쪽을 다른 쪽인 척 쓸 수 없다. 그래서 **세 번째
//! 값**을 우리가 발급한다 — 이 대화가 남기는 기록의 신원(`acp-<workday>-<hex>`)
//! 이고, 원장이 그것을 ACP UUID 와 짝지어 둔다.
//!
//! 왜 ACP UUID 를 그대로 못 쓰는가: MCP 서버의 환경은 `session/new` **요청에**
//! 실려 나가는데, UUID 는 그 **응답에** 실려 온다. 우리가 아는 순간에는 이미
//! 서버가 그 환경으로 떠 있다. 그래서 먼저 발급하고 나중에 짝짓는다.
//!
//! ## 수명
//!
//! | 사건 | 매핑 |
//! |---|---|
//! | `session/new` 성공 | 발급한 토큰을 UUID 와 짝지어 **원장에 적는다** |
//! | `session/new` 실패 | 아무것도 안 적는다 (고아 항목이 안 생긴다) |
//! | `session/load` (재개) | 원장에 있으면 **그 토큰을 다시 쓴다** — 같은 대화의 일지가 같은 신원을 갖는다 |
//! | 원장에 없는 재개 | 새로 발급해 적는다 (다른 기계·원장 정리 뒤) |
//! | 앱 재시작 | 원장이 파일이라 **살아남는다** — 재개해도 신원이 안 바뀐다 |
//! | `session/delete` | 그 항목을 **지운다** |
//! | 어댑터 종료·앱 종료 | 그대로 둔다 — 대화는 에이전트 쪽에 남아 언제든 재개된다 |
//! | 오래된 항목 | 쓰기 때마다 [`prune`] 이 나이·개수로 걷는다 (무한히 안 자란다) |
//!
//! 원장은 `.oculpm/` 이 아니라 **앱 데이터**에 산다. 기록이 아니라 기계 종속
//! 라우팅 표이기 때문이다 — 커밋되는 트리에 이 기계의 ACP UUID 를 흘리지 않고,
//! `.oculpm` 쓰기 경로의 락과도 부딪히지 않는다. 대신 프로세스가 둘 이상일 수
//! 있으므로(설치본 + dev 빌드) [`FileGuard`] 로 지킨다.

use std::path::{Path, PathBuf};

use agent_client_protocol::schema::v1::{EnvVariable, McpServer, McpServerStdio};
use chrono::{DateTime, Duration, Local, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::file_guard::{FileGuard, GuardPolicy};

use super::AcpProvider;

/// 셔틀(`plugin/oculpm/bin/oculpm-mcp`)이 1순위로 보는 수동 지정 변수. 화면의
/// 안내 문구가 이 이름을 그대로 말하므로 **같은 어휘**를 쓴다.
pub const MCP_BIN_ENV: &str = "OCULPM_MCP_BIN";

/// 앱 데이터 아래 원장 자리.
pub const LEDGER_SUBDIR: &str = "acp";
pub const LEDGER_FILE: &str = "session-map.json";
const LEDGER_LOCK: &str = ".session-map.lock";

/// 원장이 들고 있을 최대 항목 수 · 최대 나이.
const MAX_LINKS: usize = 256;
const MAX_AGE_DAYS: i64 = 30;

/// 원장 파일 잠금 대기 — 임계구간이 읽기 한 번 + 쓰기 한 번이라 짧다.
const LEDGER_WAIT_MS: u64 = 250;

// ─── 바이너리 탐색 ───────────────────────────────────────────────────────────

/// `oculpm-mcp` 를 어디서 찾았는가 — **못 찾았을 때 어디를 봤는지까지** 남긴다.
///
/// 실패를 `None` 하나로 뭉치지 않는 이유는 [`crate::acp::AcpDiagnostics`] 와
/// 같다: 사용자가 할 수 있는 조치가 경로마다 다르다(앱 설치 / `OCULPM_MCP_BIN`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpBinaryProbe {
    /// 찾았으면 그 절대경로.
    pub path: Option<PathBuf>,
    /// 순서대로 본 자리 전부 (찾았으면 마지막이 [`Self::path`]).
    pub searched: Vec<PathBuf>,
}

impl McpBinaryProbe {
    pub fn searched_display(&self) -> Vec<String> {
        self.searched
            .iter()
            .map(|p| p.display().to_string())
            .collect()
    }
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "oculpm-mcp.exe"
    } else {
        "oculpm-mcp"
    }
}

/// 볼 자리를 순서대로 — 셔틀 스크립트와 **같은 순서, 같은 어휘**다.
///
/// 셔틀의 마지막 두 후보(리포 `target/debug|release`)는 여기서 `exe_dir` 하나로
/// 덮인다. 앱이 dev 로 돌 때 그 자리가 곧 실행 파일의 형제이기 때문이다.
pub fn candidate_paths(
    env_override: Option<&Path>,
    exe_dir: Option<&Path>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let name = binary_name();
    let mut out = Vec::new();
    if let Some(explicit) = env_override {
        out.push(explicit.to_path_buf());
    }
    if let Some(dir) = exe_dir {
        out.push(dir.join(name));
    }
    out.push(PathBuf::from("/Applications/ocul-pm.app/Contents/MacOS").join(name));
    if let Some(home) = home {
        out.push(
            home.join("Applications/ocul-pm.app/Contents/MacOS")
                .join(name),
        );
        out.push(home.join(".local/bin").join(name));
    }
    out.dedup();
    out
}

/// 주어진 후보를 순서대로 본다 — 순수 함수라 테스트가 파일만 놓고 물 수 있다.
pub fn probe_candidates(candidates: Vec<PathBuf>) -> McpBinaryProbe {
    let mut searched = Vec::new();
    for candidate in candidates {
        let hit = candidate.is_file();
        searched.push(candidate.clone());
        if hit {
            return McpBinaryProbe {
                path: Some(candidate),
                searched,
            };
        }
    }
    McpBinaryProbe {
        path: None,
        searched,
    }
}

/// 이 기계에서 실제로 찾아본다.
pub fn probe_mcp_binary() -> McpBinaryProbe {
    let env_override = std::env::var_os(MCP_BIN_ENV)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty());
    let exe = std::env::current_exe().ok();
    let exe_dir = exe.as_deref().and_then(Path::parent);
    let home = directories::BaseDirs::new().map(|b| b.home_dir().to_path_buf());
    probe_candidates(candidate_paths(
        env_override.as_deref(),
        exe_dir,
        home.as_deref(),
    ))
}

// ─── 대화에 물려 줄 MCP 서버 ────────────────────────────────────────────────

/// 이 대화에 물려 줄 MCP 서버들.
///
/// **우리 것 하나**다: `oculpm-mcp`. 그러면 앱 안의 에이전트가 `journal_write`
/// ·`plan_update` 를 그대로 쓴다 — 프로젝트에 `.mcp.json` 을 등록해 두지 않았어도.
/// (이 앱은 자기 자신을 추적한다. 에이전트가 일지를 못 쓰는 것이 기본값이면 그
/// 전제가 반쪽이 된다.)
///
/// 넘기는 것은 둘이다.
///
/// - `OCULPM_AGENT_ID` — **누가 부르는지.** 도구의 `agent_id` 기본값이
///   `claude-code` 라서, provider 가 둘이 된 뒤로는 Codex 가 쓴 일지가 전부
///   Claude 의 것으로 기록됐다.
/// - `OCULPM_SESSION_ID` — **어느 대화인지.**
///   ([`OCULPM_SESSION_ENV`](crate::oculpm::mcp::tools::OCULPM_SESSION_ENV))
/// - `CLAUDE_CODE_SESSION_ID` — 같은 값을 옛 이름으로도 한 번 더.
///   ([`CLAUDE_SESSION_ENV`](crate::oculpm::mcp::tools::CLAUDE_SESSION_ENV))
///
///   왜 둘인가: 예전에는 Claude 이름 하나였고, 그 이름은 **Claude Code CLI 자신도**
///   자식에게 실어 준다. 어댑터가 우리 값을 자기 대화 id 로 덮어쓰면 일지의
///   `agent.session` 이 우리 마커·원장과 갈라져, 판정 사다리의 1순위가 그 대화의
///   일지를 못 알아본다 ({#gate-beyond-cc}). 이제 중립 이름이 먼저 읽히므로 우리
///   신원이 이기고, 옛 이름은 낡은 사이드카 바이너리(중립 이름을 모르는 설치본)를
///   위한 폴백으로만 남는다.
pub fn client_mcp_servers(
    provider: AcpProvider,
    session_token: &str,
    probe: &McpBinaryProbe,
) -> Vec<McpServer> {
    let Some(binary) = probe.path.clone() else {
        // 조용한 성공을 만들지 않는다 — 빈 목록을 돌려주더라도 그 사실은
        // `AcpRecordingStatus` 로 화면까지 올라간다 ({#mcp-missing-visible}).
        return Vec::new();
    };
    vec![McpServer::Stdio(McpServerStdio::new("oculpm", binary).env(
        vec![
            EnvVariable::new(crate::oculpm::mcp::tools::AGENT_ID_ENV, provider.agent_id()),
            EnvVariable::new(crate::oculpm::mcp::tools::OCULPM_SESSION_ENV, session_token),
            EnvVariable::new(crate::oculpm::mcp::tools::CLAUDE_SESSION_ENV, session_token),
        ],
    ))]
}

// ─── 화면에 올라가는 판정 ───────────────────────────────────────────────────

/// 이 대상(프로젝트×provider)에서 **마지막으로 연 대화**의 기록 상태.
///
/// 재구성이 아니라 **그때 실제로 일어난 일**을 적어 둔다. 다시 계산하면
/// "지금은 있는데 그때는 없었다"를 영영 말할 수 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct AcpRecordingStatus {
    /// 기록 도구가 이 대화에 붙었는가.
    pub attached: bool,
    /// 붙였다면 그 바이너리.
    pub binary_path: Option<String>,
    /// 못 찾았다면 순서대로 찾아본 자리.
    pub searched: Vec<String>,
    /// 이 대화가 일지에 남길 신원 (`agent.session`).
    pub session_token: Option<String>,
    /// 그 신원과 짝지어진 ACP 대화 id.
    pub acp_session_id: Option<String>,
}

impl AcpRecordingStatus {
    pub fn from_probe(probe: &McpBinaryProbe, session_token: &str) -> Self {
        Self {
            attached: probe.path.is_some(),
            binary_path: probe.path.as_ref().map(|p| p.display().to_string()),
            searched: if probe.path.is_some() {
                Vec::new()
            } else {
                probe.searched_display()
            },
            session_token: Some(session_token.to_string()),
            acp_session_id: None,
        }
    }
}

/// 대상별 **마지막 부착 결과**. 대화별이 아닌 이유: 바이너리 부재는 기계 수준의
/// 사실이라 대화를 옮겨도 달라지지 않는다. 어느 대화에서 확인한 것인지는
/// [`AcpRecordingStatus::acp_session_id`] 가 들고 있다.
#[derive(Default)]
pub struct AcpRecordingState {
    last: std::sync::Mutex<std::collections::HashMap<u64, AcpRecordingStatus>>,
}

impl AcpRecordingState {
    pub fn record(&self, target_id: u64, status: AcpRecordingStatus) {
        if let Ok(mut map) = self.last.lock() {
            map.insert(target_id, status);
        }
    }

    pub fn get(&self, target_id: u64) -> Option<AcpRecordingStatus> {
        self.last
            .lock()
            .ok()
            .and_then(|m| m.get(&target_id).cloned())
    }
}

// ─── UUID ↔ 기록 신원 원장 ──────────────────────────────────────────────────

/// 한 대화의 두 이름.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionLink {
    /// 어댑터가 발급한 ACP 대화 id.
    pub acp_session_id: String,
    /// 우리가 발급한 기록 신원 (`acp-<workday>-<hex>`).
    pub oculpm_session: String,
    /// `claude-code` · `codex`.
    pub provider: String,
    pub project_root: String,
    pub bound_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Ledger {
    version: u32,
    links: Vec<SessionLink>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: 1,
            links: Vec::new(),
        }
    }
}

/// 이 대화의 기록 신원을 발급한다.
///
/// 모양이 `acp-<workday>-<hex8>` 인 이유는 사람이 프론트매터에서 읽기 때문이다 —
/// 언제 시작된 대화인지가 값 안에 있다. `SessionId` 방언(`manual-`/`mcp-`/…)과
/// **같은 이름 공간이 아니다**: 이 값이 들어가는 자리는 `agent.session`(에이전트
/// 자신의 대화 id, 자유 문자열)이지 `session_id` 가 아니다.
pub fn mint_token(now: DateTime<Local>) -> String {
    let hex = uuid::Uuid::new_v4().simple().to_string();
    format!("acp-{}-{}", now.format("%Y%m%d"), &hex[..8])
}

pub fn ledger_path(app_data: &Path) -> PathBuf {
    app_data.join(LEDGER_SUBDIR).join(LEDGER_FILE)
}

fn lock_path(app_data: &Path) -> PathBuf {
    app_data.join(LEDGER_SUBDIR).join(LEDGER_LOCK)
}

fn read_ledger(path: &Path) -> Ledger {
    // 읽을 수 없거나 깨진 원장은 **빈 것으로 본다.** 여기 든 것은 라우팅
    // 편의이지 기록이 아니라서, 못 읽으면 새 토큰을 발급하는 것이 정답이다.
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Ledger>(&raw).ok())
        .unwrap_or_default()
}

fn write_ledger(path: &Path, ledger: &Ledger) -> Result<(), String> {
    let mut json = serde_json::to_string_pretty(ledger).map_err(|e| e.to_string())?;
    json.push('\n');
    write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

/// 같은 ACP id 는 하나만 남는다 — 최신이 이긴다.
pub fn upsert(mut links: Vec<SessionLink>, link: SessionLink) -> Vec<SessionLink> {
    links.retain(|l| l.acp_session_id != link.acp_session_id);
    links.push(link);
    links
}

/// 나이와 개수로 걷는다. 원장이 무한히 자라지 않게 하는 유일한 장치다 —
/// 어댑터 종료는 대화를 지우지 않으므로 "끝났으니 지운다"만으로는 부족하다.
pub fn prune(
    mut links: Vec<SessionLink>,
    now: DateTime<Utc>,
    max_links: usize,
    max_age_days: i64,
) -> Vec<SessionLink> {
    let cutoff = now - Duration::days(max_age_days);
    links.retain(|l| match DateTime::parse_from_rfc3339(&l.last_seen_at) {
        // 시각을 못 읽는 항목은 **남긴다** — 판정할 수 없는 것을 버리지 않는다
        // (개수 상한이 뒤를 봐준다).
        Err(_) => true,
        Ok(seen) => seen.with_timezone(&Utc) >= cutoff,
    });
    if links.len() > max_links {
        // 오래 안 본 것부터 버린다.
        links.sort_by(|a, b| a.last_seen_at.cmp(&b.last_seen_at));
        let drop = links.len() - max_links;
        links.drain(..drop);
    }
    links
}

fn with_ledger<T>(app_data: &Path, f: impl FnOnce(&mut Ledger) -> T) -> Result<T, String> {
    let path = ledger_path(app_data);
    let _guard = FileGuard::acquire(
        &lock_path(app_data),
        Utc::now(),
        GuardPolicy::waiting(LEDGER_WAIT_MS),
    )
    .map_err(|e| e.to_string())?;
    let mut ledger = read_ledger(&path);
    let out = f(&mut ledger);
    ledger.links = prune(
        std::mem::take(&mut ledger.links),
        Utc::now(),
        MAX_LINKS,
        MAX_AGE_DAYS,
    );
    write_ledger(&path, &ledger)?;
    Ok(out)
}

/// 이 ACP 대화의 기록 신원 — 원장에 있으면 **그것**, 없으면 새로 발급해 적는다.
///
/// 재개(`session/load`)가 이 길을 탄다. 같은 대화가 앱 재시작을 사이에 두고도
/// 같은 신원을 갖는 이유가 여기다.
pub fn token_for_existing(
    app_data: &Path,
    acp_session_id: &str,
    provider: AcpProvider,
    project_root: &Path,
) -> String {
    let minted = mint_token(Local::now());
    with_ledger(app_data, |ledger| {
        let now = Utc::now().to_rfc3339();
        if let Some(found) = ledger
            .links
            .iter_mut()
            .find(|l| l.acp_session_id == acp_session_id)
        {
            found.last_seen_at = now;
            return found.oculpm_session.clone();
        }
        ledger.links = upsert(
            std::mem::take(&mut ledger.links),
            SessionLink {
                acp_session_id: acp_session_id.to_string(),
                oculpm_session: minted.clone(),
                provider: provider.agent_id().to_string(),
                project_root: project_root.display().to_string(),
                bound_at: now.clone(),
                last_seen_at: now,
            },
        );
        minted.clone()
    })
    .unwrap_or_else(|e| {
        // 원장을 못 잡아도 대화는 열려야 한다. 신원은 이번 대화에 한해 살아
        // 있고(환경변수로 이미 나갔다), 다음 재개 때 새로 발급될 뿐이다.
        tracing::warn!("ACP 세션 원장을 쓰지 못했습니다 — {e}");
        minted
    })
}

/// 새로 만든 대화의 UUID 를 이미 발급해 둔 토큰과 짝짓는다.
pub fn bind(
    app_data: &Path,
    acp_session_id: &str,
    token: &str,
    provider: AcpProvider,
    project_root: &Path,
) {
    let now = Utc::now().to_rfc3339();
    let link = SessionLink {
        acp_session_id: acp_session_id.to_string(),
        oculpm_session: token.to_string(),
        provider: provider.agent_id().to_string(),
        project_root: project_root.display().to_string(),
        bound_at: now.clone(),
        last_seen_at: now,
    };
    if let Err(e) = with_ledger(app_data, |ledger| {
        ledger.links = upsert(std::mem::take(&mut ledger.links), link);
    }) {
        tracing::warn!("ACP 세션 매핑을 적지 못했습니다 — {e}");
    }
}

/// 대화가 **영구 삭제**됐다 — 매핑도 함께 지운다.
pub fn forget(app_data: &Path, acp_session_id: &str) {
    if let Err(e) = with_ledger(app_data, |ledger| {
        ledger.links.retain(|l| l.acp_session_id != acp_session_id);
    }) {
        tracing::debug!("ACP 세션 매핑 정리 실패 (무시) — {e}");
    }
}

/// 짝지어진 기록 신원 (없으면 `None`). 쓰기 없이 읽기만 한다.
pub fn lookup(app_data: &Path, acp_session_id: &str) -> Option<String> {
    read_ledger(&ledger_path(app_data))
        .links
        .into_iter()
        .find(|l| l.acp_session_id == acp_session_id)
        .map(|l| l.oculpm_session)
}

#[cfg(test)]
mod tests;
