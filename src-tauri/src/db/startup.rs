//! 기동 때 DB 를 연다 (`db::startup`) — 못 열면 크래시 대신 이유를 보이고 묻는다.
//!
//! 예전엔 `Db::open(..).expect(..)` 였다. 잠긴 DB · 손상 · sqlite-vec 로드 실패 · 새 버전이
//! 쌓은 스키마가 전부 설명 없는 크래시가 됐다 (2026-10-09 리포트). 이제 네이티브 대화상자가
//! 경로와 원인을 보이고 「새로 시작」(원본은 지우지 않고 이름만 바꾼다)과 「종료」 를 준다.
//!
//! 대화상자는 `rfd` 를 직접 쓴다. 셋업은 메인 스레드라, dialog 플러그인의 `blocking_show` 는
//! 메인 스레드로 다시 보내 기다리는 사이에 교착한다. 앱 언어 설정은 바로 이 DB 안에 있어
//! 아직 읽을 수 없으므로 문구는 두 언어로 적는다.

use std::path::{Path, PathBuf};

use crate::db::Db;

const START_FRESH: &str = "새로 시작 · Start fresh";
const QUIT: &str = "종료 · Quit";

/// `app_data/ocul-pm.db` 를 연다. 실패하면 묻고, 거절하면 프로세스를 끝낸다.
pub fn open_or_ask(app_data: &Path) -> Db {
    let path = app_data.join("ocul-pm.db");
    let cause = match tauri::async_runtime::block_on(Db::open(path.clone())) {
        Ok(db) => return db,
        Err(e) => e.to_string(),
    };
    tracing::error!(path = %path.display(), error = %cause, "DB 를 열지 못했다");
    if !ask_start_fresh(&path, &cause) {
        std::process::exit(1);
    }
    let moved = match move_aside(&path) {
        Ok(p) => p,
        Err(e) => fail(&path, &format!("{cause}\n(move aside failed: {e})")),
    };
    tracing::warn!(to = %moved.display(), "DB 를 옮겨 두고 새로 시작한다");
    match tauri::async_runtime::block_on(Db::open(path.clone())) {
        Ok(db) => db,
        Err(e) => fail(&path, &e.to_string()),
    }
}

fn ask_start_fresh(path: &Path, cause: &str) -> bool {
    let answer = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Ocul-PM — 데이터베이스를 열 수 없어요")
        .set_description(format!(
            "앱 데이터베이스를 열지 못했어요.\n\n경로: {}\n원인: {cause}\n\n\
             「새로 시작」 은 지금 파일을 지우지 않고 옆으로 옮겨 둔 뒤 빈 데이터베이스로 \
             시작해요. 일지·플랜은 각 프로젝트의 .oculpm/ 폴더에 있어 다시 읽어 와요 — 설정과 \
             색인은 처음부터예요.\n\n\
             Couldn't open the app database (path and cause above). \"Start fresh\" moves the \
             file aside — nothing is deleted — and starts with an empty database. Journals and \
             plans live in each project's .oculpm/ folder and are read again; settings and the \
             index start over.",
            path.display()
        ))
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            START_FRESH.into(),
            QUIT.into(),
        ))
        .show();
    matches!(answer, rfd::MessageDialogResult::Custom(ref label) if label == START_FRESH)
        || matches!(answer, rfd::MessageDialogResult::Ok)
}

/// 두 번째에도 못 열었다 — 알리고 끝낸다.
fn fail(path: &Path, cause: &str) -> ! {
    tracing::error!(path = %path.display(), error = %cause, "새로 시작도 실패");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Ocul-PM")
        .set_description(format!(
            "새로 시작하지도 못했어요 · Couldn't start fresh either.\n\n{}\n{cause}",
            path.display()
        ))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
    std::process::exit(1)
}

/// `ocul-pm.db`(와 `-wal`·`-shm`)를 `ocul-pm.db.broken-<유닉스초>` 로 옮긴다. 지우지 않는다 —
/// 새 버전이 쌓은 DB 라면 앱을 올린 뒤 되돌려 쓸 수 있어야 한다.
fn move_aside(path: &Path) -> std::io::Result<PathBuf> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ocul-pm.db".into());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = path.with_file_name(format!("{name}.broken-{stamp}"));
    std::fs::rename(path, &dest)?;
    for side in ["-wal", "-shm"] {
        let from = path.with_file_name(format!("{name}{side}"));
        if from.exists() {
            let _ = std::fs::rename(
                &from,
                path.with_file_name(format!("{name}.broken-{stamp}{side}")),
            );
        }
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::move_aside;

    #[test]
    fn moves_the_database_and_its_wal_aside_without_deleting() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("ocul-pm.db");
        std::fs::write(&db, "main").unwrap();
        std::fs::write(dir.path().join("ocul-pm.db-wal"), "wal").unwrap();

        let moved = move_aside(&db).unwrap();
        assert!(!db.exists(), "자리가 비어야 새로 열 수 있다");
        assert_eq!(std::fs::read_to_string(&moved).unwrap(), "main");
        let wal = moved.with_file_name(format!(
            "{}-wal",
            moved.file_name().unwrap().to_string_lossy()
        ));
        assert_eq!(std::fs::read_to_string(wal).unwrap(), "wal");
    }
}
