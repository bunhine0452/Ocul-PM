//! 테마 커맨드 — 목록 · 저장 · 삭제 · 가져오기/내보내기 · 시스템 강조색 ·
//! 프로젝트 바인딩 (Osaurus 라운드 Phase 4).
//!
//! 오류는 전부 `AppError { code, detail }` 이고 `code` 는 프런트가 i18n 키로
//! 바꿀 snake_case 식별자다 (완성도 라운드 `#error-convention`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_specta::Event;

use crate::app_error::AppError;
use crate::db::Db;
use crate::themes::{self, store, ThemeFile};

/// 테마 목록이나 프로젝트 바인딩이 바뀌었다 — **모든 창**이 다시 읽는다.
///
/// `SettingsChanged` 를 재활용하지 않는 이유: 테마 파일은 `settings` 테이블에
/// 없다. 설정 이벤트에 태우면 "설정이 바뀌었다" 는 말이 거짓이 되고, 설정을
/// 다시 읽는 쪽(언어·배율)이 이유 없이 깨어난다.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct ThemesChanged {
    /// `"saved" | "deleted" | "imported" | "binding"` — 로그·디버깅용.
    pub reason: String,
}

fn announce(app: &AppHandle, reason: &str) {
    let _ = ThemesChanged {
        reason: reason.to_string(),
    }
    .emit(app);
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::new("app_data_dir", e.to_string()))
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// 저장된 사용자 테마 전부. 내장 5종은 프런트가 정적으로 들고 있다 —
/// `tokens.css` 에서 생성된 JSON 이라 백엔드를 지날 이유가 없다.
#[tauri::command]
#[specta::specta]
pub async fn theme_list(app: AppHandle) -> Result<Vec<ThemeFile>, AppError> {
    let dir = app_data(&app)?;
    Ok(store::list(&dir))
}

/// 만들거나 고친다. `metadata.id` 가 비어 있으면 새 테마로 보고 UUID 를 발급한다.
#[tauri::command]
#[specta::specta]
pub async fn theme_save(app: AppHandle, theme: ThemeFile) -> Result<ThemeFile, AppError> {
    let dir = app_data(&app)?;
    let mut theme = theme;
    if theme.metadata.id.trim().is_empty() {
        theme = themes::stamp_new(theme, now_iso());
    } else {
        theme.metadata.updated_at = now_iso();
        if theme.metadata.created_at.trim().is_empty() {
            theme.metadata.created_at = now_iso();
        }
    }
    let saved = store::save(&dir, theme)?;
    announce(&app, "saved");
    Ok(saved)
}

/// 지운다 (없던 id 면 `false`). 이 테마를 쓰던 창은 전역 설정으로 되돌아간다.
#[tauri::command]
#[specta::specta]
pub async fn theme_delete(app: AppHandle, id: String) -> Result<bool, AppError> {
    let dir = app_data(&app)?;
    let removed = store::delete(&dir, &id)?;
    if removed {
        announce(&app, "deleted");
    }
    Ok(removed)
}

/// 임포트 결과 한 벌.
///
/// 태그 유니온 대신 평평한 구조체다 — 프런트가 `status` 하나로 갈라지고,
/// 충돌이면 `source_path` 를 그대로 되돌려 보내 **파일 선택을 두 번 시키지
/// 않는다**.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ThemeImportOutcome {
    /// `"imported" | "conflict" | "cancelled"`.
    pub status: String,
    pub theme: Option<ThemeFile>,
    /// 충돌한 이름 (status = "conflict").
    pub conflict_name: Option<String>,
    /// 다시 부를 때 넘길 원본 경로.
    pub source_path: Option<String>,
}

/// 테마 파일을 들여온다.
///
/// 규칙 (설계 §3): `metadata.id` 는 **무시하고 새 UUID 를 발급**하고,
/// `is_built_in` 은 강제로 false 이며, 같은 이름이 있으면 조용히 덮어쓰지 않고
/// 되묻는다. 남의 테마 id 가 내 테마와 충돌하는 사고를 구조적으로 없앤다.
///
/// `path` 가 `None` 이면 파일 선택 대화상자를 연다. `on_conflict` 는 첫 시도에
/// `None` 이고, 충돌을 되물은 뒤 `"overwrite"` 또는 `"copy"` 로 다시 부른다.
#[tauri::command]
#[specta::specta]
pub async fn theme_import(
    app: AppHandle,
    path: Option<String>,
    on_conflict: Option<String>,
) -> Result<ThemeImportOutcome, AppError> {
    let dir = app_data(&app)?;

    let source: PathBuf = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
            app.dialog()
                .file()
                .add_filter("Ocul-PM theme", &["json"])
                .pick_file(move |picked| {
                    let _ = tx.send(picked);
                });
            let picked = rx
                .await
                .map_err(|e| AppError::new("dialog_closed", e.to_string()))?;
            match picked {
                Some(FilePath::Path(p)) => p,
                _ => {
                    return Ok(ThemeImportOutcome {
                        status: "cancelled".into(),
                        theme: None,
                        conflict_name: None,
                        source_path: None,
                    })
                }
            }
        }
    };

    let incoming = store::read_for_import(&source)?;
    let existing = store::find_by_name(&dir, &incoming.metadata.name);

    let theme = match (existing, on_conflict.as_deref()) {
        (Some(prev), None) => {
            return Ok(ThemeImportOutcome {
                status: "conflict".into(),
                theme: None,
                conflict_name: Some(prev.metadata.name),
                source_path: Some(source.to_string_lossy().to_string()),
            })
        }
        // 덮어쓰기는 **기존 id 를 유지**한다 — 그래야 그 테마를 쓰던 설정·
        // 프로젝트 바인딩이 그대로 살아 있다.
        (Some(prev), Some("overwrite")) => {
            let mut t = incoming;
            t.metadata.id = prev.metadata.id;
            t.metadata.created_at = prev.metadata.created_at;
            t.metadata.updated_at = now_iso();
            t.is_built_in = false;
            t
        }
        // 사본은 이름을 바꿔 나란히 둔다 — 목록에서 구분할 수 없으면 사본이
        // 아니라 미스터리다.
        (Some(_), Some("copy")) => {
            let mut t = themes::stamp_new(incoming, now_iso());
            t.metadata.name = format!("{} (2)", t.metadata.name);
            t
        }
        (Some(_), Some(other)) => {
            return Err(AppError::new(
                "theme_bad_conflict_mode",
                format!("unknown conflict mode {other:?}"),
            ))
        }
        (None, _) => themes::stamp_new(incoming, now_iso()),
    };

    let saved = store::save(&dir, theme)?;
    announce(&app, "imported");
    Ok(ThemeImportOutcome {
        status: "imported".into(),
        theme: Some(saved),
        conflict_name: None,
        source_path: Some(source.to_string_lossy().to_string()),
    })
}

/// 링크로 받은 테마를 가져온다 (Osaurus 라운드 Phase 8 `#landing-themes`).
///
/// oculpm.com/themes 의 「앱에서 가져오기」가 이 길이다. 딥링크 확인 시트를
/// 지난 **뒤에만** 불린다 — 시트를 지나지 않는 호출 경로가 프런트에 없다.
///
/// 받아온 뒤는 파일 임포트와 **같은 문**을 지난다: 임시 파일에 쓰고
/// `theme_import` 에 넘긴다. 그래서 검증·id 재발급·이름 충돌 질의가 한 벌뿐이고,
/// 충돌 뒤 재시도도 `source_path` 로 그대로 돌아온다 (파일을 다시 받지 않는다).
///
/// 문은 셋이다: **https + 호스트 화이트리스트**(딥링크와 같은 파서) ·
/// **응답 크기 상한**(헤더를 믿지 않고 읽으면서 센다) · **타임아웃**.
#[tauri::command]
#[specta::specta]
pub async fn theme_import_url(
    app: AppHandle,
    url: String,
    on_conflict: Option<String>,
) -> Result<ThemeImportOutcome, AppError> {
    let url = crate::deeplink::validate_theme_url(&url)
        .map_err(|e| AppError::new("theme_url_not_allowed", format!("{e:?}")))?;
    let path = fetch_theme(&url).await?;
    theme_import(app, Some(path.to_string_lossy().to_string()), on_conflict).await
}

/// 테마 JSON 을 받아 임시 파일에 쓰고 그 경로를 돌려준다.
///
/// `Content-Length` 를 믿지 않는다 — 없거나 거짓일 수 있으므로 읽으면서 센다.
async fn fetch_theme(url: &str) -> Result<PathBuf, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::new("theme_fetch", e.to_string()))?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::new("theme_fetch", e.to_string()))?;
    if !res.status().is_success() {
        return Err(AppError::new(
            "theme_fetch_status",
            format!("{} returned {}", url, res.status()),
        ));
    }

    let too_large = || {
        AppError::new(
            "theme_too_large",
            format!("theme exceeds {} bytes", themes::MAX_THEME_BYTES),
        )
    };
    if res
        .content_length()
        .is_some_and(|n| n > themes::MAX_THEME_BYTES)
    {
        return Err(too_large());
    }

    let mut res = res;
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| AppError::new("theme_fetch", e.to_string()))?
    {
        if body.len() + chunk.len() > themes::MAX_THEME_BYTES as usize {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }

    let path = std::env::temp_dir().join(format!("oculpm-theme-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&path, &body)?;
    Ok(path)
}

/// 테마 하나를 `.json` 으로 저장한다. `is_built_in` 은 항상 false 로 기록해
/// 남에게 건넨 파일이 그쪽 갤러리에서 "내장" 으로 앉지 않게 한다.
#[tauri::command]
#[specta::specta]
pub async fn theme_export(app: AppHandle, theme: ThemeFile) -> Result<Option<String>, AppError> {
    let mut theme = themes::validate(theme)?;
    theme.is_built_in = false;

    let file_name = format!("{}.json", sanitize_file_stem(&theme.metadata.name));
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("Ocul-PM theme", &["json"])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|e| AppError::new("dialog_closed", e.to_string()))?;
    let Some(FilePath::Path(path)) = picked else {
        return Ok(None);
    };

    let body = serde_json::to_string_pretty(&theme)
        .map_err(|e| AppError::new("theme_serialize", e.to_string()))?;
    crate::oculpm::atomic_io::write_atomic(&path, body.as_bytes())?;
    Ok(path.to_str().map(String::from))
}

/// 파일 이름으로 쓸 수 있는 형태로. 경로 구분자·제어문자만 걷어내고 한글은
/// 그대로 둔다 (macOS·Windows 모두 유니코드 파일명을 받는다).
fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "theme".to_string()
    } else {
        trimmed
    }
}

/// macOS 시스템 강조색 (hex). 다른 OS 이거나 읽지 못하면 `None`.
///
/// `NSColor.controlAccentColor` 를 objc 로 읽는 대신 `defaults` 를 읽는다 —
/// 이 값은 정수 코드 하나고, 그 코드가 곧 시스템 설정의 여덟 칸이다. objc
/// 표면을 늘리지 않고 같은 답을 얻는다. 키가 없으면 기본값(파랑)이다.
#[tauri::command]
#[specta::specta]
pub async fn system_accent() -> Result<Option<String>, AppError> {
    Ok(read_system_accent())
}

#[cfg(target_os = "macos")]
fn read_system_accent() -> Option<String> {
    let out = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleAccentColor"])
        .output()
        .ok()?;
    // 키가 없으면 `defaults` 가 실패한다 — 그것이 "멀티컬러(기본 파랑)" 다.
    if !out.status.success() {
        return Some(accent_hex(4).to_string());
    }
    let code: i32 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    Some(accent_hex(code).to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_system_accent() -> Option<String> {
    None
}

/// macOS 강조색 코드 → hex. -1 은 그래파이트, 0~6 이 빨강~분홍이다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn accent_hex(code: i32) -> &'static str {
    match code {
        -1 => "#8c8c8c",
        0 => "#ff5257",
        1 => "#f7821b",
        2 => "#ffc600",
        3 => "#62ba46",
        5 => "#a550a7",
        6 => "#f74f9e",
        _ => "#007aff",
    }
}

/// 프로젝트에 테마를 묶는다. `None` = 바인딩 해제(전역 설정으로 폴백).
///
/// 저장하는 것은 **색이 아니라 id** 다 — `027_project_appearance.sql` 의 주석이
/// 적은 규칙과 같다. hex 를 저장하면 라이트/다크에서 같은 값이 성립하지 않는다.
/// 값의 축은 설정의 `theme` 과 같다 (`"dark"` · `"solarized"` · `"custom:<uuid>"`).
#[tauri::command]
#[specta::specta]
pub async fn set_project_theme(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    theme_id: Option<String>,
) -> Result<(), AppError> {
    if let Some(id) = theme_id.as_deref() {
        if !themes::is_valid_binding(id) {
            return Err(AppError::new(
                "theme_bad_id",
                format!("theme id {id:?} is not a plain identifier"),
            ));
        }
    }
    db.set_project_theme(project_id, theme_id).await?;
    announce(&app, "binding");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stem_keeps_hangul_and_drops_path_characters() {
        assert_eq!(sanitize_file_stem("미드나이트 코랄"), "미드나이트 코랄");
        assert_eq!(sanitize_file_stem("a/b:c"), "a-b-c");
        assert_eq!(sanitize_file_stem("  ..  "), "theme");
    }

    #[test]
    fn accent_codes_map_to_the_system_palette() {
        assert_eq!(accent_hex(-1), "#8c8c8c");
        assert_eq!(accent_hex(3), "#62ba46");
        // 알 수 없는 코드·멀티컬러는 파랑 — 색이 사라지는 것보다 낫다.
        assert_eq!(accent_hex(99), "#007aff");
    }
}
