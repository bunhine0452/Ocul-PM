//! 회고 파일 규격 — `.oculpm/retro/<range_key>.md`.
//!
//! "Claude Code 로 생성" 디스패치가 남기는 **에이전트 생성 회고**의 on-disk
//! 표면이다. API 경로(generate_retro)는 SQLite 캐시(retro_insights)에 쓰고,
//! 디스패치 경로는 이 파일에 쓴다 — `get_retro` 가 둘을 비교해 더 최신 쪽을
//! 돌려준다 (SSOT 원칙: 파일은 사람이 읽고 커밋할 수 있는 원본).
//!
//! range_key 는 `YYYYMMDD..YYYYMMDD` 만 허용 — 파일명으로 그대로 쓰이므로
//! 다른 문자는 경로 조작 여지를 만들지 않게 거부한다.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const RETRO_DIR: &str = "retro";

/// 파싱된 회고 파일. `generated_by` 는 승인 화면 표기용 (예: "claude-code").
#[derive(Debug, Clone, PartialEq)]
pub struct RetroFile {
    pub range_key: String,
    pub signature: String,
    pub generated_by: String,
    pub body: String,
}

/// `YYYYMMDD..YYYYMMDD` 형식만 참.
pub fn is_valid_range_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    bytes.len() == 18
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && &bytes[8..10] == b".."
        && bytes[10..].iter().all(u8::is_ascii_digit)
}

pub fn retro_file_path(root: &Path, range_key: &str) -> PathBuf {
    root.join(".oculpm").join(RETRO_DIR).join(format!("{range_key}.md"))
}

/// frontmatter(`oculpm_retro: v1`) + 본문 파싱. 규격이 아니면 `None` —
/// 손으로 만든 잡파일이 회고로 오인되지 않게 조용히 무시한다.
/// CRLF 는 파싱 전에 정규화한다 — 에이전트가 어떤 개행으로 쓰든
/// "터미널에서 방금 만든 회고가 안 보이는" 침묵 실패를 만들지 않기 위해.
pub fn parse_retro_file(md: &str) -> Option<RetroFile> {
    let normalized = md.replace("\r\n", "\n");
    let rest = normalized.strip_prefix("---\n")?;
    let (fm, body) = rest.split_once("\n---\n")?;

    let mut range_key = None;
    let mut signature = None;
    let mut generated_by = None;
    let mut is_retro = false;
    for line in fm.lines() {
        let Some((k, v)) = line.split_once(':') else { continue };
        let v = v.trim();
        match k.trim() {
            "oculpm_retro" => is_retro = v == "v1",
            "range_key" => range_key = Some(v.to_string()),
            "signature" => signature = Some(v.to_string()),
            "generated_by" => generated_by = Some(v.to_string()),
            _ => {}
        }
    }
    if !is_retro {
        return None;
    }
    let range_key = range_key?;
    if !is_valid_range_key(&range_key) {
        return None;
    }
    Some(RetroFile {
        range_key,
        signature: signature.unwrap_or_default(),
        generated_by: generated_by.unwrap_or_else(|| "agent".to_string()),
        body: body.trim().to_string(),
    })
}

/// 디스크에서 읽기. 반환의 u32 는 파일 mtime(unix 초) — DB 캐시의
/// `generated_at` 과 "누가 더 최신인가"를 비교하는 축이다.
/// 파일 안 range_key 가 요청과 다르면(복사·수동 편집 사고) 무시한다.
pub fn read_retro_file(root: &Path, range_key: &str) -> Option<(RetroFile, u32)> {
    if !is_valid_range_key(range_key) {
        return None;
    }
    let path = retro_file_path(root, range_key);
    let md = std::fs::read_to_string(&path).ok()?;
    let parsed = parse_retro_file(&md)?;
    if parsed.range_key != range_key {
        return None;
    }
    let mtime = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);
    Some((parsed, mtime))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = "---\noculpm_retro: v1\nrange_key: 20260726..20260801\nsignature: abc123\ngenerated_by: claude-code\n---\n\n## 한눈에 보기\n본문.\n";

    #[test]
    fn range_key_validation() {
        assert!(is_valid_range_key("20260726..20260801"));
        assert!(!is_valid_range_key("20260726..2026080"));
        assert!(!is_valid_range_key("../secrets..20260801"));
        assert!(!is_valid_range_key("20260726--20260801"));
        assert!(!is_valid_range_key(""));
    }

    #[test]
    fn parses_valid_file() {
        let f = parse_retro_file(VALID).expect("parse");
        assert_eq!(f.range_key, "20260726..20260801");
        assert_eq!(f.signature, "abc123");
        assert_eq!(f.generated_by, "claude-code");
        assert!(f.body.starts_with("## 한눈에 보기"));
    }

    #[test]
    fn parses_crlf_file() {
        let crlf = VALID.replace('\n', "\r\n");
        let f = parse_retro_file(&crlf).expect("crlf parse");
        assert_eq!(f.range_key, "20260726..20260801");
        assert!(f.body.starts_with("## 한눈에 보기"));
    }

    #[test]
    fn rejects_non_retro_frontmatter_and_bad_range() {
        assert!(parse_retro_file("---\noculpm_plan: v1\nrange_key: 20260726..20260801\n---\nx").is_none());
        assert!(parse_retro_file("## 그냥 마크다운").is_none());
        assert!(parse_retro_file("---\noculpm_retro: v1\nrange_key: bad\n---\nx").is_none());
    }

    #[test]
    fn read_ignores_mismatched_range_key() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm").join(RETRO_DIR)).unwrap();
        // 파일명은 다른 기간인데 내용은 VALID(=20260726..20260801) — 무시돼야 한다.
        std::fs::write(retro_file_path(root, "20260801..20260807"), VALID).unwrap();
        assert!(read_retro_file(root, "20260801..20260807").is_none());

        std::fs::write(retro_file_path(root, "20260726..20260801"), VALID).unwrap();
        let (f, mtime) = read_retro_file(root, "20260726..20260801").expect("read");
        assert_eq!(f.signature, "abc123");
        assert!(mtime > 0);
    }
}
