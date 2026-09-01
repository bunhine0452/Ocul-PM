//! 번들 아카이브 읽기 — **가드가 본체다** (Osaurus 라운드 Phase 6 #import-guards).
//!
//! 임포트는 외부 입력이다. ZIP 은 경로를 스스로 들고 있으므로, 그 경로를
//! 믿고 파일을 쓰는 순간 아카이브가 우리 파일 시스템 어디든 쓸 수 있게 된다
//! (zip slip). 여기서는 **엔트리를 디스크에 풀지 않는다** — 메모리로 읽고
//! 검증한 뒤 [`BundleFile`] 로만 내보낸다. 실제 배치는 `install.rs` 가
//! 목적지를 직접 계산해서 한다.
//!
//! 상한은 전부 "정상 번들이라면 절대 안 닿는" 자리에 둔다 — 걸리면 그것은
//! 번들이 아니라 공격이거나 사고다.

use std::io::Read;

/// 압축 해제 후 전체 바이트 상한. Claude 플러그인은 텍스트가 거의 전부다.
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
/// 파일 하나 상한.
pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// 엔트리 수 상한.
pub const MAX_ENTRIES: usize = 4_000;
/// 경로 깊이 상한 (아카이브 루트 기준).
pub const MAX_DEPTH: usize = 8;

/// 상한 묶음. 가드는 한 벌이고 **숫자만 용도별로 다르다** — 대화 export 의
/// `conversations.json` 은 한 파일이 수십 MB 라 플러그인 번들의 파일 상한을
/// 그대로 쓰면 정상 아카이브가 거절된다 (Phase 7 #import-adapters).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub total_bytes: u64,
    pub file_bytes: u64,
    pub entries: usize,
    pub depth: usize,
}

impl Limits {
    /// Claude 플러그인 번들 — 텍스트가 거의 전부다.
    pub const fn plugin_bundle() -> Self {
        Self {
            total_bytes: MAX_TOTAL_BYTES,
            file_bytes: MAX_FILE_BYTES,
            entries: MAX_ENTRIES,
            depth: MAX_DEPTH,
        }
    }

    /// 대화 export — 파일 수는 적고 한 파일이 크다.
    pub const fn conversation_export() -> Self {
        Self {
            total_bytes: 512 * 1024 * 1024,
            file_bytes: 256 * 1024 * 1024,
            entries: 2_000,
            depth: MAX_DEPTH,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleFile {
    /// 아카이브 루트를 벗겨낸 `/` 구분 상대 경로. 언제나 안전하다.
    pub path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveReadOutcome {
    pub files: Vec<BundleFile>,
    /// 받아들이지 않은 엔트리 — `(경로, 사유 코드)`. 조용히 버리지 않는다.
    pub skipped: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveError {
    Open(String),
    /// 상한을 넘겨 **전체를 거절**했다 (부분 실패가 아니다).
    TooLarge(String),
}

impl ArchiveError {
    pub fn code(&self) -> &'static str {
        match self {
            ArchiveError::Open(_) => "bundle_unreadable",
            ArchiveError::TooLarge(_) => "bundle_too_large",
        }
    }
    pub fn detail(&self) -> String {
        match self {
            ArchiveError::Open(m) => format!("cannot read the bundle archive: {m}"),
            ArchiveError::TooLarge(m) => format!("bundle exceeds an import limit: {m}"),
        }
    }
}

/// ZIP 바이트를 읽어 안전한 파일 목록으로. GitHub 아카이브처럼 **단일 최상위
/// 폴더**로 감싸인 경우 그 한 겹을 벗긴다 (`repo-main/skills/…` → `skills/…`).
pub fn read_zip(bytes: Vec<u8>) -> Result<ArchiveReadOutcome, ArchiveError> {
    read_zip_with(bytes, Limits::plugin_bundle())
}

/// 상한을 지정해 읽는다. 가드의 **논리**는 [`read_zip`] 과 완전히 같다.
pub fn read_zip_with(bytes: Vec<u8>, lim: Limits) -> Result<ArchiveReadOutcome, ArchiveError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(cursor).map_err(|e| ArchiveError::Open(e.to_string()))?;

    if zip.len() > lim.entries {
        return Err(ArchiveError::TooLarge(format!(
            "{} entries exceeds the {} entry limit",
            zip.len(),
            lim.entries
        )));
    }

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    let mut total: u64 = 0;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| ArchiveError::Open(e.to_string()))?;
        let raw = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }

        // `enclosed_name` 은 절대 경로·`..`·드라이브 접두·심링크 탈출을 전부
        // 거절한다. 우리 손으로 `..` 을 세지 않는 이유는 인코딩 변종
        // (`..%2f`, 백슬래시)까지 크레이트가 이미 다루기 때문이다.
        let Some(safe) = entry.enclosed_name() else {
            skipped.push((raw, "unsafe_path".into()));
            continue;
        };
        let rel = safe
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if rel.len() > lim.depth {
            skipped.push((raw, "too_deep".into()));
            continue;
        }

        let size = entry.size();
        if size > lim.file_bytes {
            skipped.push((raw, "file_too_large".into()));
            continue;
        }
        total = total.saturating_add(size);
        if total > lim.total_bytes {
            return Err(ArchiveError::TooLarge(format!(
                "uncompressed size passed the {} byte limit",
                lim.total_bytes
            )));
        }

        // 선언된 크기를 믿지 않고 읽기 자체를 자른다 — 헤더가 거짓말하는
        // 아카이브(zip bomb)가 상한 검사를 통과해 버리는 길을 막는다.
        let mut buf = Vec::new();
        let mut limited = entry.by_ref().take(lim.file_bytes + 1);
        if let Err(e) = limited.read_to_end(&mut buf) {
            skipped.push((raw, format!("read_failed:{e}")));
            continue;
        }
        if buf.len() as u64 > lim.file_bytes {
            skipped.push((raw, "file_too_large".into()));
            continue;
        }

        files.push(BundleFile {
            path: rel.join("/"),
            bytes: buf,
        });
    }

    Ok(ArchiveReadOutcome {
        files: strip_single_root(files),
        skipped,
    })
}

/// 번들 루트에 실제로 있을 수 있는 이름. GitHub 아카이브의 래퍼 폴더
/// (`repo-main/`)와 진짜 번들 폴더를 가르는 기준이다.
const BUNDLE_TOP_LEVEL: &[&str] = &[
    ".claude-plugin",
    "skills",
    "commands",
    "agents",
    "hooks",
    "bin",
    "lspServers",
    "outputStyles",
    "channels",
];

/// GitHub 아카이브가 씌우는 한 겹(`repo-main/…`)을 벗긴다.
///
/// 단순히 "최상위가 하나면 벗긴다" 로는 안 된다 — `skills/` 하나만 든 정상
/// 번들의 `skills/` 를 벗겨 버린다 (테스트가 이 실수를 잡았다). 그래서 그
/// 하나가 **번들 최상위로 쓰이는 이름이 아닐 때만** 래퍼로 본다.
fn strip_single_root(files: Vec<BundleFile>) -> Vec<BundleFile> {
    // 루트 바로 아래 파일이 있으면(`/` 없는 경로) 벗길 겹이 없다.
    if files.is_empty() || files.iter().any(|f| !f.path.contains('/')) {
        return files;
    }
    let mut roots = files.iter().filter_map(|f| f.path.split('/').next());
    let Some(first) = roots.next().map(str::to_string) else {
        return files;
    };
    if roots.any(|r| r != first) || BUNDLE_TOP_LEVEL.contains(&first.as_str()) {
        return files;
    }
    files
        .into_iter()
        .map(|f| BundleFile {
            path: f.path[first.len() + 1..].to_string(),
            bytes: f.bytes,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            for (name, body) in entries {
                w.start_file(*name, SimpleFileOptions::default()).unwrap();
                w.write_all(body).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn rejects_paths_that_escape_the_archive_root() {
        let bytes = zip_of(&[("../../etc/passwd", b"pwned"), ("skills/a/SKILL.md", b"ok")]);
        let out = read_zip(bytes).unwrap();
        assert_eq!(out.files.len(), 1, "only the safe entry survives");
        assert_eq!(out.files[0].path, "skills/a/SKILL.md");
        assert_eq!(out.skipped[0].1, "unsafe_path");
        assert!(
            !out.files.iter().any(|f| f.path.contains("passwd")),
            "zip slip must never reach the file list"
        );
    }

    #[test]
    fn strips_the_github_style_single_root_folder() {
        let bytes = zip_of(&[
            ("repo-main/skills/a/SKILL.md", b"x"),
            ("repo-main/commands/b.md", b"y"),
        ]);
        let out = read_zip(bytes).unwrap();
        let mut paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["commands/b.md", "skills/a/SKILL.md"]);
    }

    #[test]
    fn never_strips_a_real_bundle_folder_even_when_it_is_the_only_one() {
        // 회귀: "최상위가 하나면 벗긴다" 는 `skills/` 만 든 번들을 망가뜨렸다.
        let bytes = zip_of(&[("skills/a/SKILL.md", b"x"), ("skills/b/SKILL.md", b"y")]);
        let out = read_zip(bytes).unwrap();
        let mut paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["skills/a/SKILL.md", "skills/b/SKILL.md"]);
    }

    #[test]
    fn keeps_paths_when_there_is_no_single_root() {
        let bytes = zip_of(&[("skills/a/SKILL.md", b"x"), (".mcp.json", b"{}")]);
        let out = read_zip(bytes).unwrap();
        let mut paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec![".mcp.json", "skills/a/SKILL.md"]);
    }

    #[test]
    fn skips_a_too_deep_path_but_keeps_the_rest() {
        let deep = "a/b/c/d/e/f/g/h/i/too-deep.md";
        let bytes = zip_of(&[(deep, b"x"), ("commands/b.md", b"y")]);
        let out = read_zip(bytes).unwrap();
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].path, "commands/b.md");
        assert_eq!(out.skipped[0].1, "too_deep");
    }

    #[test]
    fn refuses_an_entry_count_over_the_limit() {
        let names: Vec<String> = (0..MAX_ENTRIES + 1).map(|i| format!("f{i}.md")).collect();
        let entries: Vec<(&str, &[u8])> = names
            .iter()
            .map(|n| (n.as_str(), b"x".as_slice()))
            .collect();
        let err = read_zip(zip_of(&entries)).unwrap_err();
        assert_eq!(err.code(), "bundle_too_large");
    }

    #[test]
    fn refuses_a_file_bigger_than_the_per_file_limit() {
        let big = vec![b'x'; (MAX_FILE_BYTES + 1) as usize];
        let bytes = zip_of(&[("skills/a/SKILL.md", &big), ("commands/b.md", b"ok")]);
        let out = read_zip(bytes).unwrap();
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].path, "commands/b.md");
        assert_eq!(out.skipped[0].1, "file_too_large");
    }

    #[test]
    fn a_broken_archive_is_an_error_not_an_empty_bundle() {
        let err = read_zip(b"not a zip at all".to_vec()).unwrap_err();
        assert_eq!(err.code(), "bundle_unreadable");
    }
}
