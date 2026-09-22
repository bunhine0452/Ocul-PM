//! 코드 화면 백엔드 — 프로젝트 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md).
//!
//! SSOT 는 디스크다 — 캐시를 두지 않는다. 모든 경로는
//! project.rs 의 [`secure_join`](crate::commands::project::secure_join) 을 거쳐 프로젝트 루트 밖으로 못 나간다.
//!
//! 쓰기는 낙관적 잠금이다: 프런트가 읽을 때 받은 blake3 해시를 저장 시 되돌려
//! 보내고, 디스크가 그 사이 바뀌었으면 덮어쓰지 않고 `Conflict` 를 돌려준다
//! (에이전트가 활발히 파일을 고치는 앱 특성상 이 창구가 반드시 필요하다).
//! 저장 자체는 같은 디렉터리 임시 파일 + rename 으로 원자적이다.
//!
//! 책임별로 갈라 두었다 — `tree`(트리·디렉터리 한 단계) · `read_write`(본문·
//! 자산·낙관적 잠금 저장) · `import`(바깥에서 안으로 복사) · `mutate`(생성·
//! 이름 바꾸기·휴지통) · `compare`(HEAD·일지 원본) · `search`(전역 검색·치환)
//! · `guards`(경로 가드). 공개 경로는 여기서 다시 내보내 그대로다.

mod compare;
mod guards;
mod import;
mod mutate;
mod read_write;
mod search;
mod tree;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tree_tests;

use std::path::PathBuf;

use crate::db::Db;

// 갈라진 뒤에도 `crate::commands::code::{code_tree, CodeTree, …}` 가 그대로
// 풀리도록 전부 다시 내보낸다. 글롭은 각 항목을 **원래 가시성**으로 실어 —
// `pub` 커맨드·타입은 `pub`, `pub(crate)` 가드·저장은 `pub(crate)`,
// `pub(super)` 도우미는 이 모듈 안(테스트 포함)까지만.
pub use compare::*;
pub(crate) use guards::*;
pub use import::*;
pub use mutate::*;
pub use read_write::*;
pub use search::*;
pub use tree::*;

pub(crate) async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}
