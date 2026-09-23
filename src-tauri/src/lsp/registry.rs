//! 언어 → 언어 서버 사양, 그리고 **서버 루트** 탐색.
//!
//! 루트가 프로젝트 루트가 아니라는 점이 핵심이다. `rust-analyzer` 는 Cargo
//! 워크스페이스 루트(이 저장소에서는 `src-tauri/`)를 원하지 저장소 루트를
//! 원하지 않는다 — 저장소 루트를 주면 워크스페이스를 못 찾아 진단이 아예
//! 안 온다. 열린 파일에서 위로 올라가며 마커를 찾는 것이 표준 해법이고,
//! 그래야 모노레포에서 워크스페이스마다 서버가 따로 뜬다.

use std::path::{Path, PathBuf};

use crate::text::percent_decode;

/// 하나의 언어 서버를 어떻게 띄우는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerSpec {
    /// LSP `textDocument/didOpen` 의 languageId 이자 우리 쪽 키.
    pub language_id: &'static str,
    /// PATH 에서 찾을 실행 파일 이름 (절대경로 하드코딩 금지 — 사용자마다 다르다).
    pub command: &'static str,
    pub args: &'static [&'static str],
    /// 위로 올라가며 찾을 파일들. 앞쪽이 더 강한 신호다.
    pub root_markers: &'static [&'static str],
}

/// 지원 서버. 설치 여부는 여기서 따지지 않는다 — 조달은 `acp::env::resolve_binary`
/// 가 로그인 셸 PATH 로 하고, 없으면 그 사실을 사용자에게 말한다(조용한 실패 금지).
pub const SERVERS: &[ServerSpec] = &[
    ServerSpec {
        language_id: "rust",
        command: "rust-analyzer",
        args: &[],
        root_markers: &["Cargo.toml"],
    },
    ServerSpec {
        language_id: "typescript",
        command: "typescript-language-server",
        args: &["--stdio"],
        root_markers: &["tsconfig.json", "jsconfig.json", "package.json"],
    },
    ServerSpec {
        language_id: "python",
        command: "pyright-langserver",
        args: &["--stdio"],
        root_markers: &["pyproject.toml", "setup.py", "requirements.txt"],
    },
    ServerSpec {
        language_id: "go",
        command: "gopls",
        args: &[],
        root_markers: &["go.mod"],
    },
];

/// 확장자 → 서버. `CodeEditor` 의 하이라이트 언어 매핑(`codeLang.ts`)과는 별개다 —
/// 하이라이트는 있지만 서버는 없는 언어(css·yaml·markdown)가 많다.
pub fn spec_for_path(path: &Path) -> Option<&'static ServerSpec> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let language_id = match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => "typescript",
        "py" | "pyi" => "python",
        "go" => "go",
        _ => return None,
    };
    SERVERS.iter().find(|s| s.language_id == language_id)
}

/// 열린 파일에서 위로 올라가며 서버 루트를 찾는다.
///
/// `project_root` 를 넘어서 올라가지 않는다 — 홈 디렉터리에 굴러다니는
/// `package.json` 을 붙잡고 사용자의 홈 전체를 인덱싱하는 사고를 막는다.
/// 마커를 못 찾으면 `None`: 루트를 모른 채 띄우느니 안 띄우는 게 낫다
/// (엉뚱한 루트로 뜬 서버는 조용히 빈 진단을 내며 고장으로 보인다).
pub fn find_root(spec: &ServerSpec, file: &Path, project_root: &Path) -> Option<PathBuf> {
    let start = if file.is_dir() { file } else { file.parent()? };
    // 마커 우선순위가 디렉터리 깊이보다 강하다: 같은 후보 집합에서 `Cargo.toml`
    // 이 `package.json` 보다 먼저다. 그래서 마커를 바깥 루프에 둔다.
    for marker in spec.root_markers {
        let mut dir = Some(start);
        while let Some(d) = dir {
            if d.join(marker).is_file() {
                return Some(d.to_path_buf());
            }
            if d == project_root {
                break; // 프로젝트 밖으로는 안 나간다
            }
            dir = d.parent();
        }
    }
    None
}

/// `file://` URI. LSP 는 경로가 아니라 URI 로 말한다.
///
/// Windows 는 경로 모양이 다르다 — `C:\a\b.rs` 는 `file:///C:/a/b.rs`, UNC
/// `\\srv\share\a.rs` 는 `file://srv/share/a.rs` 여야 서버가 읽는다
/// ([`windows_uri_path`]). 예전엔 구분자 `\` 까지 퍼센트 인코딩돼
/// `file://C%3A%5Ca…` 가 나갔고, 언어 서버는 그 파일을 몰랐다.
pub fn path_to_uri(path: &Path) -> String {
    let raw = path.to_string_lossy();
    #[cfg(windows)]
    let raw = windows_uri_path(&raw);
    let mut out = String::from("file://");
    for (i, seg) in raw.split('/').enumerate() {
        if i > 0 {
            out.push('/');
        }
        // 드라이브 문자(`C:`)의 콜론은 그대로 둔다 — `C%3A` 는 URL 표준상 드라이브로
        // 읽히지 않아 서버에 따라 경로를 잃는다.
        if cfg!(windows) && i == 1 && is_drive(seg) {
            out.push_str(seg);
        } else {
            out.push_str(&encode_uri_segment(seg));
        }
    }
    out
}

/// URI → 경로. 서버가 정의 위치로 돌려주는 값을 되돌린다.
pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let decoded = percent_decode(rest);
    #[cfg(windows)]
    let decoded = windows_path_of_uri(&decoded);
    Some(PathBuf::from(decoded))
}

/// 프로젝트 상대 경로 → 프런트가 쓰는 `/` 구분 문자열.
///
/// 프런트(탭·진단·정의로 이동)는 경로를 `/` 로 비교한다. Windows 의
/// `strip_prefix` 결과를 그대로 문자열로 만들면 `src\main.rs` 가 되어 같은 파일을
/// 못 알아본다. 다른 OS 에서는 그대로다 — 유닉스 파일 이름에는 `\` 가 들어갈 수
/// 있으므로 바꾸지 않는다.
pub fn rel_string(rel: &Path) -> String {
    #[cfg(windows)]
    {
        rel.to_string_lossy().replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        rel.to_string_lossy().to_string()
    }
}

/// `C:` · `c:` — 드라이브 문자 한 세그먼트.
fn is_drive(seg: &str) -> bool {
    let b = seg.as_bytes();
    b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// Windows 경로 문자열 → URI 경로 부분(`/` 구분). 순수 함수라 어느 OS 에서든
/// 테스트한다.
///
/// - `C:\a\b` → `/C:/a/b`
/// - `\\?\C:\a` (canonicalize 가 붙이는 긴 경로 접두) → `/C:/a`
/// - `\\srv\share\a`, `\\?\UNC\srv\share\a` → `//srv/share/a` (호스트 자리)
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_uri_path(raw: &str) -> String {
    let s = raw.replace('\\', "/");
    let s = if let Some(rest) = s.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = s.strip_prefix("//?/") {
        rest.to_string()
    } else {
        s
    };
    if s.starts_with("//") {
        s
    } else if is_drive(s.get(..2).unwrap_or_default()) {
        format!("/{s}")
    } else {
        s
    }
}

/// [`windows_uri_path`] 의 역 — 퍼센트 디코딩이 끝난 `file://` 뒤쪽 → Windows
/// 경로. 서버가 `c%3A`·소문자 드라이브로 돌려줘도 같은 경로가 된다.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_path_of_uri(decoded: &str) -> String {
    let b = decoded.as_bytes();
    if b.first() == Some(&b'/') && is_drive(decoded.get(1..3).unwrap_or_default()) {
        let mut out = decoded[1..].replace('/', "\\");
        out[..1].make_ascii_uppercase();
        out
    } else if !decoded.is_empty() && !decoded.starts_with('/') {
        // `file://srv/share/a` — 호스트가 있는 URI 는 UNC 다.
        format!("\\\\{}", decoded.replace('/', "\\"))
    } else {
        decoded.to_string()
    }
}

/// 경로 세그먼트의 퍼센트 인코딩. 공백·`#`·`?` 가 든 경로가 실제로 있고,
/// 한글은 UTF-8 바이트로 인코딩된다.
fn encode_uri_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.as_bytes() {
        let c = *b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn maps_extensions_to_servers_and_ignores_the_rest() {
        assert_eq!(
            spec_for_path(Path::new("a/b.rs")).unwrap().language_id,
            "rust"
        );
        assert_eq!(
            spec_for_path(Path::new("a/b.tsx")).unwrap().language_id,
            "typescript"
        );
        assert_eq!(
            spec_for_path(Path::new("a/b.PY")).unwrap().language_id,
            "python"
        );
        // 하이라이트는 되지만 서버는 없는 것들 — None 이어야 조용히 안 띄운다.
        assert!(spec_for_path(Path::new("a/b.css")).is_none());
        assert!(spec_for_path(Path::new("a/b.md")).is_none());
        assert!(spec_for_path(Path::new("Makefile")).is_none());
    }

    /// 이 저장소의 실제 모양 — 저장소 루트가 아니라 `src-tauri/` 가 Cargo 루트다.
    #[test]
    fn root_is_the_workspace_not_the_project_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src-tauri/src/oculpm")).unwrap();
        std::fs::write(root.join("src-tauri/Cargo.toml"), "[package]").unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();

        let spec = spec_for_path(Path::new("x.rs")).unwrap();
        let found = find_root(spec, &root.join("src-tauri/src/oculpm/watcher.rs"), root).unwrap();
        assert_eq!(
            found,
            root.join("src-tauri"),
            "Cargo 루트가 아니라 저장소 루트를 골랐다"
        );
    }

    /// 모노레포 — 워크스페이스마다 따로 떠야 한다 (가장 가까운 마커).
    #[test]
    fn nearest_marker_wins_so_monorepos_get_one_server_per_workspace() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("packages/web/src")).unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();
        std::fs::write(root.join("packages/web/package.json"), "{}").unwrap();

        let spec = spec_for_path(Path::new("x.ts")).unwrap();
        let found = find_root(spec, &root.join("packages/web/src/a.ts"), root).unwrap();
        assert_eq!(found, root.join("packages/web"));
    }

    /// 마커 우선순위가 깊이보다 강하다 — tsconfig 가 위에 있어도 package.json 보다 먼저.
    #[test]
    fn marker_priority_beats_directory_depth() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("app/src")).unwrap();
        std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
        std::fs::write(root.join("app/package.json"), "{}").unwrap();

        let spec = spec_for_path(Path::new("x.ts")).unwrap();
        let found = find_root(spec, &root.join("app/src/a.ts"), root).unwrap();
        assert_eq!(found, root, "tsconfig.json 이 package.json 을 이겨야 한다");
    }

    /// 프로젝트 밖으로 나가지 않는다 — 홈에 굴러다니는 package.json 을 잡고
    /// 홈 전체를 인덱싱하는 사고 방지.
    #[test]
    fn never_escapes_the_project_root() {
        let tmp = TempDir::new().unwrap();
        let outer = tmp.path();
        std::fs::write(outer.join("Cargo.toml"), "[package]").unwrap();
        let project = outer.join("inner");
        std::fs::create_dir_all(project.join("src")).unwrap();

        let spec = spec_for_path(Path::new("x.rs")).unwrap();
        assert!(
            find_root(spec, &project.join("src/a.rs"), &project).is_none(),
            "프로젝트 밖의 Cargo.toml 을 붙잡았다"
        );
    }

    /// 프런트(`src/features/code/lspBridge.ts` 의 `LSP_EXTENSIONS`)가 같은 집합을
    /// 따로 들고 있다 — CM6 확장 구성이 마운트 1회라 부착 여부를 그때 알아야 하기
    /// 때문이다. 여기서 늘리고 저기서 안 늘리면 새 언어의 진단이 조용히 안 뜬다.
    #[test]
    fn extension_coverage_matches_frontend() {
        // 프런트 `LSP_EXTENSIONS` 와 **정확히** 같아야 한다.
        let expected = [
            "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "pyi", "go",
        ];
        for ext in expected {
            assert!(
                spec_for_path(Path::new(&format!("a.{ext}"))).is_some(),
                ".{ext} 가 프런트 목록에는 있는데 여기서는 서버가 없다"
            );
        }
        // 반대 방향 — 여기서 지원하는데 프런트 목록에 없는 것이 생기면 잡는다.
        for ext in ["rb", "java", "c", "cpp", "cs", "php", "swift", "kt"] {
            assert!(
                spec_for_path(Path::new(&format!("a.{ext}"))).is_none(),
                ".{ext} 를 여기서 지원하기 시작했다 — lspBridge.ts 의 LSP_EXTENSIONS 도 같이 늘려라"
            );
        }
    }

    #[test]
    fn uri_round_trips_spaces_and_hangul() {
        for p in [
            "/Users/kim/Desktop/git/ai-pm/src-tauri/src/lib.rs",
            "/Users/kim/my project/a.rs",
            "/Users/kim/한글 폴더/코드.rs",
            "/tmp/a#b?c.rs",
        ] {
            let uri = path_to_uri(Path::new(p));
            assert!(uri.starts_with("file:///"), "{uri}");
            assert!(!uri.contains(' '), "공백이 인코딩되지 않았다: {uri}");
            assert_eq!(
                uri_to_path(&uri).unwrap(),
                PathBuf::from(p),
                "왕복 실패: {uri}"
            );
        }
    }

    /// 프로젝트 상대 경로 문자열은 어느 OS 에서든 `/` 구분이다.
    #[test]
    fn relative_paths_use_forward_slashes_on_every_os() {
        let rel = Path::new("src").join("lsp").join("main.rs");
        assert_eq!(rel_string(&rel), "src/lsp/main.rs");
    }

    /// Windows 경로 모양 — 순수 함수라 세 OS 러너 모두에서 돈다.
    #[test]
    fn windows_paths_become_standard_file_uris() {
        assert_eq!(windows_uri_path(r"C:\Users\kim\a.rs"), "/C:/Users/kim/a.rs");
        assert_eq!(windows_uri_path(r"\\?\C:\Users\kim"), "/C:/Users/kim");
        assert_eq!(windows_uri_path(r"\\srv\share\a.rs"), "//srv/share/a.rs");
        assert_eq!(
            windows_uri_path(r"\\?\UNC\srv\share\a.rs"),
            "//srv/share/a.rs"
        );
        // 되돌리기 — 서버가 소문자 드라이브·인코딩된 콜론으로 돌려줘도 같은 경로.
        assert_eq!(
            windows_path_of_uri("/C:/Users/kim/a.rs"),
            r"C:\Users\kim\a.rs"
        );
        assert_eq!(
            windows_path_of_uri(&percent_decode("/c%3A/Users/kim/a.rs")),
            r"C:\Users\kim\a.rs"
        );
        assert_eq!(windows_path_of_uri("srv/share/a.rs"), r"\\srv\share\a.rs");
        // 드라이브 없는 루트 경로는 그대로 (왕복 테스트의 유닉스 모양).
        assert_eq!(windows_path_of_uri("/tmp/a.rs"), "/tmp/a.rs");
    }

    /// 이 OS 의 실제 임시 폴더 경로가 URI 를 거쳐 같은 경로로 돌아온다 — Windows
    /// 러너에서는 `C:\…` 가, 다른 러너에서는 `/…` 가 지난다.
    #[test]
    fn a_real_temp_path_round_trips_on_this_os() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("한글 폴더").join("a b.rs");
        let uri = path_to_uri(&file);
        assert!(uri.starts_with("file:///"), "{uri}");
        assert!(!uri.contains('\\'), "구분자가 URI 에 새었다: {uri}");
        assert!(!uri.contains("%5C"), "구분자가 인코딩됐다: {uri}");
        if cfg!(windows) {
            assert!(
                uri.as_bytes()[9] == b':',
                "드라이브 콜론이 그대로여야 한다: {uri}"
            );
        }
        assert_eq!(uri_to_path(&uri).unwrap(), file);
    }

    #[test]
    fn uri_to_path_rejects_non_file_schemes() {
        assert!(uri_to_path("https://example.com/a.rs").is_none());
        assert!(uri_to_path("untitled:Untitled-1").is_none());
    }
}
