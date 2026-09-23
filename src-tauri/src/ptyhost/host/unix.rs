//! Unix 전송 — 도메인 소켓 `<app_data>/ptyhost[-dev].sock` (`mod.rs` 에서 갈라
//! 나왔다, 크로스플랫폼 L-PTY). 동작은 그대로다 — 옮기면서 자리 잡은 뒤의 공통
//! 절차만 [`super::occupy`] 로 뺐다(Windows 전송이 같은 것을 부른다).

use std::path::Path;
use std::sync::Arc;

use tokio::net::UnixListener;

use super::{log_line, occupy, serve_connection, HostState};

/// 소켓을 점유하고 접속을 받는다 — 테스트가 임시 경로로 직접 부른다.
///
/// bind 경합: 이미 살아있는 호스트가 있으면 **조용히 물러난다** (먼저 뜬 쪽이
/// 승자). 소켓 파일만 남은 시체(host 크래시)는 걷어내고 다시 bind 한다.
pub async fn serve(state: Arc<HostState>, socket: &Path) -> Result<(), String> {
    let listener = match UnixListener::bind(socket) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            if std::os::unix::net::UnixStream::connect(socket).is_ok() {
                // 살아있는 호스트가 이미 있다 — 우리는 필요 없다.
                return Ok(());
            }
            std::fs::remove_file(socket)
                .map_err(|e| format!("failed to remove a stale socket: {e}"))?;
            UnixListener::bind(socket).map_err(|e| format!("failed to bind: {e}"))?
        }
        Err(e) => return Err(format!("failed to bind: {e}")),
    };
    // 같은 사용자만 — 소켓으로 임의 셸을 띄울 수 있으므로 남에게 열지 않는다.
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600));
    }
    occupy(&state, socket);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let (read_half, write_half) = stream.into_split();
                tokio::spawn(serve_connection(state.clone(), read_half, write_half));
            }
            Err(e) => {
                log_line(&state, &format!("accept failed: {e}"));
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}
