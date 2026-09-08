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
}
