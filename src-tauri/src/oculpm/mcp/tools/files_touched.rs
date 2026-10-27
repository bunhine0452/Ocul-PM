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

/// `files_touched` 를 안 준 일지에 git 이 아는 변경을 채운다 — 추정이다.
///
/// 실측 2026-10-27: 프로젝트마다 일지의 4~17% 가 파일 목록이 비어 있었다. diff 가
/// 붙을 수 없으니 「일지마다 그 시점의 변경 diff 가 붙는다」(약속 3)가 그 일지에서
/// 비었다. 작업 트리의 미커밋 변경(스테이지·미스테이지·추적 안 됨)을 읽어 채우고,
/// 응답 경고와 `files-inferred` 태그로 추정임을 밝힌다. 커밋 뒤에 쓰는 일지는
/// 비어 있을 수 있다 — 그때는 아무것도 지어내지 않는다.
///
/// 상한 [`INFER_CAP`] — 그 이상은 「프로젝트 전체」지 이 작업의 손자국이 아니다.
/// `.oculpm/` 아래와 프로젝트 밖(상위 저장소의 다른 폴더)은 뺀다.
pub(super) const INFER_CAP: usize = 40;

pub(super) fn infer_from_git(root: &Path, warnings: &mut Vec<String>) -> Vec<FileTouched> {
    let Ok(out) = crate::git::safe::output(&mut crate::git::safe::cmd(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )) else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    // 경로는 저장소 루트 기준으로 온다 — 프로젝트가 하위 폴더면 접두어를 떼고,
    // 그 밖은 버린다.
    let prefix = crate::git::safe::output(&mut crate::git::safe::cmd(
        root,
        &["rev-parse", "--show-prefix"],
    ))
    .ok()
    .filter(|o| o.status.success())
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .unwrap_or_default();

    let text = String::from_utf8_lossy(&out.stdout);
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let mut files = Vec::new();
    let mut total = 0usize;
    while let Some(rec) = fields.next() {
        if rec.len() < 4 {
            continue;
        }
        let (xy, path) = rec.split_at(3);
        let path = path.to_string();
        let x = xy.as_bytes()[0];
        let y = xy.as_bytes()[1];
        // 이름 바꾸기·복사는 원래 경로가 다음 필드로 따라온다.
        let rename_from = if x == b'R' || x == b'C' {
            fields.next().map(str::to_string)
        } else {
            None
        };
        let Some(rel) = path.strip_prefix(prefix.as_str()) else {
            continue;
        };
        if rel.is_empty() || rel.starts_with(".oculpm/") || rel.ends_with('/') {
            continue;
        }
        total += 1;
        if files.len() >= INFER_CAP {
            continue;
        }
        let op = match (x, y) {
            (b'?', _) | (b'A', _) => FileOp::Create,
            (b'D', _) | (_, b'D') => FileOp::Delete,
            (b'R', _) => FileOp::Rename,
            _ => FileOp::Update,
        };
        files.push(FileTouched {
            path: rel.to_string(),
            op,
            bytes_added: None,
            bytes_removed: None,
            rename_from: rename_from
                .as_deref()
                .and_then(|p| p.strip_prefix(prefix.as_str()))
                .map(str::to_string),
        });
    }
    if files.is_empty() {
        return files;
    }
    let more = total.saturating_sub(files.len());
    warnings.push(if more > 0 {
        format!(
            "files_touched 가 비어 있어 git 작업 트리의 변경 {}개로 채웠다 (추정 — {}개는 상한에 걸려 뺐다). 다음부터는 고친 파일을 직접 적을 것",
            files.len(),
            more
        )
    } else {
        format!(
            "files_touched 가 비어 있어 git 작업 트리의 변경 {}개로 채웠다 (추정, 태그 files-inferred). 다음부터는 고친 파일을 직접 적을 것",
            files.len()
        )
    });
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
