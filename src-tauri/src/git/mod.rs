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
//! | `status` | 저장소 머리글 — 브랜치·리모트·미커밋 개수 |
//! | `changes` | 변경 파일 목록 — 미커밋·직전 커밋 (변경 diff 화면의 행) |
//! | `diff` | 패치 생성·자르기 — 작업 트리·스냅샷·커밋 뒤 복원 |
//! | `blob` | `<rev>:<path>` 객체 접근 — 크기·바이트·HEAD 존재 여부 |
//! | `nesting` | 프로젝트 루트와 저장소 루트의 상하 관계·경로 되맞춤 |
//! | `path_form` | 경로의 저장 모양 — `/` 구분 상대 경로 · 윈도우 `\\?\` 접두 걷기 |
//! | `head` | `.git/HEAD` 를 파일로 읽기 — HEAD 커밋이 그대로면 HEAD 트리·직전 커밋을 다시 묻지 않는다 |
//! | `safe` | git 프로세스 생성 — 저장소 설정이 고른 명령(fsmonitor·훅·필터·외부 diff) 끄기 · 시간 제한 |

pub mod arrived; // 받아 온 것 — 받아 온 커밋이 더한 일지 · 리모트와 주고받은 때 (11-13)
pub mod authors; // 동료의 일지 — 그날 일지를 더한 커밋의 작성자 (11-02)
mod blob;
mod changes;
mod diff;
pub(crate) mod head; // HEAD 를 git 없이 읽는다 — 커밋 oid 를 열쇠로 한 캐시들 (11-11)
mod history;
pub mod local_only; // 이 기기에만 있는 것 — 커밋 안 한 변경 · 안 올린 커밋 (11-13)
pub mod nesting; // 루트 관계와 경로 되맞춤 ({#rebase-other-direction})
mod path_form;
pub mod race; // 같은 일을 worktree 여럿에서 (Orca 벤치마킹) — 레인 = `ocul-race/` 가지
pub mod receipt; // PR 영수증 — 가지의 변경을 일지와 대조 (11-02)
mod repo;
pub mod safe; // git 을 띄우는 유일한 창구 — 저장소 설정이 고른 명령을 끈다
mod status;

#[cfg(test)]
mod tests;
// 영수증 재료 사례표 — VS Code 확장과 같은 표 (`receipt_cases.json`).
#[cfg(test)]
mod receipt_cases_tests;
// git 을 몇 번 띄우는가 — 변경 화면 · 기준선 동기 · 일지 diff 캡처 (Windows 성능 라운드).
#[cfg(test)]
mod spawn_count_tests;

pub use blob::{blob_size, path_in_head, show_file_bytes};
pub use changes::{last_commit_changes, uncommitted_changes, GitChange, LastCommitChanges};
pub(crate) use diff::truncate_at_char_boundary;
pub use diff::{
    diff_at_nearest_commit, diff_patch, diff_patches, diffs_at_nearest_commits, render_unified_diff,
};
pub use history::{commits_for_backfill, log, BackfillCommit, BackfillFileChange, GitCommit};
pub use path_form::{plain, relative_to, slash, touched_path};
pub(crate) use repo::EMPTY_TREE;
pub use repo::{primary_repo, repo_root_for};
pub(crate) use repo::{unquote_git_path, QUOTEPATH_OFF};
pub use status::{remotes, status, GitRemote, GitRepoStatus};

// 하위 모듈이 나눠 쓰는 비공개 도우미 — 각 모듈은 `super::run_git` 처럼 닿는다.
use repo::{discover_repos, repo_relative, run_git};
