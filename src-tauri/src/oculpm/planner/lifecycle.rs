//! 플랜의 「미완 리프」 — 어디까지가 아직 할 일인가의 단 하나의 정의.
//!
//! 같은 정의를 세 자리가 본다: MCP `plan_status` 가 잠긴 플랜의 미완을 셀 때
//! (`mcp/tools/plan_ops.rs`), 이어하기가 남은 일을 고를 때(`resume.rs`), 닫힌 계획의
//! 미완을 받은함에 올릴 때(`commands/plan_carry.rs`). 셋이 다른 정의를 보면 서로를
//! 반박한다.
//!
//! 예전에는 플래너 화면의 「완료 · 잠금」 토글을 지키는 문지기(`set_plan_status`)도
//! 여기 있었다. 4.0 에서 계획 화면 편집을 걷으며 부르는 곳이 사라져 2026-10-29 에
//! 함께 걷었다 — MCP 와 CLI 에는 처음부터 플랜 **레벨** status 를 쓰는 도구가 없다.

use crate::oculpm::planner::parse::{ItemStatus, ParsedPlan};

/// 아직 할 일인 리프 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenItem {
    pub item_id: String,
    pub title: String,
    pub status: ItemStatus,
}

/// 「미완」의 정의 — `[ ]` todo · `[~]` in_progress · `[!]` blocked.
///
/// `[x]` done 은 물론이고 `[-]` dropped · `[>]` deferred 도 **정리된 것**으로 본다.
/// 안 할 일은 dropped, 나중 할 일은 deferred 로 적는다. blocked 를 미완 쪽에 두는
/// 이유는, `[!]` 가 "막혔다"는 현재 상태지 "안 한다"는 결정이 아니기 때문이다.
fn is_open(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Todo | ItemStatus::InProgress | ItemStatus::Blocked
    )
}

/// 이미 파싱한 플랜에서 미완 **리프**만 ({#archived-open-items-visibility}).
///
/// 부모 항목의 글리프는 하위의 롤업 파생값이라(`parse::rollup_status`) 부모까지
/// 세면 같은 사실을 두 번 말한다. `plan_status` 의 done/total 카운트와 진척 바가
/// 리프 기준인 것과 같은 이유다.
pub fn open_leaves(parsed: &ParsedPlan) -> Vec<OpenItem> {
    let parents = parsed.parent_ids();
    parsed
        .items
        .iter()
        .filter(|i| !parents.contains(i.item_id.as_str()))
        .filter(|i| is_open(i.status))
        .map(|i| OpenItem {
            item_id: i.item_id.clone(),
            title: i.title.clone(),
            status: i.status,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::planner::parse::parse_plan;

    /// 항목 글리프 목록으로 플랜 문서 하나.
    fn plan(items: &[(&str, &str)]) -> String {
        let mut md = String::from(
            "---\noculpm_plan: v1\nid: p\ntitle: \"계획\"\nstatus: active\n\
             created: 2026-09-01\nupdated: 2026-09-01\nowner: claude-code\n---\n\n## Phase {#ph}\n",
        );
        for (glyph, id) in items {
            md.push_str(&format!("- [{glyph}] 항목 {id} {{#{id}}}\n"));
        }
        md
    }

    fn ids(md: &str) -> Vec<String> {
        open_leaves(&parse_plan(md, "p"))
            .into_iter()
            .map(|i| i.item_id)
            .collect()
    }

    /// todo · in_progress · blocked 는 미완, done · dropped · deferred 는 정리된 것.
    #[test]
    fn open_means_todo_in_progress_or_blocked() {
        let md = plan(&[
            ("x", "done"),
            (" ", "todo"),
            ("~", "wip"),
            ("!", "stuck"),
            ("-", "dropped"),
            (">", "later"),
        ]);
        assert_eq!(ids(&md), vec!["todo", "wip", "stuck"]);
    }

    /// 부모 항목은 세지 않는다 — 글리프가 하위의 파생값이라 같은 사실을 두 번 말하게 된다.
    #[test]
    fn a_parent_item_is_not_its_own_reason() {
        let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n\
                  ## Phase {#ph}\n- [~] 부모 {#mom}\n  - [ ] 아이 {#kid}\n";
        assert_eq!(ids(md), vec!["kid"]);
    }
}
