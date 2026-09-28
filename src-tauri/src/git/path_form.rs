//! 경로의 **저장 모양** — git 이 쓰는 `/` 구분 상대 경로 (크로스플랫폼 라운드
//! L-FS · 플랜 `cross-platform-port` #fs-separators).
//!
//! `.oculpm/` 에 적히는 상대 경로(ndjson 의 `path` · 일지 `files_touched` · diff
//! 사이드카의 키 · 색인 행)와 그것을 가르는 술어(`starts_with(".oculpm/journal/")`
//! 같은 것)는 전부 `/` 를 전제로 한다. git 도 어느 OS 에서든 `/` 로 말한다. 그런데
//! `Path::to_string_lossy()` 는 윈도우에서 `\` 를 내놓는다 — 그대로 두면 워처가
//! 일지 변경을 코드 변경으로 읽고(분류가 빗나간다), 자기 억제가 빗나가고, 같은
//! 파일이 `src/a.ts` 와 `src\a.ts` 두 행이 된다.
//!
//! 그래서 경로를 **문자열로 바꾸는 순간**에 이 모듈을 지난다:
//!
//! - [`slash`] — 상대 경로 → `/` 문자열. **윈도우에서만** `\` 를 바꾼다. 유닉스에서
//!   `\` 는 구분자가 아니라 파일명에 쓸 수 있는 글자라 건드리지 않는다 (macOS 동작
//!   불변 — 설계 D3).
//! - [`plain`] — 윈도우의 확장 길이 접두 `\\?\` 를 걷은 절대 경로. `canonicalize` 는
//!   윈도우에서 `\\?\C:\…` 를 돌려주는데, git·사용자·설정이 주는 경로는 `C:\…` 라
//!   `strip_prefix` 가 접두 종류가 달라 늘 실패한다 (둘은 같은 파일이다).

use std::path::{Path, PathBuf};

/// 상대 경로를 git·`.oculpm` 저장 모양(`/` 구분) 문자열로.
///
/// 유닉스에서는 `to_string_lossy()` 와 한 글자도 다르지 않다.
pub fn slash(rel: &Path) -> String {
    let s = rel.to_string_lossy();
    #[cfg(windows)]
    {
        s.replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        s.into_owned()
    }
}

/// 윈도우 확장 길이 접두(`\\?\C:\…` · `\\?\UNC\srv\share\…`)를 걷은 경로. 그 밖의
/// 모양과 다른 OS 에서는 그대로 돌려준다.
///
/// 드라이브·UNC 가 아닌 장치 경로(`\\?\Volume{…}\`)는 걷으면 뜻이 바뀌므로 그대로 둔다.
pub fn plain(p: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            let b = rest.as_bytes();
            if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
                return PathBuf::from(rest);
            }
        }
        p.to_path_buf()
    }
    #[cfg(not(windows))]
    {
        p.to_path_buf()
    }
}

/// `path` 를 `base` 기준 상대 경로(저장 모양)로. 둘 다 [`plain`] 으로 편 뒤 비교하므로
/// 한쪽만 `canonicalize` 된 윈도우 경로(`\\?\C:\…` 대 `C:\…`)도 맞는다. `base` 밖이면 `None`.
pub fn relative_to(base: &Path, path: &Path) -> Option<String> {
    let (base, path) = (plain(base), plain(path));
    path.strip_prefix(&base).ok().map(slash)
}

/// 에이전트가 **글자로** 준 일지 `files_touched` 경로 → 저장 모양 (#fs-files-touched-norm).
///
/// 쓰는 순간(MCP `journal_write` · 수동 일지 작성)에 한 번 편다. 그대로 적으면 윈도우
/// 에이전트의 `src\a.ts` 가 diff 사이드카·색인·git 이 말하는 `src/a.ts` 와 다른 파일이
/// 된다. 구분자는 [`slash`] 규칙(윈도우에서만 `\` → `/`), 루트 안의 절대 경로는
/// [`relative_to`] 로 상대 경로, 상대 경로의 `./`·겹친 `/` 는 걷는다. 루트 밖 절대 경로와
/// `..` 는 뜻을 바꾸지 않도록 그대로 둔다 — 이미 저장 모양이면 한 글자도 안 바뀐다.
pub fn touched_path(root: &Path, raw: &str) -> String {
    let p = Path::new(raw.trim());
    if p.is_absolute() {
        return relative_to(root, p).unwrap_or_else(|| slash(p));
    }
    let s = slash(p);
    // 드라이브 없는 윈도우 루트(`\src\a.ts`)는 절대가 아니지만 뿌리는 지킨다.
    let lead = if s.starts_with('/') { "/" } else { "" };
    let segs: Vec<&str> = s
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect();
    format!("{lead}{}", segs.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_joins_components_with_forward_slashes() {
        let rel = Path::new(".oculpm")
            .join("journal")
            .join("20260923")
            .join("x.md");
        assert_eq!(slash(&rel), ".oculpm/journal/20260923/x.md");
        assert_eq!(slash(Path::new("src/a.ts")), "src/a.ts");
        assert_eq!(slash(Path::new("")), "");
    }

    /// 유닉스에서 `\` 는 파일명 글자다 — 바꾸면 다른 파일을 가리킨다.
    #[cfg(unix)]
    #[test]
    fn a_backslash_in_a_unix_file_name_is_kept() {
        assert_eq!(slash(Path::new(r"dir/a\b.txt")), r"dir/a\b.txt");
        assert_eq!(plain(Path::new(r"\\?\C:\x")), PathBuf::from(r"\\?\C:\x"));
        assert_eq!(
            touched_path(Path::new("/r"), r"dir/a\b.txt"),
            r"dir/a\b.txt"
        );
    }

    /// 일지 `files_touched` 는 쓰는 순간 저장 모양으로 — 이미 저장 모양이면 무변경,
    /// `./`·겹친 `/`·앞뒤 공백은 걷고, 루트 안 절대 경로는 상대로, 밖이면 그대로
    /// (#fs-files-touched-norm).
    #[test]
    fn touched_paths_are_stored_in_slash_form() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for same in ["src/a.ts", "src-tauri/src/lib.rs", "../sibling/x.rs", "a"] {
            assert_eq!(touched_path(root, same), same);
        }
        assert_eq!(touched_path(root, " ./src//a.ts "), "src/a.ts");
        assert_eq!(touched_path(root, "src/./a.ts"), "src/a.ts");
        let inside = root.join("src").join("a.ts");
        assert_eq!(touched_path(root, &inside.to_string_lossy()), "src/a.ts");
        let outside = dir.path().parent().unwrap().join("elsewhere.rs");
        assert_eq!(
            touched_path(root, &outside.to_string_lossy()),
            slash(&outside)
        );
    }

    /// 윈도우 에이전트의 `src\a.ts` 가 diff 사이드카 키(`src/a.ts`)와 같은 행이 된다.
    #[cfg(windows)]
    #[test]
    fn windows_agent_paths_in_files_touched_become_slash_form() {
        let root = Path::new(r"C:\Users\me\repo");
        assert_eq!(touched_path(root, r"src\a.ts"), "src/a.ts");
        assert_eq!(touched_path(root, r".\src\\a.ts"), "src/a.ts");
        assert_eq!(touched_path(root, r"C:\Users\me\repo\src\a.ts"), "src/a.ts");
        assert_eq!(
            touched_path(root, r"\\?\C:\Users\me\repo\src\a.ts"),
            "src/a.ts"
        );
        assert_eq!(touched_path(root, r"\src\a.ts"), "/src/a.ts");
        assert_eq!(touched_path(root, "src/a.ts"), "src/a.ts");
    }

    #[cfg(windows)]
    #[test]
    fn windows_separators_and_verbatim_prefixes_are_normalised() {
        assert_eq!(slash(Path::new(r"src\a.ts")), "src/a.ts");
        assert_eq!(
            slash(Path::new(r".oculpm\agents/_template.md")),
            ".oculpm/agents/_template.md"
        );

        assert_eq!(
            plain(Path::new(r"\\?\C:\Users\me\p")),
            PathBuf::from(r"C:\Users\me\p")
        );
        assert_eq!(
            plain(Path::new(r"\\?\UNC\srv\share\p")),
            PathBuf::from(r"\\srv\share\p")
        );
        assert_eq!(
            plain(Path::new(r"C:\Users\me\p")),
            PathBuf::from(r"C:\Users\me\p")
        );
        // 드라이브가 아닌 장치 경로는 걷지 않는다.
        let vol = r"\\?\Volume{0000}\p";
        assert_eq!(plain(Path::new(vol)), PathBuf::from(vol));

        // `canonicalize` 한 쪽(`\\?\`)과 git 이 준 쪽(`C:/…`)이 같은 뿌리로 맞는다.
        assert_eq!(
            relative_to(
                Path::new("C:/Users/me/repo"),
                Path::new(r"\\?\C:\Users\me\repo\src\page.tsx")
            )
            .as_deref(),
            Some("src/page.tsx")
        );
    }

    /// 실제 파일시스템에서: `canonicalize` 가 내놓는 모양과 원래 모양이 같은 뿌리로 맞는다
    /// (윈도우는 `\\?\` · 러너의 8.3 짧은 이름 `RUNNER~1` 까지, macOS 는 `/var` → `/private/var`).
    #[test]
    fn a_canonicalized_path_is_relative_to_its_canonicalized_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("app").join("src")).unwrap();
        let file = dir.path().join("app").join("src").join("page.tsx");
        std::fs::write(&file, "x").unwrap();
        let root = dir.path().canonicalize().unwrap();
        let file = file.canonicalize().unwrap();
        assert_eq!(
            relative_to(&root, &file).as_deref(),
            Some("app/src/page.tsx")
        );
        assert_eq!(relative_to(&root.join("elsewhere"), &file), None);
    }
}
