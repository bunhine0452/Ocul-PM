//! PR-CI7 — Notion 내보내기 커맨드 (thin). 로직은 `crate::notion` 소유.
//!
//! 토큰은 기존 `secret_set`/`secret_delete` 커맨드(키체인)로 저장·삭제하고,
//! 여기는 검증·상태·내보내기만 담당한다. 내보내기는 회고 화면의 **명시적
//! 버튼**으로만 호출된다 (자동 동기화 없음 — 마스터플랜 D6).

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::notion;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct NotionStatus {
    /// 키체인에 internal integration token 이 있는가 — 없으면 UI 는 내보내기
    /// 버튼 자체를 그리지 않는다 (수용 기준: 토큰 없으면 기능 비노출).
    pub has_token: bool,
    /// 정규화된 부모 페이지 id (설정 안 됐으면 None).
    pub parent_page_id: Option<String>,
}

/// 토큰/부모 페이지 설정 상태 (네트워크 없음).
#[tauri::command]
#[specta::specta]
pub async fn notion_status(db: State<'_, Db>) -> Result<NotionStatus, String> {
    let has_token = crate::secrets::has(notion::NOTION_TOKEN_SECRET).map_err(|e| e.to_string())?;
    let parent_page_id = db
        .settings_get(notion::NOTION_PARENT_SETTING.to_string())
        .await
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    Ok(NotionStatus {
        has_token,
        parent_page_id,
    })
}

/// 입력한 토큰을 실검증한다 (`GET /users/me`) — 성공 시 통합(봇) 이름.
/// 저장은 하지 않는다: UI 가 검증 성공 후 기존 `secret_set` 으로 키체인에 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn notion_verify_token(token: String) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Enter a token".into());
    }
    notion::verify_token(token).await
}

/// 부모 페이지 설정 — URL/ID 를 정규화해 저장한다. 빈 입력은 해제.
/// 반환: 저장된 정규화 id (해제 시 None).
#[tauri::command]
#[specta::specta]
pub async fn notion_set_parent(db: State<'_, Db>, input: String) -> Result<Option<String>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        db.settings_set(notion::NOTION_PARENT_SETTING.to_string(), String::new())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(None);
    }
    let id = notion::normalize_page_id(trimmed).ok_or_else(|| {
        "Could not recognize the page URL/ID — paste a Notion page link".to_string()
    })?;
    db.settings_set(notion::NOTION_PARENT_SETTING.to_string(), id.clone())
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(id))
}

/// 마크다운을 부모 페이지 아래 새 Notion 페이지로 내보낸다 — 성공 시 페이지 URL.
#[tauri::command]
#[specta::specta]
pub async fn notion_export(
    db: State<'_, Db>,
    project_id: u32,
    title: String,
    markdown: String,
) -> Result<String, String> {
    let token = crate::secrets::get(notion::NOTION_TOKEN_SECRET)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No Notion token configured (Settings → Data)".to_string())?;
    let parent = db
        .settings_get(notion::NOTION_PARENT_SETTING.to_string())
        .await
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "No parent page configured for export (Settings → Data)".to_string())?;
    // 심층 방어 (2026-07-20 리뷰): 이 커맨드는 임의 문자열을 외부(api.notion.com)
    // 로 내보내는 유일한 경로다. 현재 호출자는 이미 마스킹된 캐시 파생물만
    // 넘기지만, 커맨드 자체가 보증을 갖도록 프로젝트 redact 패턴을 한 번 더
    // 통과시킨다 (rule_promotion 의 LLM 전송 경로와 동일 규율).
    let patterns = match db.get_project(project_id).await {
        Ok(p) => crate::oculpm::redact::patterns_for_project(std::path::Path::new(&p.root_path)),
        Err(_) => Vec::new(),
    };
    let (title, _) = crate::oculpm::redact::redact_text(&title, &patterns);
    let (markdown, _) = crate::oculpm::redact::redact_text(&markdown, &patterns);
    notion::create_page(&token, &parent, &title, &markdown).await
}

/// #notion-oauth — "Notion 계정 연결". 루프백 리스너를 열고 브라우저로 OAuth
/// 를 시작해, 서버리스 교환을 거쳐 돌아온 토큰을 검증 후 키체인에 저장한다.
/// 성공 시 워크스페이스 이름을 돌려준다. 3분 내 콜백이 없으면 타임아웃.
#[tauri::command]
#[specta::specta]
pub async fn notion_oauth_start() -> Result<String, String> {
    let nonce = notion::oauth_nonce();
    let (listener, port) = tokio::task::spawn_blocking(|| {
        let l = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Could not bind a loopback port: {e}"))?;
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = l.local_addr().map_err(|e| e.to_string())?.port();
        Ok::<_, String>((l, port))
    })
    .await
    .map_err(|e| e.to_string())??;

    let url = format!("{}?port={port}&state={nonce}", notion::OAUTH_START_URL);
    open_in_browser(&url)?;

    let expect = nonce.clone();
    let token = tokio::task::spawn_blocking(move || wait_for_oauth_callback(listener, &expect))
        .await
        .map_err(|e| e.to_string())??;

    let workspace = notion::verify_token(token.trim()).await?;
    crate::secrets::set(notion::NOTION_TOKEN_SECRET, token.trim())
        .map_err(|e| format!("Could not save to the keychain: {e}"))?;
    Ok(workspace)
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(url).status();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status();
    status
        .map_err(|e| format!("Could not open the browser: {e}"))
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err("Could not open the browser".into())
            }
        })
}

/// 루프백에서 콜백 1건을 기다린다 (논블로킹 accept 폴링, 상한
/// [`notion::OAUTH_TIMEOUT_SECS`]). state 불일치는 토큰을 버리고 계속 대기
/// (다른 로컬 프로세스의 우연/악의 요청 방어).
fn wait_for_oauth_callback(
    listener: std::net::TcpListener,
    expect_state: &str,
) -> Result<String, String> {
    use std::io::{Read, Write};
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(notion::OAUTH_TIMEOUT_SECS);
    loop {
        if std::time::Instant::now() > deadline {
            return Err(
                "Timed out waiting for Notion — check that you finished approving in the browser"
                    .into(),
            );
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let text = String::from_utf8_lossy(&buf[..n]);
                let first = text.lines().next().unwrap_or("");
                match notion::parse_oauth_callback(first) {
                    Some((token, state)) if state == expect_state && !token.is_empty() => {
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                              <html><body style=\"font-family:sans-serif;text-align:center;padding-top:80px\">\
                              <h2>Notion \xec\x97\xb0\xea\xb2\xb0 \xec\x99\x84\xeb\xa3\x8c</h2><p>ocul-pm \xec\x95\xb1\xec\x9c\xbc\xeb\xa1\x9c \xeb\x8f\x8c\xec\x95\x84\xea\xb0\x80\xec\x84\xb8\xec\x9a\x94.</p></body></html>",
                        );
                        return Ok(token);
                    }
                    _ => {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n");
                        // state 불일치/무관 요청 — 계속 대기.
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(120));
            }
            Err(e) => return Err(format!("Loopback listener failed: {e}")),
        }
    }
}
