//! Atomic file I/O primitives for the `.oculpm/` subsystem.
//!
//! All exposed helpers are **sync** — the operations are cheap, and keeping
//! them sync avoids cascading `async fn` colouring throughout the rest of the
//! subsystem (config, lock, watcher). For one-user, single-machine workloads
//! the cost of a blocking syscall is negligible.
//!
//! Three families:
//! - [`write_atomic`] — temp-file + rename + fsync, never leaves a partial file.
//! - [`append_ndjson`] — append-only single line with 4 KB cap and no-newline
//!   guard. Each line is written + fsynced individually so crash truncation is
//!   line-aligned.
//! - [`read_managed_block`] / [`write_managed_block`] / [`remove_managed_block`]
//!   — locate-or-create a `<begin v1> ... <end>` region inside a file the user
//!   may also be editing. EOL convention (LF / CRLF) of the existing file is
//!   preserved.

use std::path::Path;

use crate::oculpm::error::OculpmError;
use crate::oculpm::spec::CommentStyle;

/// Cap a single ndjson line (without the trailing `\n`) at 4 KB. POSIX
/// guarantees `write()` atomicity up to PIPE_BUF on regular files, so keeping
/// each line under this bound means one line == one atomic write.
pub const NDJSON_LINE_CAP: usize = 4096;

// ─────────────────────────────────────────────────────────────────────────────
// write_atomic
// ─────────────────────────────────────────────────────────────────────────────

/// Write `contents` to `path` via temp file + rename. Never produces a
/// partially-written `path`: callers either see the previous content (if any)
/// or the new content in full.
#[allow(dead_code)] // Consumed by config (W1-PR4), lock (W1-PR5), gitignore (W1-PR8).
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), OculpmError> {
    let parent = path.parent().ok_or_else(|| OculpmError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent"),
    })?;

    if !parent.as_os_str().is_empty() {
        std::fs::create_dir_all(parent).map_err(|source| OculpmError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let tmp_name = format!(
        "{}.{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("oculpm"),
        uuid::Uuid::new_v4()
    );
    let tmp = parent.join(tmp_name);

    // Write + fsync the temp file, then rename. fsync guarantees the contents
    // hit the disk before the rename advertises them.
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|source| OculpmError::Io {
            path: tmp.clone(),
            source,
        })?;
        f.write_all(contents).map_err(|source| OculpmError::Io {
            path: tmp.clone(),
            source,
        })?;
        f.sync_all().map_err(|source| OculpmError::Io {
            path: tmp.clone(),
            source,
        })?;
    } // file closed here

    // `rename` is atomic on POSIX and on Windows via ReplaceFile semantics.
    // If this fails after the temp file has been written, we clean it up so
    // we don't leave litter behind.
    if let Err(source) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(OculpmError::Io {
            path: path.to_path_buf(),
            source,
        });
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// append_ndjson
// ─────────────────────────────────────────────────────────────────────────────

/// Append one ndjson record to `path`. `line` must:
/// - be ≤ `NDJSON_LINE_CAP` bytes (caller fits within this cap, e.g. by
///   truncating long paths);
/// - contain no embedded newline character.
///
/// Each call writes `line + "\n"` and fsyncs. A truncated tail on crash will
/// always be at a newline boundary, so the file remains valid ndjson minus
/// (at most) the final line.
#[allow(dead_code)] // Consumed by the watcher (W2).
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

    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .map_err(|source| OculpmError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    f.write_all(line.as_bytes()).map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    f.write_all(b"\n").map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    f.sync_data().map_err(|source| OculpmError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// managed_block
// ─────────────────────────────────────────────────────────────────────────────

/// Inner contents of a managed block (the lines between `begin`/`end`, with
/// the marker lines stripped).
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub struct ManagedBlock {
    /// Version embedded in the `begin` marker (`v1`, `v2`, ...).
    pub version: u32,
    /// Inner content, lines joined by `\n` regardless of the source file's EOL.
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ManagedBlockResult {
    /// No block was present; one was created.
    Inserted,
    /// Block existed with different content; replaced in-place.
    Updated,
    /// Block existed with identical content; the file was not touched.
    Unchanged,
}

#[allow(dead_code)] // Consumed by gitignore (W1-PR8) and agents (W4).
pub fn read_managed_block(
    path: &Path,
    block_id: &str,
    style: CommentStyle,
) -> Result<Option<ManagedBlock>, OculpmError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };

    let mut version: Option<u32> = None;
    let mut content_lines: Vec<&str> = Vec::new();
    let mut found_end = false;

    for line in text.lines() {
        if version.is_none() {
            if let Some(v) = parse_begin_line(line, block_id, style) {
                version = Some(v);
            } else if is_end_line(line, block_id, style) {
                return Err(OculpmError::ManagedBlockMismatch {
                    path: path.to_path_buf(),
                });
            }
        } else if is_end_line(line, block_id, style) {
            found_end = true;
            break;
        } else {
            content_lines.push(line);
        }
    }

    match (version, found_end) {
        (Some(v), true) => Ok(Some(ManagedBlock {
            version: v,
            content: content_lines.join("\n"),
        })),
        (Some(_), false) => Err(OculpmError::ManagedBlockMismatch {
            path: path.to_path_buf(),
        }),
        (None, _) => Ok(None),
    }
}

#[allow(dead_code)] // Consumed by gitignore (W1-PR8) and agents (W4).
pub fn write_managed_block(
    path: &Path,
    block_id: &str,
    new_content: &str,
    style: CommentStyle,
) -> Result<ManagedBlockResult, OculpmError> {
    let existing = match std::fs::read_to_string(path) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(source) => {
            return Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };
    let existing_text = existing.unwrap_or_default();
    let eol = detect_eol(&existing_text);

    let range = find_marker_range(&existing_text, block_id, style, path)?;
    let block_text = render_block(block_id, new_content, style, eol);

    match range {
        Some(r) => {
            let existing_block = &existing_text[r.begin_start..r.end_end];
            if existing_block == block_text {
                Ok(ManagedBlockResult::Unchanged)
            } else {
                let mut new_text = String::with_capacity(existing_text.len() + block_text.len());
                new_text.push_str(&existing_text[..r.begin_start]);
                new_text.push_str(&block_text);
                new_text.push_str(&existing_text[r.end_end..]);
                write_atomic(path, new_text.as_bytes())?;
                Ok(ManagedBlockResult::Updated)
            }
        }
        None => {
            let new_text = if existing_text.is_empty() {
                block_text
            } else if existing_text.ends_with('\n') {
                // One blank line between existing content and the new block.
                format!("{}{}{}", existing_text, eol, block_text)
            } else {
                format!("{}{}{}{}", existing_text, eol, eol, block_text)
            };
            write_atomic(path, new_text.as_bytes())?;
            Ok(ManagedBlockResult::Inserted)
        }
    }
}

#[allow(dead_code)] // Consumed by agents (W4) when deactivating an adapter.
pub fn remove_managed_block(
    path: &Path,
    block_id: &str,
    style: CommentStyle,
) -> Result<(), OculpmError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(OculpmError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };

    let range = find_marker_range(&text, block_id, style, path)?;
    match range {
        None => Ok(()), // No block, no-op.
        Some(r) => {
            let mut result = String::with_capacity(text.len());
            result.push_str(&text[..r.begin_start]);
            result.push_str(&text[r.end_end..]);
            write_atomic(path, result.as_bytes())?;
            Ok(())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/// Byte range of the managed block (inclusive of the begin/end marker lines
/// and their trailing EOLs).
struct MarkerByteRange {
    begin_start: usize,
    end_end: usize,
}

fn find_marker_range(
    text: &str,
    block_id: &str,
    style: CommentStyle,
    path: &Path,
) -> Result<Option<MarkerByteRange>, OculpmError> {
    let mut begin_start: Option<usize> = None;
    let mut current_byte = 0usize;

    for line in text.split_inclusive('\n') {
        let line_no_eol = line.trim_end_matches('\n').trim_end_matches('\r');
        match begin_start {
            None => {
                if parse_begin_line(line_no_eol, block_id, style).is_some() {
                    begin_start = Some(current_byte);
                } else if is_end_line(line_no_eol, block_id, style) {
                    return Err(OculpmError::ManagedBlockMismatch {
                        path: path.to_path_buf(),
                    });
                }
            }
            Some(begin) => {
                if is_end_line(line_no_eol, block_id, style) {
                    return Ok(Some(MarkerByteRange {
                        begin_start: begin,
                        end_end: current_byte + line.len(),
                    }));
                }
            }
        }
        current_byte += line.len();
    }

    if begin_start.is_some() {
        return Err(OculpmError::ManagedBlockMismatch {
            path: path.to_path_buf(),
        });
    }

    Ok(None)
}

fn detect_eol(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn render_block(block_id: &str, content: &str, style: CommentStyle, eol: &str) -> String {
    let begin = render_begin_line(block_id, style, 1);
    let end = render_end_line(block_id, style);
    let body = if content.is_empty() {
        String::new()
    } else if content.ends_with('\n') {
        content.replace('\n', eol)
    } else {
        format!("{}{}", content.replace('\n', eol), eol)
    };
    format!("{}{}{}{}{}", begin, eol, body, end, eol)
}

fn render_begin_line(block_id: &str, style: CommentStyle, version: u32) -> String {
    let inner = format!("{}:begin v{}", block_id, version);
    match style {
        CommentStyle::Markdown => format!("<!-- {} -->", inner),
        CommentStyle::Hash => format!("# {}", inner),
        CommentStyle::DoubleSlash => format!("// {}", inner),
    }
}

fn render_end_line(block_id: &str, style: CommentStyle) -> String {
    let inner = format!("{}:end", block_id);
    match style {
        CommentStyle::Markdown => format!("<!-- {} -->", inner),
        CommentStyle::Hash => format!("# {}", inner),
        CommentStyle::DoubleSlash => format!("// {}", inner),
    }
}

fn parse_begin_line(line: &str, block_id: &str, style: CommentStyle) -> Option<u32> {
    let trimmed = line.trim();
    let inner = strip_comment_delims(trimmed, style)?;
    let needle = format!("{}:begin v", block_id);
    let rest = inner.strip_prefix(&needle)?;
    rest.trim_end().parse::<u32>().ok()
}

fn is_end_line(line: &str, block_id: &str, style: CommentStyle) -> bool {
    let trimmed = line.trim();
    let inner = match strip_comment_delims(trimmed, style) {
        Some(s) => s,
        None => return false,
    };
    let needle = format!("{}:end", block_id);
    inner == needle
}

fn strip_comment_delims(trimmed: &str, style: CommentStyle) -> Option<&str> {
    let mid = match style {
        CommentStyle::Markdown => trimmed.strip_prefix("<!--")?.strip_suffix("-->")?,
        CommentStyle::Hash => trimmed.strip_prefix('#')?,
        CommentStyle::DoubleSlash => trimmed.strip_prefix("//")?,
    };
    Some(mid.trim())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W1/PR5-atomic-io-lock.md` §5.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ─── write_atomic ───────────────────────────────────────────────────────

    /// Case 1 — write a fresh file and read the same bytes back.
    #[test]
    fn write_atomic_creates_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.txt");
        write_atomic(&path, b"hello").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
    }

    /// Case 2 — overwrite an existing file. The temp file must not survive
    /// the rename: scan the parent dir for stray `*.tmp` entries.
    #[test]
    fn write_atomic_overwrites_and_leaves_no_tmp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("b.txt");
        write_atomic(&path, b"v1").unwrap();
        write_atomic(&path, b"v2-longer").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"v2-longer");

        let strays: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();
        assert!(strays.is_empty(), "unexpected leftover tmp files: {:?}", strays);
    }

    /// Case 3 — auto-create missing parent directories.
    #[test]
    fn write_atomic_creates_missing_parent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/deeper/file.txt");
        write_atomic(&path, b"ok").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"ok");
    }

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

    // ─── managed_block ──────────────────────────────────────────────────────

    /// Case 7 — insert into a non-existent file (LF default) + into a file
    /// that already has content (separator blank line).
    #[test]
    fn managed_block_insert_paths() {
        // 7a — file doesn't exist
        let dir = tempdir().unwrap();
        let path = dir.path().join(".gitignore");
        let r = write_managed_block(&path, "oculpm", ".oculpm/index/\n", CommentStyle::Hash).unwrap();
        assert_eq!(r, ManagedBlockResult::Inserted);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("# oculpm:begin v1"));
        assert!(text.contains(".oculpm/index/"));
        assert!(text.contains("# oculpm:end"));

        // 7b — file with pre-existing content gets a blank-line separator.
        let path2 = dir.path().join(".gitignore2");
        std::fs::write(&path2, "node_modules/\n").unwrap();
        write_managed_block(&path2, "oculpm", ".oculpm/.lock\n", CommentStyle::Hash).unwrap();
        let text2 = std::fs::read_to_string(&path2).unwrap();
        assert!(text2.starts_with("node_modules/\n"));
        // Exactly one blank line between user content and our block.
        assert!(text2.contains("node_modules/\n\n# oculpm:begin v1"));
    }

    /// Case 8 — update existing block content; second write with same content is Unchanged.
    #[test]
    fn managed_block_update_and_unchanged() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".gitignore");
        write_managed_block(&path, "oculpm", "a\n", CommentStyle::Hash).unwrap();
        let r1 = write_managed_block(&path, "oculpm", "b\n", CommentStyle::Hash).unwrap();
        assert_eq!(r1, ManagedBlockResult::Updated);
        let r2 = write_managed_block(&path, "oculpm", "b\n", CommentStyle::Hash).unwrap();
        assert_eq!(r2, ManagedBlockResult::Unchanged);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\nb\n"));
        assert!(!text.contains("\na\n"));
    }

    /// Case 9 — only one marker present → mismatch error.
    #[test]
    fn managed_block_mismatch_orphan_marker() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");
        // Orphan begin (no end)
        std::fs::write(&path, "<!-- oculpm:begin v1 -->\nstuff\n").unwrap();
        let err = read_managed_block(&path, "oculpm", CommentStyle::Markdown).unwrap_err();
        assert!(matches!(err, OculpmError::ManagedBlockMismatch { .. }));

        // Orphan end (no begin)
        std::fs::write(&path, "stuff\n<!-- oculpm:end -->\n").unwrap();
        let err = read_managed_block(&path, "oculpm", CommentStyle::Markdown).unwrap_err();
        assert!(matches!(err, OculpmError::ManagedBlockMismatch { .. }));
    }

    /// Case 10 — read + remove round-trip, preserves surrounding content
    /// AND preserves CRLF line endings detected from the file.
    #[test]
    fn managed_block_read_remove_and_crlf() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");

        // CRLF source
        let initial = "user line 1\r\nuser line 2\r\n";
        std::fs::write(&path, initial).unwrap();

        // Write block — should pick up CRLF EOL convention from the existing file.
        write_managed_block(&path, "oculpm", "managed\nbody\n", CommentStyle::Markdown).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\r\n"), "EOL convention must be preserved: {:?}", text);
        assert!(text.contains("<!-- oculpm:begin v1 -->"));
        assert!(text.contains("managed"));

        // Read block back.
        let block = read_managed_block(&path, "oculpm", CommentStyle::Markdown)
            .unwrap()
            .expect("block must be present");
        assert_eq!(block.version, 1);
        // `content` joins via `\n`, regardless of source EOL.
        assert_eq!(block.content, "managed\nbody");

        // Remove block — user lines survive.
        remove_managed_block(&path, "oculpm", CommentStyle::Markdown).unwrap();
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("user line 1"));
        assert!(after.contains("user line 2"));
        assert!(!after.contains("oculpm:begin"));
        assert!(!after.contains("oculpm:end"));
    }
}
