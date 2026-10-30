//! 터미널 이미지 미리보기 — 터미널에 찍힌 이미지 경로에 마우스를 올리면 프런트가 부른다
//! (`features/terminal/fileLinks.ts`). 3.12.0 에 처음 들어왔다가 3.x 터미널과 함께 걷혔고,
//! 4.x 앱 안 터미널로 다시 들였다(사용자 요청 2026-10-30).
//!
//! # 왜 프로젝트 루트 밖도 읽는가
//!
//! 에이전트가 그림을 만드는 자리는 대개 프로젝트 밖이다 — Claude Code 의 스크래치패드
//! (`/private/tmp/claude-…`), `~/Downloads`. `secure_join` 을 걸면 정작 보여 주려던 그림만
//! 못 연다. 대신 **그림 말고는 돌려줄 수 없게** 좁힌다: 절대경로 · 심링크를 푼 실제 파일의
//! 확장자가 이미지 · 정규 파일 · 16MB 이하 · 선두 바이트가 이미지 시그니처. 확장자만 `.png` 로
//! 바꾼 키 파일은 마지막에서 걸린다. 바이트는 웹뷰의 `<img>` 로만 간다 — 밖으로 나가는 통신은 없다.

use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

/// 미리보기 상한.
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

/// 이미지 확장자 — 프런트의 `IMAGE_EXT` 와 같은 목록이다(svg 는 텍스트라 없다).
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"];

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TermImage {
    pub mime: String,
    pub bytes: u32,
    pub base64: String,
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_image_preview(path: String) -> Result<TermImage, AppError> {
    tauri::async_runtime::spawn_blocking(move || read_image(Path::new(&path)))
        .await
        .map_err(|e| AppError::new("image_unreadable", e.to_string()))?
}

fn read_image(path: &Path) -> Result<TermImage, AppError> {
    use base64::Engine;

    let unreadable = |e: std::io::Error| AppError::new("image_unreadable", e.to_string());
    if !path.is_absolute() {
        return Err(AppError::new("image_unreadable", "not an absolute path"));
    }
    let real = std::fs::canonicalize(path).map_err(unreadable)?;
    let ext = real
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !ext.is_some_and(|e| IMAGE_EXT.contains(&e.as_str())) {
        return Err(AppError::code("image_not_image"));
    }
    // 여는 것보다 먼저 본다 — `x.png` 라는 이름의 FIFO 는 열기에서 영영 멈춘다.
    let meta = std::fs::metadata(&real).map_err(unreadable)?;
    if !meta.is_file() {
        return Err(AppError::code("image_not_image"));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(AppError::code("image_too_large"));
    }
    // 크기를 본 뒤에 자랄 수 있으니 읽기 자체도 상한+1 에서 끊는다.
    let mut bytes = Vec::new();
    std::fs::File::open(&real)
        .map_err(unreadable)?
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(unreadable)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::code("image_too_large"));
    }
    let mime = sniff_image_mime(&bytes).ok_or_else(|| AppError::code("image_not_image"))?;
    Ok(TermImage {
        mime: mime.to_string(),
        bytes: bytes.len() as u32,
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// 선두 바이트로 본 래스터 이미지 MIME — 시그니처가 없으면 `None`. 확장자는 이름일 뿐이다.
fn sniff_image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    // ISO-BMFF — 크기(4) + "ftyp" + 주 브랜드(4).
    if b.len() >= 12 && &b[4..8] == b"ftyp" && matches!(&b[8..12], b"avif" | b"avis") {
        return Some("image/avif");
    }
    // 두 글자 "BM" 은 약하다 — 헤더(14) + 정보 헤더 크기 필드까지 있어야 본다.
    if b.len() >= 26 && b.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if b.len() >= 6 && b.starts_with(&[0, 0, 1, 0]) && b[4..6] != [0, 0] {
        return Some("image/x-icon");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_1X1: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0";

    #[test]
    fn sniff_reads_signatures_not_names() {
        assert_eq!(
            sniff_image_mime(b"\x89PNG\r\n\x1a\n\0\0"),
            Some("image/png")
        );
        assert_eq!(
            sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(sniff_image_mime(b"GIF89a.."), Some("image/gif"));
        assert_eq!(
            sniff_image_mime(b"RIFF\0\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(
            sniff_image_mime(b"\0\0\0\x1cftypavif\0\0"),
            Some("image/avif")
        );
        // 이미지 이름을 한 텍스트 — 키 파일 · 셸 스크립트 · svg 는 그림이 아니다.
        assert_eq!(
            sniff_image_mime(b"-----BEGIN OPENSSH PRIVATE KEY-----"),
            None
        );
        assert_eq!(sniff_image_mime(b"#!/bin/sh\necho hi\n"), None);
        assert_eq!(
            sniff_image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            None
        );
        assert_eq!(sniff_image_mime(b"BMW notes"), None);
        assert_eq!(sniff_image_mime(b""), None);
    }

    #[test]
    fn reads_a_real_image_outside_any_project() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("Lineup.PNG");
        std::fs::write(&png, PNG_1X1).unwrap();
        let img = read_image(&png).unwrap();
        assert_eq!(img.mime, "image/png");
        assert_eq!(img.bytes as usize, PNG_1X1.len());
    }

    /// 그림이 아닌 것은 이름 · 경로 모양과 무관하게 거절한다.
    #[test]
    fn refuses_anything_that_is_not_an_image() {
        let dir = tempfile::tempdir().unwrap();
        let code = |p: &Path| read_image(p).unwrap_err().code;
        // 확장자만 그림인 키 파일.
        let fake = dir.path().join("id_rsa.png");
        std::fs::write(&fake, b"-----BEGIN OPENSSH PRIVATE KEY-----").unwrap();
        assert_eq!(code(&fake), "image_not_image");
        // 그림 이름의 심링크가 가리키는 텍스트 — 실제 파일의 확장자로 본다.
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, PNG_1X1).unwrap();
        #[cfg(unix)]
        {
            let link = dir.path().join("shot.png");
            std::os::unix::fs::symlink(&secret, &link).unwrap();
            assert_eq!(code(&link), "image_not_image");
        }
        // 디렉터리 · 상대경로 · 없는 파일.
        let folder = dir.path().join("pics.png");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(code(&folder), "image_not_image");
        assert_eq!(code(Path::new("assets/a.png")), "image_unreadable");
        assert_eq!(code(&dir.path().join("gone.png")), "image_unreadable");
    }
}
