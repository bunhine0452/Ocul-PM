//! `journal_write` 의 `files_touched` 인자 → 저장 모양.
//!
//! 정규 모양은 `{ "path", "op" }` 지만 에이전트는 경로 문자열 배열도 준다.
//! 예전엔 `f.get("path")?` 가 문자열 원소에서 None 이 되어 **경고 없이** 빠졌다
//! — 이 저장소 실측(2026-09-04 ~ 10-04)으로 호출 250번 중 4번, 경로 59개가
//! `files_touched: []` 로 저장됐고 응답의 `warnings` 는 비어 있었다. 그래서 둘을
//! 한다: 문자열은 `update` 로 받고, 그래도 못 읽은 원소는 `warnings` 로 알린다.
//! 일지가 "말한 것" 과 diff 를 대조하는 앱이 그 말을 몰래 버리면 안 된다.

use std::path::Path;

use serde_json::Value;

use crate::oculpm::spec::{FileOp, FileTouched};

/// 저장 모양(`/` — #fs-files-touched-norm)으로 바꾼 목록. 못 읽은 원소가
/// 있으면 `warnings` 에 한 줄을 더한다.
pub(super) fn parse_files_touched(
    root: &Path,
    args: &Value,
    warnings: &mut Vec<String>,
) -> Vec<FileTouched> {
    let Some(raw) = args.get("files_touched").filter(|v| !v.is_null()) else {
        return Vec::new();
    };
    let Some(arr) = raw.as_array() else {
        warnings
            .push("files_touched 는 배열이어야 한다 — 이 일지의 파일 목록은 비었다".to_string());
        return Vec::new();
    };
    let mut skipped = 0usize;
    let mut files = Vec::with_capacity(arr.len());
    for item in arr {
        let (given, op) = match item {
            Value::String(path) => (Some(path.as_str()), None),
            _ => (
                item.get("path").and_then(Value::as_str),
                item.get("op").and_then(Value::as_str),
            ),
        };
        let path = given
            .map(|p| crate::git::touched_path(root, p))
            .unwrap_or_default();
        if path.is_empty() {
            skipped += 1;
            continue;
        }
        files.push(FileTouched {
            path,
            op: parse_file_op(op.unwrap_or("update")),
            bytes_added: None,
            bytes_removed: None,
            rename_from: None,
        });
    }
    if skipped > 0 {
        warnings.push(format!(
            "files_touched 원소 {skipped}개를 읽지 못해 뺐다 — 원소는 {{\"path\": \"…\", \"op\": \"update\"}} 또는 경로 문자열"
        ));
    }
    files
}

fn parse_file_op(s: &str) -> FileOp {
    match s {
        "create" => FileOp::Create,
        "delete" => FileOp::Delete,
        "rename" => FileOp::Rename,
        "correct" => FileOp::Correct,
        _ => FileOp::Update,
    }
}
