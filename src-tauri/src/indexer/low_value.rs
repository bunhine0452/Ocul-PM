//! 저가치 색인 판정 — 코드가 아니라 **데이터**인 파일 (2026-10-08 검토 `{#idx-low-value}`).
//!
//! 설치본 실측(청크 11.2만): `.tsv` 2,415 · 평가 결과 `.json`(200KB 한 편이 청크 450개)
//! · 사전 덤프 `.txt` 가 의미 검색과 AI 패널 근거 자리를 차지하고, 임베딩을 한 편에
//! 수백 번씩 불렀다. 사람이 검색해서 읽을 코드가 아니다.
//!
//! 판정은 **경로 + 크기**만 본다 — 걷기(`walk_text_files`) · 워처 증분
//! (`is_indexable_path`) · 기동 화해(`reconcile::stale_paths`, stat 만)가 같은 답을
//! 내야 하고, 화해는 디스크를 읽지 않는다.
//!
//! - 늘 데이터인 확장자: 표(`.csv`·`.tsv`) · 줄 단위 레코드(`.jsonl`·`.ndjson`) ·
//!   파일 목록(`.flist`) · 로그(`.log`). 손으로 쓰는 코드·설정이 이 모양일 일이 없다.
//! - 크기로 가르는 확장자: `.json`·`.txt` 는 설정·안내문이기도 하다. 그래서
//!   [`DATA_FILE_MAX_BYTES`] 를 넘을 때만 데이터로 본다. 근거: 이 저장소의 설정
//!   JSON 은 전부 4KB 아래(`tauri.conf.json` 2KB · `package.json` 3KB)이고, 실측 DB
//!   에서 8KB 를 넘는 `.json`·`.txt` 116편(청크 8,732)은 전부 데이터이거나 산출물
//!   (평가 결과 · 샘플 응답 · 맵 · 스프라이트 아틀라스 · 사전 덤프 · 빌드 캐시)이었다.
//!   4KB 로 낮추면 1,175 청크를 더 걷지만 4~8KB 설정 파일(플러그인 매니페스트
//!   등)도 함께 잃는다 — 빠진 파일을 되살리는 설정은 없으므로 보수적으로 둔다.
//! - 크기와 무관하게 지키는 이름: 매니페스트(`package.json` · `composer.json` ·
//!   `tsconfig*.json` · `*.config.json` · `*rc.json` …)와 안내문(`README*` ·
//!   `LICENSE*` · `CHANGELOG*` …), 그리고 코드인 `CMakeLists.txt` · `requirements*.txt`.

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

/// `size` 바이트짜리 `path` 가 코드가 아닌 데이터 파일인가 — 그러면 색인하지 않는다.
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

/// 걷기·워처 공용 크기 관문 — 빈 파일 · 상한 초과 · 데이터 파일이면 false.
pub(crate) fn size_ok(path: &Path, size: u64, config: &super::IndexConfig) -> bool {
    size > 0 && size <= config.max_file_bytes && !is_data_file(path, size)
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

    /// 매니페스트·안내문은 커도 지킨다 — 빠진 파일을 되살리는 설정은 없다.
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
        let cfg = super::super::IndexConfig::default();
        assert!(size_ok(Path::new("a.rs"), 10, &cfg));
        assert!(!size_ok(Path::new("a.rs"), 0, &cfg));
        assert!(!size_ok(Path::new("a.rs"), cfg.max_file_bytes + 1, &cfg));
        assert!(!size_ok(Path::new("a.tsv"), 10, &cfg));
    }

    /// 걷기와 워처 증분이 같은 답을 낸다 — 서드파티 사본(`vendor/`) · 빌드 캐시
    /// (`.dart_tool/`) · 데이터 파일은 둘 다 건너뛴다.
    #[test]
    fn walk_and_watcher_skip_vendor_caches_and_data() {
        use crate::indexer::{is_indexable_path, walk_text_files, IndexConfig};
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let skipped = [
            "vendor/github.com/x/y.go",
            "app/.dart_tool/package_config.json",
            "data/rows.tsv",
        ];
        for rel in ["src/a.go"].iter().chain(&skipped) {
            std::fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
            std::fs::write(root.join(rel), "package a\n").unwrap();
        }
        let cfg = IndexConfig::default();
        let walked: Vec<_> = walk_text_files(root, &cfg)
            .into_iter()
            .map(|p| crate::git::slash(p.strip_prefix(root).unwrap()))
            .collect();
        assert_eq!(walked, vec!["src/a.go"]);
        assert!(is_indexable_path(&root.join("src/a.go"), &cfg));
        for rel in skipped {
            assert!(!is_indexable_path(&root.join(rel), &cfg), "{rel}");
        }
    }
}
