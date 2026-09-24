//! Windows 호스트 기동 — **복사본에서 먼저, 안 되면 설치 폴더의 원본으로**
//! (플랜 `cross-platform-port` #w3-update-ptyhost-lock).
//!
//! 왜 복사본인가는 [`super::stage`] 에 있다: 업데이트 설치 파일이 `ocul-pm.exe` 를 이름으로
//! 끝내고 그 파일을 덮어쓰므로, 같은 파일로 도는 호스트는 업데이트를 건너지 못한다.
//!
//! 물러서기 규칙 — **세션이 아예 안 뜨는 것보다 업데이트 생존만 잃는 편이 낫다.**
//! 복사본을 못 만들었거나, 띄우지 못했거나, 떴다가 일찍 죽었거나, 시한 안에 받지 않으면
//! 원본으로 띄우고 그 사실(이 호스트는 업데이트를 건너지 못한다)을 로그에 남긴다. 한 번
//! 물러선 앱 프로세스는 다시 복사본을 시도하지 않는다 — 같은 원인으로 매번 시한을
//! 기다리게 하지 않으려고.
//!
//! macOS·Linux 는 이 모듈을 지나지 않는다 (`client::spawn_host_process` 그대로).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::client::{
    connect_spawned, reap, spawn_host_child, PtyHostClient, CONNECT_RETRIES, CONNECT_RETRY_MS,
};
use super::protocol::Event;
use super::stage;

/// 복사본·원본 각각을 기다리는 시한.
pub struct Timing {
    pub copy: Duration,
    pub original: Duration,
}

/// 앱의 시한. 원본은 예전 그대로(3초). 복사본은 넉넉히 — 판마다 **처음 실행되는 새
/// 실행 파일**이라 백신 검사가 기동을 몇 초 붙들 수 있고, 그걸 실패로 읽어 원본으로
/// 물러서면 그 호스트는 다음 업데이트에 끝난다. 정말 실패한 복사본은 대개 일찍 죽어
/// 시한을 다 기다리지 않는다 ([`start`]).
pub const TIMING: Timing = Timing {
    copy: Duration::from_secs(15),
    original: Duration::from_millis(CONNECT_RETRY_MS * CONNECT_RETRIES as u64),
};

/// 호스트를 어디서 띄웠나.
#[derive(Debug)]
pub enum HostOrigin {
    /// 설치 폴더 밖의 복사본 — 업데이트를 건넌다.
    Copy(PathBuf),
    /// 원본 — 업데이트를 건너지 못한다. `why` 는 복사본을 못 쓴 이유.
    Original { why: String },
}

/// 한 번 복사본에서 물러선 앱 프로세스는 다시 시도하지 않는다.
static COPY_GAVE_UP: AtomicBool = AtomicBool::new(false);

/// 앱의 진입 — 자리에 호스트가 없을 때 `client::connect_or_spawn` 이 부른다.
pub async fn spawn_and_connect(
    socket: &Path,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
) -> Result<PtyHostClient, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let stage_dir = if COPY_GAVE_UP.load(Ordering::SeqCst) {
        None
    } else {
        stage::default_stage_dir(socket)
    };
    let (client, origin) = launch(&exe, stage_dir.as_deref(), socket, on_event, &TIMING).await?;
    match origin {
        HostOrigin::Copy(copy) => tracing::info!(
            target: "terminal",
            copy = %copy.display(),
            "PTY 호스트를 설치 폴더 밖의 복사본에서 띄웠다 — 업데이트를 건넌다"
        ),
        HostOrigin::Original { why } => {
            COPY_GAVE_UP.store(true, Ordering::SeqCst);
            tracing::warn!(
                target: "terminal",
                exe = %exe.display(),
                why = %why,
                "PTY 호스트를 설치 폴더의 원본으로 띄웠다 — 이 호스트와 그 안의 세션은 \
                 다음 업데이트를 건너지 못한다(설치 파일이 ocul-pm.exe 를 끝낸다)"
            );
        }
    }
    Ok(client)
}

/// 복사본에서 띄워 붙고, 안 되면 원본으로 — 실행 파일·복사본 자리·시한을 받는다.
/// 통합 테스트가 앱 바이너리로 이 길을 그대로 돈다 (`tests/ptyhost_update_survival.rs`).
///
/// `stage_dir` 이 `None` 이면 곧장 원본이다.
pub async fn launch(
    exe: &Path,
    stage_dir: Option<&Path>,
    socket: &Path,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
    timing: &Timing,
) -> Result<(PtyHostClient, HostOrigin), String> {
    let why = match stage_dir {
        None => "no place for the copy (the local app data dir did not resolve)".to_string(),
        Some(dir) => match from_copy(exe, dir, socket, on_event.clone(), timing.copy).await {
            Ok((client, copy)) => return Ok((client, HostOrigin::Copy(copy))),
            Err(why) => why,
        },
    };
    let client = start(exe, None, socket, on_event, timing.original).await?;
    Ok((client, HostOrigin::Original { why }))
}

/// 복사본을 마련해 띄우고 붙는다. 붙은 뒤에 다른 판의 복사본을 치운다.
async fn from_copy(
    exe: &Path,
    dir: &Path,
    socket: &Path,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
    window: Duration,
) -> Result<(PtyHostClient, PathBuf), String> {
    // 실행 파일 전체를 읽는다(해시·복사) — 워커를 붙들지 않게 블로킹 풀에서.
    let (from, into) = (exe.to_path_buf(), dir.to_path_buf());
    let copy = tokio::task::spawn_blocking(move || stage::stage(&from, &into))
        .await
        .map_err(|e| format!("copying the executable panicked: {e}"))?
        .map_err(|e| format!("failed to copy the executable into {}: {e}", dir.display()))?;
    // 작업 폴더도 복사본 자리로 — 앱의 작업 폴더(대개 설치 폴더)를 물려받으면 그 폴더를
    // 쥔 채 살아 설치 폴더 정리를 막는다. 셸의 시작 폴더와는 무관하다(요청이 주거나
    // 사용자 폴더다 — portable-pty 의 Windows `current_directory`).
    let client = start(&copy, Some(dir), socket, on_event, window)
        .await
        .map_err(|e| format!("the copy at {} did not come up: {e}", copy.display()))?;

    let (dir, keep) = (dir.to_path_buf(), copy.clone());
    if let Ok(pruned) = tokio::task::spawn_blocking(move || stage::prune(&dir, &keep)).await {
        for path in &pruned.removed {
            tracing::info!(target: "terminal", path = %path.display(), "옛 PTY 호스트 복사본을 지웠다");
        }
        for (path, e) in &pruned.kept {
            // 대개 그 복사본으로 도는 호스트가 아직 있다(Windows 는 실행 중인 이미지를 지우지
            // 못한다). 다음 기동 때 다시 본다.
            tracing::info!(
                target: "terminal",
                path = %path.display(),
                error = %e,
                "옛 PTY 호스트 복사본을 남겨 둔다 — 아직 쓰는 호스트가 있다"
            );
        }
    }
    Ok((client, copy))
}

/// `exe` 로 호스트를 띄우고 `window` 안에 붙는다.
///
/// 호스트가 **실패 코드로** 먼저 끝나면(떠 보지도 못했다 — 없는 DLL, 백신 차단, 파이프
/// 만들기 실패) 시한을 다 기다리지 않는다. 0 으로 끝난 것은 실패가 아니다 — 먼저 뜬
/// 호스트가 자리에 있어 비켜 준 것이라 그 호스트에 계속 붙어 본다.
async fn start(
    exe: &Path,
    cwd: Option<&Path>,
    socket: &Path,
    on_event: impl Fn(Event) + Send + Sync + Clone + 'static,
    window: Duration,
) -> Result<PtyHostClient, String> {
    let mut child = spawn_host_child(exe, socket, cwd)?;
    let tries = u32::try_from(window.as_millis() / u128::from(CONNECT_RETRY_MS))
        .unwrap_or(u32::MAX)
        .max(1);
    let result = connect_spawned(socket, on_event, tries, || match child.try_wait() {
        Ok(Some(status)) if !status.success() => {
            Some(format!("the pty-host exited before serving ({status})"))
        }
        _ => None,
    })
    .await;
    reap(child);
    result
}
