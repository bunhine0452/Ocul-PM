//! 파일 표면 공용 헬퍼 — 이름 정렬과 확장자→MIME.
//!
//! 원래 문서(docs) 뷰어(`commands::docs`)가 소유하고 코드 화면이 빌려 쓰던
//! 두 함수다. 2026-09-08 에 문서 화면을 없애면서, 남는 소비처(코드 트리·
//! `code_asset` 미리보기)를 위해 중립 자리로 옮겼다 — 사라지는 화면의 모듈에
//! 살아 있는 화면이 의존하고 있으면 삭제가 그때마다 막힌다.

use std::path::Path;

/// 자연 정렬: 숫자 런은 수치로, 나머지는 소문자 사전식으로 비교.
/// 예: `2-x.md` < `10-x.md` (사전식이면 `10` < `2` 가 되는 문제를 피한다).
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na = take_digits(&mut ai);
                    let nb = take_digits(&mut bi);
                    // 앞자리 0 제거 후 자릿수 → 사전식으로 수치 비교 (파싱 오버플로 회피).
                    let va = na.trim_start_matches('0');
                    let vb = nb.trim_start_matches('0');
                    let ord = va.len().cmp(&vb.len()).then_with(|| va.cmp(vb));
                    if ord != Ordering::Equal {
                        return ord;
                    }
                } else {
                    if ca != cb {
                        return ca.cmp(&cb);
                    }
                    ai.next();
                    bi.next();
                }
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    while let Some(c) = it.peek().copied() {
        if c.is_ascii_digit() {
            s.push(c);
            it.next();
        } else {
            break;
        }
    }
    s
}

/// 확장자 → MIME. 코드 화면 미리보기(`code_asset`)가 쓴다 — 브라우저가
/// Blob/데이터 URI 를 어떻게 그릴지는 이 값 하나로 갈린다.
pub(crate) fn mime_for(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 선두 바이트로 본 래스터 이미지 MIME — 시그니처가 없으면 `None`.
///
/// 확장자는 이름일 뿐이라 `.png` 로 바꾼 아무 파일이나 통과한다. 프로젝트 루트
/// 밖을 읽는 터미널 미리보기(`terminal_image_preview`)가 "그림 말고는 돌려줄 수
/// 없다" 를 이 판정 하나로 지킨다. svg 는 텍스트라 여기 없다.
pub(crate) fn sniff_image_mime(b: &[u8]) -> Option<&'static str> {
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

    #[test]
    fn natural_cmp_orders_digit_runs_numerically() {
        use std::cmp::Ordering;
        assert_eq!(natural_cmp("2-two.md", "10-ten.md"), Ordering::Less);
        assert_eq!(natural_cmp("00-zero.md", "2-two.md"), Ordering::Less);
        assert_eq!(natural_cmp("alpha.md", "10-ten.md"), Ordering::Greater);
        assert_eq!(natural_cmp("same.md", "SAME.md"), Ordering::Equal);
    }

    #[test]
    fn mime_detection() {
        assert_eq!(mime_for(Path::new("a/b.png")), "image/png");
        assert_eq!(mime_for(Path::new("a/b.JPG")), "image/jpeg");
        assert_eq!(mime_for(Path::new("a/b.svg")), "image/svg+xml");
        // PDF — 코드 화면 미리보기가 이 값으로 웹뷰 내장 뷰어를 깨운다.
        // 틀리면 iframe 이 빈 채로 뜨고 이유가 화면 어디에도 안 남는다.
        assert_eq!(mime_for(Path::new("a/spec.pdf")), "application/pdf");
        assert_eq!(
            mime_for(Path::new("a/b.unknown")),
            "application/octet-stream"
        );
    }

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
        // 이미지 이름을 한 텍스트 — 키 파일·셸 스크립트·svg 는 그림이 아니다.
        assert_eq!(
            sniff_image_mime(b"-----BEGIN OPENSSH PRIVATE KEY-----"),
            None
        );
        assert_eq!(sniff_image_mime(b"#!/bin/sh\necho hi\n"), None);
        assert_eq!(
            sniff_image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            None
        );
        // "BM" 으로 시작하는 짧은 글은 비트맵이 아니다.
        assert_eq!(sniff_image_mime(b"BMW notes"), None);
        assert_eq!(sniff_image_mime(b""), None);
    }
}
