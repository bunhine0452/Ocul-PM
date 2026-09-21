//! Lightweight wrappers around the local `git` CLI for read-only operations.
//! Operates on any local clone — does NOT require a GitHub token or network.
//!
//! 한 파일(`git.rs`, 1,580줄)이던 것을 **책임별**로 나눴다 (플랜
//! `optimization-round-2-2026-09-15` {#split-git-rs}). 공개 경로는 그대로다 —
//! `crate::git::diff_patch` 처럼 여기서 재수출하므로 호출부는 하위 모듈 이름을
//! 몰라도 된다. 하위 모듈끼리 나눠 쓰는 비공개 도우미(`run_git` 등)도 여기서
//! 한 번 들여와 `super::` 로 닿는다 (`nesting.rs` 가 이미 그렇게 쓰고 있었다).
//!
//! | 모듈 | 소유 |
//! |---|---|
//! | `repo` | 저장소 해석(`primary_repo`·`repo_root_for`)과 git 프로세스 실행 |
//! | `history` | 커밋 목록 — Today 로그·커밋 그래프·git 이력 백필 |
//! | `changelog` | 체인지로그 재료 — 태그·태그 사이 커밋·CHANGELOG 파일 |
//! | `status` | 저장소 머리글 — 브랜치·리모트·미커밋 개수 |
//! | `changes` | 변경 파일 목록 — 미커밋·직전 커밋 (변경 diff 화면의 행) |
//! | `diff` | 패치 생성·자르기 — 작업 트리·스냅샷·커밋 뒤 복원 |
//! | `blob` | `<rev>:<path>` 객체 접근 — 크기·바이트·HEAD 존재 여부 |
//! | `gutter` | 에디터 거터 — HEAD 블롭 대 현재 버퍼의 줄 변경 |
//! | `nesting` | 프로젝트 루트와 저장소 루트의 상하 관계·경로 되맞춤 |

mod blob;
mod changelog;
mod changes;
mod diff;
mod gutter;
mod history;
pub mod nesting; // 루트 관계와 경로 되맞춤 ({#rebase-other-direction})
mod repo;
mod status;

#[cfg(test)]
mod tests;

pub use blob::{blob_size, path_in_head, show_file_bytes};
pub use changelog::{
    latest_version_tag, log_range, log_range_with_files, read_changelog, tags, ChangelogFile,
    GitTag, RangeCommit,
};
pub use changes::{last_commit_changes, uncommitted_changes, GitChange, LastCommitChanges};
pub(crate) use diff::truncate_at_char_boundary;
pub use diff::{diff_at_nearest_commit, diff_patch, diff_patches, render_unified_diff};
pub use gutter::{diff_line_changes, line_changes, GitLineChange, GitLineChangeKind};
pub use history::{
    commits_for_backfill, graph, log, BackfillCommit, BackfillFileChange, GitCommit, GitGraphCommit,
};
pub(crate) use repo::EMPTY_TREE;
pub use repo::{primary_repo, repo_root_for};
pub(crate) use repo::{unquote_git_path, QUOTEPATH_OFF};
pub use status::{
    head_status_brief, remotes, status, GitHeadStatusBrief, GitRemote, GitRepoStatus,
};

// 하위 모듈이 나눠 쓰는 비공개 도우미 — 각 모듈은 `super::run_git` 처럼 닿는다.
use repo::{discover_repos, repo_relative, run_git};
