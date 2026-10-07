//! [`append_ndjson`] — 한 줄짜리 ndjson append (`atomic_io` 의 세 번째 갈래).
//!
//! `atomic_io.rs` 에서 그대로 옮겼다 (파일 크기 래칫). 경로는 `atomic_io::append_ndjson`
//! 그대로다.

use std::path::Path;

use super::NDJSON_LINE_CAP;
use crate::oculpm::error::OculpmError;

/// Append one ndjson record to `path`. `line` must:
/// - be ≤ `NDJSON_LINE_CAP` bytes (caller fits within this cap, e.g. by
///   truncating long paths);
/// - contain no embedded newline character.
///
/// Each call writes `line + "\n"` and fsyncs. A truncated tail on crash will
/// always be at a newline boundary, so the file remains valid ndjson minus
/// (at most) the final line.
pub fn append_ndjson(path: &Path, line: &str) -> Result<(), OculpmError> {
    if line.len() > NDJSON_LINE_CAP {
        return Err(OculpmError::NdjsonLineTooLarge(line.len(), NDJSON_LINE_CAP));
    }
    if line.contains('\n') {
        return Err(OculpmError::NdjsonLineHasNewline);
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|source| OculpmError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
    }

    // Build the full payload (`line + \n`) before writing so the kernel sees
    // a single `write(2)` syscall. Under O_APPEND, writes ≤ PIPE_BUF (4 KB on
    // Linux/macOS) are atomic with respect to other appenders, which is what
    // makes concurrent producers safe. Splitting into two write_all calls
    // (line, then '\n') breaks that guarantee — discovered in W2-PR1's
    // `concurrent_append_does_not_lose_lines` test.
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line.as_bytes());
    buf.push(b'\n');

    // 링크를 따라 열지 않는다. `.oculpm/` 는 저장소에 실려 오는 폴더라 이 자리에
    // 심어 둔 링크가 append 를 루트 밖 파일로 돌릴 수 있다. 유닉스는 O_NOFOLLOW
    // 로 커널이 여는 순간 거부하고(ELOOP), 그 플래그가 없는 Windows 는 열기 전에
    // lstat 으로 본다.
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(OculpmError::Io {
            path: path.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "refusing to append through a symbolic link",
            ),
        });
    }
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let mut f = opts.open(path).map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    f.write_all(&buf).map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    f.sync_data().map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ─── append_ndjson ──────────────────────────────────────────────────────

    /// Case 4 — append several lines, verify ordering preserved.
    #[test]
    fn append_ndjson_appends_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("events.ndjson");
        append_ndjson(&path, r#"{"i":1}"#).unwrap();
        append_ndjson(&path, r#"{"i":2}"#).unwrap();
        append_ndjson(&path, r#"{"i":3}"#).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text, "{\"i\":1}\n{\"i\":2}\n{\"i\":3}\n");
    }

    /// Case 5 — reject lines larger than the 4 KB cap.
    #[test]
    fn append_ndjson_rejects_oversized() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("events.ndjson");
        let huge = "x".repeat(NDJSON_LINE_CAP + 1);
        let err = append_ndjson(&path, &huge).unwrap_err();
        assert!(matches!(err, OculpmError::NdjsonLineTooLarge(_, _)));
        // File must not be created.
        assert!(!path.exists());
    }

    /// Case 6 — reject embedded newline.
    #[test]
    fn append_ndjson_rejects_newline() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("events.ndjson");
        let err = append_ndjson(&path, "a\nb").unwrap_err();
        assert!(matches!(err, OculpmError::NdjsonLineHasNewline));
    }

    /// 링크를 따라 쓰지 않는다 — 저장소에 심어 둔 링크가 append 를 루트 밖으로
    /// 돌리면 안 된다. 대상 파일은 한 바이트도 달라지지 않는다.
    #[test]
    fn append_ndjson_refuses_a_symlinked_target() {
        let dir = tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"keep\n").unwrap();
        let path = dir.path().join("events.ndjson");
        if !crate::test_links::file(&outside, &path) {
            return;
        }
        let err = append_ndjson(&path, r#"{"i":1}"#).unwrap_err();
        assert!(matches!(err, OculpmError::Io { .. }), "{err:?}");
        assert_eq!(std::fs::read(&outside).unwrap(), b"keep\n");
    }
}
