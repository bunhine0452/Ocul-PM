//! 백그라운드 감시 부트스트랩 — 앱 시작 시 추적 중인 **모든** 프로젝트의
//! watcher 를 순차로 띄운다.
//!
//! watcher 가 탭 수명에 묶여 있던 시절의 자리라 `window` 아래 산다. 호출자는
//! `lib.rs` setup 하나뿐이고 레지스트리를 건드리지 않는다.

use super::*;

/// 추적 중인 **모든** 프로젝트의 감시를 시작한다 (앱 시작 시 1회).
///
/// 왜 전부인가 — 이 앱의 약속은 "외부 에이전트가 한 일을 기록한다" 이고, 그
/// 기록은 watcher 가 만든다. 예전에는 watcher 가 **탭 수명**에 묶여 있어서,
/// 탭을 열지 않은 프로젝트에서 에이전트가 아무리 일해도 세션이 생성조차
/// 되지 않았다 — 상단바가 "하나만 감지" 하던 이유가 이것이다.
///
/// 부하는 순차 + 간격으로 흩는다: 프로젝트 N 개의 init(디스크 쓰기 포함)과
/// 인덱싱이 동시에 터지면 콜드 스타트가 눈에 띄게 느려지고, macOS 폴더 접근
/// 권한 프롬프트가 한꺼번에 쏟아진다. 실패는 프로젝트 단위로 삼킨다 —
/// 하나가 안 열린다고 나머지 감시를 포기할 이유가 없다.
pub fn start_background_watchers(app: &AppHandle) {
    const STAGGER: std::time::Duration = std::time::Duration::from_millis(400);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let projects = {
            let db = handle.state::<crate::db::Db>();
            match db.list_projects().await {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(target: "oculpm::bootstrap", error = %e, "프로젝트 목록 조회 실패");
                    return;
                }
            }
        };
        tracing::info!(target: "oculpm::bootstrap", n = projects.len(), "백그라운드 감시 시작");

        for project in projects {
            let root = std::path::PathBuf::from(&project.root_path);
            // 사라진 폴더는 조용히 건너뛴다 — 사용자가 옮겼거나 지웠을 뿐,
            // 시작 로그를 에러로 채울 일이 아니다.
            if !root.is_dir() {
                continue;
            }
            let lang = {
                let db = handle.state::<crate::db::Db>();
                match crate::oculpm::content_lang::current(&db).await {
                    crate::oculpm::content_lang::ContentLang::English => "en",
                    _ => "ko",
                }
            };
            let manager = handle.state::<crate::oculpm::manager::OculpmManager>();
            if let Err(e) = manager.init_project(project.id, &root, lang).await {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e,
                    "init 실패 — 이 프로젝트는 감시하지 않는다"
                );
                continue;
            }
            // **앱이 새로 뜰 때만** 살아 있는 다른 인스턴스에게서 락을 가져온다
            // (2026-08-23). "가장 최근에 연 인스턴스가 주인" 이라는 규칙이라야
            // 사용자가 결과를 예측할 수 있다 — 예전엔 먼저 뜬 쪽이 영원히
            // 이겨서, 설치본을 띄워 둔 채 개발 빌드를 돌리면 개발 빌드가 어떤
            // 프로젝트도 감시하지 못했다. 쫓겨난 쪽은 하트비트가 그 사실을
            // 발견해 5초 안에 감시를 접는다 (`oculpm::lock`).
            //
            // 재시도(감독관)는 이 정책을 쓰지 않는다 — 두 인스턴스가 60초마다
            // 서로를 쫓아내며 무한히 주고받는다.
            if let Err(e) = manager
                .watcher_start_with(
                    project.id,
                    Some(handle.clone()),
                    crate::oculpm::lock::AcquirePolicy::TakeOver,
                )
                .await
            {
                tracing::warn!(
                    target: "oculpm::bootstrap",
                    project_id = project.id, error = %e, "watcher 시작 실패"
                );
            }
            tokio::time::sleep(STAGGER).await;
        }
    });
}
