//! 테마 파일 저장소 — `app_data_dir()/themes/<id>.json`.
//!
//! 디스크가 SSOT 다. 목록은 매번 디렉터리를 읽는다 (테마는 많아야 수십 개고,
//! 캐시를 두면 다른 창이 저장한 테마가 이 창에서 안 보이는 종류의 버그가 생긴다).
//! 읽다 실패한 파일은 **건너뛰되 사유를 로그로 남긴다** — 한 장이 깨졌다고
//! 갤러리 전체가 빈 화면이 되면 안 된다.

use std::path::{Path, PathBuf};

use crate::app_error::AppError;
use crate::oculpm::atomic_io::write_atomic;
use crate::themes::{is_valid_id, validate, ThemeFile, MAX_THEME_BYTES};

pub fn themes_dir(app_data: &Path) -> PathBuf {
    app_data.join("themes")
}

fn theme_path(app_data: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !is_valid_id(id) {
        return Err(AppError::new(
            "theme_bad_id",
            format!("theme id {id:?} is not a plain identifier"),
        ));
    }
    Ok(themes_dir(app_data).join(format!("{id}.json")))
}

/// 저장된 사용자 테마 전부. 이름순 — 갤러리가 매번 같은 순서로 그려진다.
pub fn list(app_data: &Path) -> Vec<ThemeFile> {
    let dir = themes_dir(app_data);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new(); // 아직 하나도 만들지 않았다 — 빈 갤러리다.
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match read_one(&path) {
            Ok(theme) => out.push(theme),
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "skipping unreadable theme")
            }
        }
    }
    out.sort_by(|a, b| a.metadata.name.cmp(&b.metadata.name));
    out
}

fn read_one(path: &Path) -> Result<ThemeFile, AppError> {
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_THEME_BYTES {
        return Err(AppError::new(
            "theme_too_large",
            format!("theme file is {} bytes (max {MAX_THEME_BYTES})", meta.len()),
        ));
    }
    let raw = std::fs::read_to_string(path)?;
    parse(&raw)
}

/// 문자열 → 검증된 테마. 임포트와 디스크 읽기가 같은 문을 지난다.
pub fn parse(raw: &str) -> Result<ThemeFile, AppError> {
    let theme: ThemeFile = serde_json::from_str(raw)
        .map_err(|e| AppError::new("theme_parse", format!("theme JSON is malformed: {e}")))?;
    validate(theme)
}

/// 검증 후 저장. 파일 이름은 `metadata.id` 가 정본이다.
pub fn save(app_data: &Path, theme: ThemeFile) -> Result<ThemeFile, AppError> {
    let theme = validate(theme)?;
    let path = theme_path(app_data, &theme.metadata.id)?;
    let body = serde_json::to_string_pretty(&theme)
        .map_err(|e| AppError::new("theme_serialize", e.to_string()))?;
    write_atomic(&path, body.as_bytes())?;
    Ok(theme)
}

/// 지운다. 없던 파일이면 `false` — 지우기는 멱등하다.
pub fn delete(app_data: &Path, id: &str) -> Result<bool, AppError> {
    let path = theme_path(app_data, id)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&path)?;
    Ok(true)
}

/// 같은 이름의 기존 테마 (이름은 trim 후 정확 비교). 임포트 충돌 판정용.
pub fn find_by_name(app_data: &Path, name: &str) -> Option<ThemeFile> {
    let needle = name.trim();
    list(app_data)
        .into_iter()
        .find(|t| t.metadata.name == needle)
}

/// 임포트할 파일을 읽어 검증한다 (id 는 아직 손대지 않는다 — 충돌 질의가
/// 먼저다). 크기 상한을 **읽기 전에** 본다.
pub fn read_for_import(path: &Path) -> Result<ThemeFile, AppError> {
    read_one(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::{stamp_new, ThemeMetadata, SCHEMA_V1};
    use std::collections::BTreeMap;

    fn sample(name: &str) -> ThemeFile {
        ThemeFile {
            oculpm_theme: SCHEMA_V1.to_string(),
            metadata: ThemeMetadata {
                id: String::new(),
                name: name.into(),
                version: "1.0".into(),
                author: Some("Kim".into()),
                created_at: String::new(),
                updated_at: String::new(),
            },
            family: "dark".into(),
            is_built_in: false,
            follows_system_accent: false,
            tokens: BTreeMap::from([("--accent".to_string(), "#ff7a66".to_string())]),
        }
    }

    #[test]
    fn save_list_delete_roundtrip_without_loss() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let saved = save(
            dir,
            stamp_new(sample("코랄"), "2026-09-01T00:00:00+09:00".into()),
        )
        .unwrap();

        let all = list(dir);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], saved);
        assert_eq!(all[0].tokens["--accent"], "#ff7a66");

        assert!(delete(dir, &saved.metadata.id).unwrap());
        assert!(!delete(dir, &saved.metadata.id).unwrap());
        assert!(list(dir).is_empty());
    }

    #[test]
    fn list_skips_a_broken_file_instead_of_going_blank() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        save(dir, stamp_new(sample("좋은 테마"), "now".into())).unwrap();
        std::fs::write(themes_dir(dir).join("broken.json"), "{not json").unwrap();
        std::fs::write(themes_dir(dir).join("notes.txt"), "ignored").unwrap();

        let all = list(dir);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].metadata.name, "좋은 테마");
    }

    #[test]
    fn importing_the_same_id_twice_yields_two_themes() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let mut incoming = sample("남의 테마");
        incoming.metadata.id = "fixed-id-from-someone-else".into();

        let a = save(dir, stamp_new(incoming.clone(), "now".into())).unwrap();
        let b = save(dir, stamp_new(incoming, "now".into())).unwrap();

        assert_ne!(a.metadata.id, b.metadata.id);
        assert_eq!(list(dir).len(), 2);
    }

    #[test]
    fn a_theme_id_cannot_escape_the_themes_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let mut evil = sample("탈출");
        evil.metadata.id = "../../../evil".into();
        assert_eq!(save(tmp.path(), evil).unwrap_err().code, "theme_bad_id");
    }

    #[test]
    fn oversized_files_are_refused_before_parsing() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("big.json");
        std::fs::write(&path, vec![b'x'; (MAX_THEME_BYTES + 1) as usize]).unwrap();
        assert_eq!(read_for_import(&path).unwrap_err().code, "theme_too_large");
    }

    #[test]
    fn find_by_name_matches_the_trimmed_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        save(dir, stamp_new(sample("코랄"), "now".into())).unwrap();
        assert!(find_by_name(dir, " 코랄 ").is_some());
        assert!(find_by_name(dir, "코랄2").is_none());
    }
}
