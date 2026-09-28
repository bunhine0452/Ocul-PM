//! 줄바꿈 보존 — 윈도우 체크아웃의 `.oculpm/` 문서 (크로스플랫폼 #fs-crlf-parsers).
//!
//! Git for Windows 는 `core.autocrlf=true` 가 기본이라 저장소의 LF 문서가 작업
//! 트리에서 CRLF 로 풀린다. 플래너·논의·롤업의 파서와 편집기는 전부 `\n` 으로
//! 자르는 줄 수술이라, 그대로 두면 `\r` 이 줄 끝에 남아 제목·셀로 새고(접힌
//! 항목은 줄 **가운데**에 박힌다), 새로 끼운 줄만 LF 인 섞인 파일이 된다.
//!
//! 판정은 L-FS 의 프론트매터·관리 블록(`frontmatter::write_frontmatter_and_body` ·
//! `atomic_io::write_managed_block`)과 같다 — `\r\n` 이 하나라도 있으면 CRLF
//! 문서다. 읽을 때 LF 로 펴고, 쓸 때 원래 줄바꿈으로 되돌린다.

use std::borrow::Cow;

/// CRLF 문서인가.
pub(crate) fn is_crlf(text: &str) -> bool {
    text.contains("\r\n")
}

/// CRLF → LF. LF 문서는 복사 없이 그대로.
pub(crate) fn to_lf(text: &str) -> Cow<'_, str> {
    if is_crlf(text) {
        Cow::Owned(text.replace("\r\n", "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

/// LF 로 짠 `text` 를 `crlf` 이면 CRLF 로. 이미 섞여 있어도 `\r\r\n` 을 만들지 않는다.
pub(crate) fn with_eol(text: String, crlf: bool) -> String {
    if crlf {
        to_lf(&text).replace('\n', "\r\n")
    } else {
        text
    }
}

/// LF 를 가정한 편집 `edit` 을 줄바꿈과 무관하게 — `md` 를 LF 로 펴서 넘기고,
/// 결과 문서를 `md` 의 줄바꿈으로 되돌린다.
pub(crate) fn keeping<T: Relined>(md: &str, edit: impl FnOnce(&str) -> T) -> T {
    let out = edit(&to_lf(md));
    if is_crlf(md) {
        out.relined()
    } else {
        out
    }
}

/// 편집 결과 안의 문서를 CRLF 로 되돌리는 법 — [`keeping`] 이 부른다.
pub(crate) trait Relined {
    fn relined(self) -> Self;
}

impl Relined for String {
    fn relined(self) -> Self {
        with_eol(self, true)
    }
}

impl<T: Relined, E> Relined for Result<T, E> {
    fn relined(self) -> Self {
        self.map(Relined::relined)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crlf_document_is_edited_as_lf_and_written_back_as_crlf() {
        let seen = std::cell::Cell::new(false);
        let out = keeping("a\r\nb\r\n", |md| {
            seen.set(!md.contains('\r'));
            format!("{md}c\n")
        });
        assert!(seen.get(), "편집기는 LF 만 본다");
        assert_eq!(out, "a\r\nb\r\nc\r\n");
        // LF 문서는 LF 그대로 — macOS 동작 불변.
        assert_eq!(keeping("a\n", |md| format!("{md}b\n")), "a\nb\n");
        let err: Result<String, String> = keeping("a\r\n", |_| Err("x".into()));
        assert_eq!(err, Err("x".into()));
    }

    #[test]
    fn with_eol_never_doubles_the_carriage_return() {
        assert_eq!(with_eol("a\r\nb\n".into(), true), "a\r\nb\r\n");
        assert_eq!(with_eol("a\nb\n".into(), false), "a\nb\n");
        assert_eq!(to_lf("a\r\nb"), "a\nb");
        assert!(matches!(to_lf("a\nb"), Cow::Borrowed(_)));
    }
}
