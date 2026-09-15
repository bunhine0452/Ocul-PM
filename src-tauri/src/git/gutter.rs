//! 에디터 거터 — HEAD 블롭과 **저장 전 버퍼**를 줄 단위로 비교해 추가·수정·
//! 삭제 덩어리를 낸다. `git diff` 는 디스크를 보므로 쓰지 않고, HEAD 만 git 에서
//! 꺼내 `similar` 로 여기서 비교한다. 순수 함수 `diff_line_changes` 가 핵심이다.

use std::path::Path;

use super::{repo_root_for, show_file_bytes};

/// 거터 계산에 쓰는 HEAD 블롭 상한 — 에디터가 여는 파일 상한(2MB)과 같게.
const GUTTER_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 에디터 거터에 그릴 한 덩어리의 변경. 줄 번호는 **1-based, 현재 버퍼 기준**.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GitLineChange {
    /// 첫 줄 (포함).
    pub start_line: u32,
    /// 마지막 줄 (포함). `deleted` 는 start_line == end_line 이고, 그 줄
    /// **다음에** 무언가 지워졌다는 뜻이다 (지워진 줄은 화면에 없으므로).
    pub end_line: u32,
    pub kind: GitLineChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum GitLineChangeKind {
    Added,
    Modified,
    Deleted,
}

/// HEAD 의 그 파일과 **지금 버퍼**를 줄 단위로 비교한다 (에디터 거터).
///
/// `git diff` 를 쓰지 않는 이유: 그건 디스크를 보는데, 거터는 **저장하기 전에**
/// 무엇을 고쳤는지 보여야 쓸모가 있다. 그래서 HEAD 블롭만 git 에서 가져오고
/// 비교는 여기서 한다.
///
/// HEAD 에 없는 파일(새 파일)은 전부 `added` 다. 저장소 밖이면 빈 목록 —
/// 오류가 아니다(추적되지 않는 폴더를 열어도 편집기는 동작해야 한다).
pub fn line_changes(root: &Path, file_path: &str, current: &str) -> Vec<GitLineChange> {
    if repo_root_for(&root.join(file_path)).is_none() {
        return Vec::new();
    }
    // `show_file_bytes` 가 중첩 저장소 해석까지 안에서 한다 — 여기서 미리 풀면
    // 그 계약과 어긋난다. 상한은 에디터가 여는 파일 상한과 같게 둔다.
    let head = match show_file_bytes(root, file_path, "HEAD", GUTTER_MAX_BYTES) {
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            // 바이너리였다 — 거터로 말할 것이 없다.
            Err(_) => return Vec::new(),
        },
        // HEAD 에 없다 = 새 파일. 전부 추가로 표시한다.
        None => {
            return vec![GitLineChange {
                start_line: 1,
                end_line: current.lines().count().max(1) as u32,
                kind: GitLineChangeKind::Added,
            }]
        }
    };
    diff_line_changes(&head, current)
}

/// 두 텍스트의 줄 차이 → 거터 덩어리. IO 가 없어 순수 함수로 테스트한다.
///
/// `similar` 의 그룹(연속 변경 묶음)을 그대로 쓰지 않고 직접 접는 이유는
/// **삭제와 수정을 구별**해야 하기 때문이다: 지운 줄은 화면에 없으므로 그 자리를
/// 앞 줄에 붙은 표식 하나로 알려야 하고, 지움+삽입이 붙어 있으면 그건 수정이다.
pub fn diff_line_changes(before: &str, after: &str) -> Vec<GitLineChange> {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(before, after);
    // (새 파일 줄번호, 태그) 를 순서대로 훑으며 연속 구간을 접는다.
    let mut out: Vec<GitLineChange> = Vec::new();
    // 마지막으로 본 새-파일 줄 (1-based). 삭제 표식을 붙일 자리.
    let mut last_new_line: u32 = 0;
    // 지금 쌓는 중인 삽입 구간.
    let mut run: Option<(u32, u32)> = None;
    // 이 삽입 구간 직전에 삭제가 있었나 → 수정으로 본다.
    let mut run_after_delete = false;
    // 삽입이 뒤따르지 않은 채 끝난 삭제.
    let mut pending_delete = false;

    let flush = |out: &mut Vec<GitLineChange>, run: &mut Option<(u32, u32)>, modified: bool| {
        if let Some((start, end)) = run.take() {
            out.push(GitLineChange {
                start_line: start,
                end_line: end,
                kind: if modified {
                    GitLineChangeKind::Modified
                } else {
                    GitLineChangeKind::Added
                },
            });
        }
    };

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                flush(&mut out, &mut run, run_after_delete);
                run_after_delete = false;
                if pending_delete {
                    out.push(GitLineChange {
                        start_line: last_new_line.max(1),
                        end_line: last_new_line.max(1),
                        kind: GitLineChangeKind::Deleted,
                    });
                    pending_delete = false;
                }
                last_new_line = change
                    .new_index()
                    .map(|i| i as u32 + 1)
                    .unwrap_or(last_new_line);
            }
            ChangeTag::Delete => {
                // 삽입 구간이 열려 있는데 삭제가 오면 별개의 덩어리다.
                flush(&mut out, &mut run, run_after_delete);
                run_after_delete = false;
                pending_delete = true;
            }
            ChangeTag::Insert => {
                let line = change
                    .new_index()
                    .map(|i| i as u32 + 1)
                    .unwrap_or(last_new_line + 1);
                if pending_delete {
                    run_after_delete = true;
                    pending_delete = false;
                }
                run = Some(match run {
                    Some((start, _)) => (start, line),
                    None => (line, line),
                });
                last_new_line = line;
            }
        }
    }
    flush(&mut out, &mut run, run_after_delete);
    if pending_delete {
        out.push(GitLineChange {
            start_line: last_new_line.max(1),
            end_line: last_new_line.max(1),
            kind: GitLineChangeKind::Deleted,
        });
    }
    out
}
