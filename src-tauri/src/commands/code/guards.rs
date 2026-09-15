//! 경로 가드 — `secure_join` 의 어휘적 검사 뒤에 서는 두 번째 방어선.
//!
//! 읽기·저장은 [`canonical_within_root`](심링크를 끝까지 풀어 루트 안인지),
//! 생성·이름 바꾸기·삭제는 [`resolve_for_mutation`](링크 자체를 다루고 아직
//! 없는 경로도 받는다)을 지난다. 모든 창구가 같은 가드를 쓰도록 한곳에 둔다.

use std::path::{Path, PathBuf};

/// [`secure_join`](crate::commands::project::secure_join) 은 어휘적 검사만 한다 — 경로에 심링크가 끼어 있으면 루트
/// 밖 파일이 열린다 (예: 프로젝트 안 `leak → ~/.ssh/id_rsa`. 트리 걸음은
/// 심링크를 안 따라가지만 `rel_path` 는 임의의 IPC 인자다). 실존 경로로
/// 해석해 루트 안인지 다시 확인하고, 해석된 경로를 돌려준다 — 루트 안을
/// 가리키는 심링크는 그 대상으로 저장되므로 링크 자체도 깨지지 않는다.
pub(crate) fn canonical_within_root(root: &Path, full: &Path) -> Result<PathBuf, String> {
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let canon = std::fs::canonicalize(full).map_err(|e| format!("Failed to read file: {e}"))?;
    if canon.starts_with(&canon_root) {
        Ok(canon)
    } else {
        Err("Path escapes the project root".to_string())
    }
}

/// 조작 대상 상대 경로 정리 — 앞뒤 공백·중복 슬래시·양끝 슬래시를 없애고
/// 사람이 실수로 넣기 쉬운 것들을 여기서 잘라 낸다.
///
/// [`secure_join`](crate::commands::project::secure_join) 의 어휘적 검사는 `..` 탈출만 본다. 그 앞에서 **빈 경로**(=
/// 프로젝트 루트 자신)와 구간 하나짜리 `.` / `..` 을 막아, 루트를 지우거나
/// 이름을 바꾸는 요청이 애초에 만들어지지 않게 한다.
pub(crate) fn normalize_rel(rel: &str) -> Result<String, String> {
    let normalized = rel.replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .map(str::trim)
        .filter(|seg| !seg.is_empty())
        .collect();
    if segments.is_empty() {
        return Err("Path is empty".to_string());
    }
    if segments.iter().any(|seg| *seg == "." || *seg == "..") {
        return Err("Path may not contain . or ..".to_string());
    }
    Ok(segments.join("/"))
}

/// 조작(생성·이름 바꾸기·삭제) 대상 경로의 심링크 가드.
///
/// [`canonical_within_root`] 와 두 가지가 다르다.
///
/// 1. **마지막 구간을 풀지 않는다.** 전체를 canonical 로 풀면 대상이 심링크일 때
///    링크가 아니라 *그 대상*을 가리킨다. 읽기·저장에서는 그게 옳지만(링크를 따라
///    실제 파일을 편집), 삭제·이름 바꾸기에서는 링크 자체를 다뤄야 한다 — 안 그러면
///    "루트 안의 링크를 지운다" 가 "루트 밖의 원본을 지운다" 가 된다.
/// 2. **아직 없는 경로도 받는다.** 생성은 정의상 없는 경로를 대상으로 한다.
///    실존하는 가장 깊은 조상까지만 풀어 루트 안인지 보고, 아직 없는 나머지 구간을
///    이어 붙인다 — 없는 구간은 심링크일 수 없으므로 같은 보장이 유지된다.
///
/// 존재 판정은 `symlink_metadata` 로 한다. `exists()` 는 링크를 따라가므로 **깨진
/// 심링크**를 "없음" 으로 보고, 그 자리에 파일을 만들면 커널이 링크를 따라가 루트
/// 밖에 쓴다.
pub(super) fn resolve_for_mutation(root: &Path, full: &Path) -> Result<PathBuf, String> {
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let file_name = full
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_os_string();
    let parent = full
        .parent()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_path_buf();

    // 실존하는 가장 깊은 조상까지 내려가며, 지나온 (아직 없는) 구간을 모은다.
    let mut existing = parent;
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while existing.symlink_metadata().is_err() {
        let name = existing
            .file_name()
            .ok_or_else(|| "Path escapes the project root".to_string())?
            .to_os_string();
        missing.push(name);
        existing = existing
            .parent()
            .ok_or_else(|| "Path escapes the project root".to_string())?
            .to_path_buf();
    }

    let canon =
        std::fs::canonicalize(&existing).map_err(|e| format!("Failed to resolve path: {e}"))?;
    if !canon.starts_with(&canon_root) {
        return Err("Path escapes the project root".to_string());
    }
    let mut out = canon;
    for seg in missing.iter().rev() {
        out.push(seg);
    }
    out.push(file_name);
    Ok(out)
}
