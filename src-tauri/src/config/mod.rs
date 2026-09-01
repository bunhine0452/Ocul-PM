//! 선언적 설정 — 설정을 **원하는 상태**로 적고 계획·적용한다
//! (Osaurus 라운드 Phase 6, `docs/20260831_osaurus-bench/05-config-plugins-import.md` §1).
//!
//! 세 진입점이 같은 두 모듈을 부른다:
//!
//! | 진입점 | 부르는 곳 |
//! |---|---|
//! | UI | `commands/declarative_config.rs` (승인 카드) |
//! | CLI | `main.rs` 의 `config` 서브커맨드 (same-exe, `--pty-host` 선례) |
//! | MCP | `oculpm/mcp/tools.rs` 의 `config_plan` / `config_apply` |
//!
//! 진입점이 하나라도 자기 로직을 갖는 순간 "CLI 로 본 계획" 과 "UI 가 적용한
//! 것" 이 갈라진다. 그래서 계획은 [`planner::plan`], 적용은
//! [`applier`] 하나뿐이고 진입점은 I/O 만 한다.

pub mod applier;
pub mod cli;
pub mod planner;
pub mod schema;
