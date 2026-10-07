//! 프로젝트 경로 가드 — 신뢰할 수 없는 상대 경로가 파일시스템에 닿기 전에 지나는
//! 관문 (보안 피드백 2차, 2026-10-07).
//!
//! 저장소는 남이 만든 것일 수 있고, 그 안의 심볼릭 링크도 그 사람이 심은 것이다.
//! 어휘 검사(`..`·절대경로 거부)만으로는 경로 **중간**의 링크를 보지 못한다 —
//! `docs -> ~/.config` 가 있으면 `docs/x` 는 글자로는 루트 안이지만, 읽기·저장·
//! 생성·삭제는 홈의 설정 폴더에 닿는다. v3.8.0 까지 편집기의 첫 관문이던
//! `commands::project::secure_join` 이 정확히 그랬다 (둘째 관문을 가진 창구만
//! 막혀 있었다). 그래서 여기 있는 함수는 전부 두 단계를 지난다:
//!
//! 1. **어휘** — `..` 탈출과 절대경로를 거부한다 (`Path::join` 은 절대경로를 받으면
//!    base 를 통째로 버린다).
//! 2. **링크** — 경로에서 실재하는 가장 깊은 곳을 링크까지 끝까지 풀어, 정규화한
//!    루트 안인지 본다. 아직 없는 꼬리는 링크일 수 없으므로 같은 보장이 유지된다.
//!    깨진 링크는 대상을 풀 수 없으니 안이라고 증명할 수 없다 — 거부한다.
//!
//! 마지막 구간을 어떻게 다루는지만 셋으로 갈린다. 호출자가 그 경로로 무엇을
//! 하느냐에 따라 고른다:
//!
//! | 함수 | 마지막 구간이 링크면 | 쓰는 자리 |
//! |---|---|---|
//! | [`secure_join`] | 그 대상까지 루트 안이어야 한다 | 읽기·저장·외부 편집기 — 링크를 따라가는 연산 |
//! | [`secure_join_entry`] | 따라가지 않는다 | 생성·이름 바꾸기·삭제 — 링크 **자체**를 다루는 연산 |
//! | [`secure_join_managed`] | 거부한다 | 앱이 읽고 합쳐 다시 쓰는 파일 (`.gitignore` 블록·규칙 어댑터·`.mcp.json`) |
//!
//! 셋째가 따로 있는 이유: 관리 블록을 넣는 쓰기는 **읽고 → 합치고 → 원자적으로
//! 바꾼다.** 링크를 따라 읽으면 링크 대상(예: `~/.aws/credentials`)의 내용이
//! 프로젝트 파일로 복사되고, 원자적 쓰기의 `rename` 은 링크를 일반 파일로 바꿔
//! 사용자의 링크 구성도 깬다. 안쪽을 가리키는 링크여도 손대지 않는 편이 맞다.
//!
//! 플러그인 설치기(`plugins::install`)는 더 엄격한 자기 판을 쓴다 — 번들이 놓는
//! 경로에는 안쪽을 가리키는 링크도 받지 않는다(따라갈 이유가 없다).

use std::path::{Path, PathBuf};

/// 어휘 탈출 (`..`·절대경로).
pub(crate) const TRAVERSAL: &str = "Access denied: path traversal detected";
/// 링크를 풀었더니 루트 밖이다. 코드 트리도 같은 문구를 쓴다 (`commands::code::guards`).
pub(crate) const ESCAPES_ROOT: &str = "Path escapes the project root";
/// [`secure_join_managed`] 가 링크를 만났다. 뒤에 상대 경로가 붙는다.
pub(crate) const LINK_REFUSED: &str = "Refusing to write through a symbolic link";

/// 마지막 구간을 다루는 방식.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Leaf {
    /// 링크면 대상까지 푼다.
    Follow,
    /// 부모까지만 푼다 — 링크 자체가 대상이다.
    Itself,
    /// 링크면 거부한다.
    RefuseLink,
}

/// 읽기·저장·외부 편집기로 열기처럼 **링크를 따라가는** 연산의 경로.
///
/// 돌려주는 것은 어휘 경로다 — 루트 안을 가리키는 링크는 그대로 따라가 쓴다
/// (코드 트리가 안쪽 링크 폴더를 펼치는 것과 같은 계약). 빈 `rel` 은 루트 자신이다.
pub(crate) fn secure_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    guard(root, rel, Leaf::Follow)
}

/// 생성·이름 바꾸기·삭제처럼 **링크 자체**를 다루는 연산의 경로.
///
/// 부모까지만 풀어 루트 안인지 본다. 마지막 구간이 밖을 가리키는 링크여도 그
/// 링크를 지우거나 옮기는 것은 밖을 건드리지 않는다 — 반대로 전체를 풀면
/// "루트 안의 링크를 지운다" 가 "루트 밖의 원본을 지운다" 가 된다.
pub(crate) fn secure_join_entry(root: &Path, rel: &str) -> Result<PathBuf, String> {
    guard(root, rel, Leaf::Itself)
}

/// 앱이 내용을 만들어 쓰는 프로젝트 파일의 경로 — 마지막 구간이 링크면 어디를
/// 가리키든 거부한다 (모듈 문서의 표 셋째 줄).
pub(crate) fn secure_join_managed(root: &Path, rel: &str) -> Result<PathBuf, String> {
    guard(root, rel, Leaf::RefuseLink)
}

fn guard(root: &Path, rel: &str, leaf: Leaf) -> Result<PathBuf, String> {
    let joined = lexical_join(root, rel)?;
    let is_link = joined
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink());
    if is_link && leaf == Leaf::RefuseLink {
        return Err(format!("{LINK_REFUSED}: {rel}"));
    }
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let start = match leaf {
        Leaf::Itself => joined.parent().unwrap_or(&joined),
        Leaf::Follow | Leaf::RefuseLink => &joined,
    };
    if resolves_inside(start, &canon_root) {
        Ok(joined)
    } else {
        Err(ESCAPES_ROOT.to_string())
    }
}

/// 어휘 검사 — 예전 `commands::project::secure_join` 의 판정 그대로다.
fn lexical_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let clean = crate::indexer::clean_path(&root.join(rel));
    if clean.starts_with(root) {
        Ok(clean)
    } else {
        Err(TRAVERSAL.to_string())
    }
}

/// `start` 에서 위로 올라가며 처음 만나는 실재 항목(깨진 링크 포함)을 끝까지 풀어
/// `canon_root` 안인지. 실재 판정은 `symlink_metadata` 다 — `exists()` 는 링크를
/// 따라가므로 깨진 링크를 "없음" 으로 보고 그 위를 판정해 버린다.
fn resolves_inside(start: &Path, canon_root: &Path) -> bool {
    let mut probe = start;
    loop {
        if probe.symlink_metadata().is_ok() {
            return std::fs::canonicalize(probe).is_ok_and(|real| real.starts_with(canon_root));
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_links;

    /// `<tmp>/proj` 와 그 옆의 `<tmp>/outside/secret.txt`.
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(root.join("real/a.txt"), "in").unwrap();
        std::fs::write(outside.join("secret.txt"), "out").unwrap();
        (tmp, root, outside)
    }

    #[test]
    fn lexical_escapes_are_refused_by_all_three() {
        let (_tmp, root, _) = fixture();
        for bad in ["../outside/secret.txt", "real/../../outside", "/etc/passwd"] {
            for f in [secure_join, secure_join_entry, secure_join_managed] {
                assert_eq!(f(&root, bad).unwrap_err(), TRAVERSAL, "{bad}");
            }
        }
        // 빈 경로는 루트 자신 — 트리의 첫 단계가 이렇게 부른다.
        assert_eq!(secure_join(&root, "").unwrap(), root);
    }

    /// 피드백이 짚은 모양 — 폴더 링크 `docs -> 밖`.
    #[test]
    fn a_folder_link_out_of_the_root_is_refused_below_it() {
        let (_tmp, root, outside) = fixture();
        if !test_links::dir(&outside, &root.join("docs")) {
            return;
        }
        for rel in ["docs/secret.txt", "docs/new.txt", "docs/new/deep.txt"] {
            assert_eq!(secure_join(&root, rel).unwrap_err(), ESCAPES_ROOT, "{rel}");
            assert_eq!(
                secure_join_entry(&root, rel).unwrap_err(),
                ESCAPES_ROOT,
                "{rel}"
            );
            assert_eq!(
                secure_join_managed(&root, rel).unwrap_err(),
                ESCAPES_ROOT,
                "{rel}"
            );
        }
        // 링크 자체: 따라가면 밖이고, 링크로 다루면 안이다 (지우기·옮기기는 링크만).
        assert_eq!(secure_join(&root, "docs").unwrap_err(), ESCAPES_ROOT);
        assert_eq!(secure_join_entry(&root, "docs").unwrap(), root.join("docs"));
        assert!(secure_join_managed(&root, "docs")
            .unwrap_err()
            .starts_with(LINK_REFUSED));
    }

    #[test]
    fn a_file_link_out_of_the_root_is_followed_only_by_entry() {
        let (_tmp, root, outside) = fixture();
        if !test_links::file(&outside.join("secret.txt"), &root.join("leak.txt")) {
            return;
        }
        assert_eq!(secure_join(&root, "leak.txt").unwrap_err(), ESCAPES_ROOT);
        assert!(secure_join_entry(&root, "leak.txt").is_ok());
        assert!(secure_join_managed(&root, "leak.txt")
            .unwrap_err()
            .starts_with(LINK_REFUSED));
    }

    /// 안쪽을 가리키는 링크는 따라가도 된다 — 관리 파일만 링크 자체를 거부한다.
    #[test]
    fn links_that_stay_inside_are_followed() {
        let (_tmp, root, _) = fixture();
        if !test_links::dir(&root.join("real"), &root.join("alias")) {
            return;
        }
        assert!(secure_join(&root, "alias/a.txt").is_ok());
        assert!(secure_join(&root, "alias/new.txt").is_ok());
        assert!(secure_join_entry(&root, "alias/a.txt").is_ok());
        assert!(secure_join_managed(&root, "alias/a.txt").is_ok());
        assert!(secure_join_managed(&root, "alias").is_err());
    }

    /// 깨진 링크는 대상을 풀 수 없다 — 그 자리에 쓰면 커널이 링크를 따라가
    /// 대상(밖일 수 있다)을 만든다.
    #[test]
    fn a_dangling_link_cannot_be_proven_inside() {
        let (_tmp, root, outside) = fixture();
        if !test_links::file(&outside.join("missing.txt"), &root.join("dangling")) {
            return;
        }
        assert_eq!(secure_join(&root, "dangling").unwrap_err(), ESCAPES_ROOT);
        assert_eq!(secure_join(&root, "dangling/x").unwrap_err(), ESCAPES_ROOT);
        assert!(secure_join_entry(&root, "dangling").is_ok());
    }

    #[test]
    fn missing_tails_under_a_real_folder_are_fine() {
        let (_tmp, root, _) = fixture();
        assert!(secure_join(&root, "real/new/deep.txt").is_ok());
        assert!(secure_join_entry(&root, "brand/new.txt").is_ok());
        assert!(secure_join_managed(&root, ".gitignore").is_ok());
    }

    /// 프로젝트 경로 자체가 링크 아래에 있어도 (macOS 의 `/tmp` 처럼) 안이다.
    #[test]
    fn a_root_reached_through_a_link_still_works() {
        let (tmp, root, _) = fixture();
        let via = tmp.path().join("via");
        if !test_links::dir(&root, &via) {
            return;
        }
        assert!(secure_join(&via, "real/a.txt").is_ok());
        assert!(secure_join_entry(&via, "real/new.txt").is_ok());
    }
}
