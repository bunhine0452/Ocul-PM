//! 저가치 파일 판정 — 코드가 아니라 **데이터**인 파일 (2026-10-08 검토 `{#idx-low-value}`).
//!
//! 코드 색인 시절에 만든 판정이다 (설치본 실측: `.tsv` 2,415 · 평가 결과 `.json`
//! 200KB 한 편 등). 4.0 에서 색인을 걷은 뒤에는 diff 기준선 스냅샷이 같은 판정을
//! 쓴다 — 데이터 덩어리의 사본을 `file_snapshots` 에 쌓지 않게.
//!
//! 판정은 **경로 + 크기**만 본다.
//!
//! - 늘 데이터인 확장자: 표(`.csv`·`.tsv`) · 줄 단위 레코드(`.jsonl`·`.ndjson`) ·
//!   파일 목록(`.flist`) · 로그(`.log`).
//! - 크기로 가르는 확장자: `.json`·`.txt` 는 설정·안내문이기도 하다. 그래서
//!   [`DATA_FILE_MAX_BYTES`] 를 넘을 때만 데이터로 본다.
//! - 크기와 무관하게 지키는 이름: 매니페스트(`package.json` · `tsconfig*.json` ·
//!   `*.config.json` · `*rc.json` …)와 안내문(`README*` · `LICENSE*` · `CHANGELOG*` …),
//!   그리고 코드인 `CMakeLists.txt` · `requirements*.txt`.

use std::path::Path;

/// 크기로 가르는 확장자가 이보다 크면 데이터로 본다.
pub(crate) const DATA_FILE_MAX_BYTES: u64 = 8 * 1024;

/// 크기와 무관하게 데이터인 확장자 (소문자).
const DATA_EXTS: &[&str] = &["csv", "tsv", "jsonl", "ndjson", "flist", "log"];

/// 설정·안내문이기도 해서 크기로 가르는 확장자 (소문자).
const SIZE_GATED_EXTS: &[&str] = &["json", "txt"];

/// 크기로 가르는 확장자라도 지키는 이름 (소문자, 정확히 일치).
const KEEP_NAMES: &[&str] = &[
    "package.json",
    "composer.json",
    "jsconfig.json",
    "deno.json",
    "app.json",
    "manifest.json",
    "cmakelists.txt",
];

/// … 이 접두로 시작하는 이름 (`tsconfig.app.json` · `requirements-dev.txt` · `LICENSE.txt`).
const KEEP_PREFIXES: &[&str] = &[
    "tsconfig",
    "requirements",
    "readme",
    "license",
    "licence",
    "copying",
    "notice",
    "changelog",
];

/// … 이 접미로 끝나는 이름 (`vite.config.json` · `tauri.conf.json` · `.eslintrc.json`).
const KEEP_SUFFIXES: &[&str] = &[".config.json", ".conf.json", "rc.json"];

/// `size` 바이트짜리 `path` 가 코드가 아닌 데이터 파일인가.
pub(crate) fn is_data_file(path: &Path, size: u64) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    let Some((_, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if DATA_EXTS.contains(&ext) {
        return true;
    }
    SIZE_GATED_EXTS.contains(&ext) && size > DATA_FILE_MAX_BYTES && !is_kept_name(&name)
}

fn is_kept_name(name: &str) -> bool {
    KEEP_NAMES.contains(&name)
        || KEEP_PREFIXES.iter().any(|p| name.starts_with(p))
        || KEEP_SUFFIXES.iter().any(|s| name.ends_with(s))
}

/// 크기 관문 — 빈 파일 · 상한 초과 · 데이터 파일이면 false.
pub(crate) fn size_ok(path: &Path, size: u64, max_bytes: u64) -> bool {
    size > 0 && size <= max_bytes && !is_data_file(path, size)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIG: u64 = DATA_FILE_MAX_BYTES + 1;

    #[test]
    fn tabular_and_record_files_are_data_at_any_size() {
        for name in [
            "a.tsv",
            "b.CSV",
            "c.jsonl",
            "d.ndjson",
            "x/train.flist",
            "e.log",
        ] {
            assert!(is_data_file(Path::new(name), 10), "{name}");
        }
    }

    #[test]
    fn json_and_txt_are_data_only_when_large() {
        assert!(!is_data_file(Path::new("art/palette.json"), 2_000));
        assert!(is_data_file(Path::new("evals/results/run.json"), 200_000));
        assert!(is_data_file(Path::new("scripts/data/dict.txt"), BIG));
        assert!(!is_data_file(Path::new("notes.txt"), 3_000));
    }

    /// 매니페스트·안내문은 커도 지킨다.
    #[test]
    fn manifests_and_notices_survive_any_size() {
        for name in [
            "extension/package.json",
            "composer.json",
            "tsconfig.app.json",
            "vite.config.json",
            "src-tauri/tauri.conf.json",
            ".eslintrc.json",
            "README.txt",
            "LICENSE.txt",
            "CMakeLists.txt",
            "requirements-dev.txt",
        ] {
            assert!(!is_data_file(Path::new(name), 500_000), "{name}");
        }
    }

    #[test]
    fn code_and_extensionless_files_are_never_data() {
        for name in [
            "src/main.rs",
            "a.ts",
            "Makefile",
            "Cargo.toml",
            "x.yaml",
            "docs/a.md",
        ] {
            assert!(!is_data_file(Path::new(name), 400_000), "{name}");
        }
    }

    #[test]
    fn size_gate_folds_empty_oversized_and_data() {
        let max = super::super::MAX_FILE_BYTES;
        assert!(size_ok(Path::new("a.rs"), 10, max));
        assert!(!size_ok(Path::new("a.rs"), 0, max));
        assert!(!size_ok(Path::new("a.rs"), max + 1, max));
        assert!(!size_ok(Path::new("a.tsv"), 10, max));
    }
}
