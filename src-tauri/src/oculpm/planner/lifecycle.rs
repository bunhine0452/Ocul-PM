//! 플랜의 「미완 리프」 — 어디까지가 아직 할 일인가의 단 하나의 정의.
//!
//! 같은 정의를 세 자리가 본다: MCP `plan_status` 가 잠긴 플랜의 미완을 셀 때
//! (`mcp/tools/plan_ops.rs`), 이어하기가 남은 일을 고를 때(`resume.rs`), 닫힌 계획의
//! 미완을 받은함에 올릴 때(`commands/plan_carry.rs`). 셋이 다른 정의를 보면 서로를
//! 반박한다.
//!
//! # 닫기 문지기 ([`close_plan`])
//!
//! 플래너 화면의 「완료 · 잠금」 토글을 지키던 문지기(`set_plan_status`)는 4.0 에서 계획 화면
//! 편집과 함께 걷혔다(2026-10-29). 그 뒤로 계획을 닫는 길이 앱에도 MCP 에도 없어서, 남은
//! 항목이 0 인 계획이 「진행 중」 으로 쌓였다 (2026-11-14 실측: 진행 12개 중 3개). 그래서
//! **좁게** 되살렸다 — `active → done` 과 그 되돌리기 둘뿐이고, `archived` 로 보내는 길과
//! 묶어서 닫기는 되살리지 않았다.
//!
//! 문지기의 이유는 그대로다: 2026-09-07 에 미완 둘을 남긴 채 `done` 으로 닫힌 계획이
//! 발견됐다. 잠긴 계획의 미완은 어느 미완 목록에도 다시 뜨지 않는다. 강제 옵션은 두지 않는다 —
//! 안 할 일은 `[-]`, 나중 할 일은 `[>]` 로 적으면 닫힌다. 그 한 글자가 곧 기록이다.

use crate::app_error::AppError;
use crate::oculpm::planner::eol;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus, ParsedPlan};

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

/// 닫기를 거부한 이유 — **어느 항목 때문인지**를 들고 다닌다. 문지기가 조용하면 사람은
/// 단추가 고장 났다고 읽는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanCloseRefusal {
    pub plan_id: String,
    pub open: Vec<OpenItem>,
}

/// 오류 문장에 이름을 싣는 항목 수 상한 — 나머지는 개수로만 말한다.
const MAX_LISTED: usize = 8;

impl From<PlanCloseRefusal> for AppError {
    fn from(r: PlanCloseRefusal) -> Self {
        let listed: Vec<String> = r
            .open
            .iter()
            .take(MAX_LISTED)
            .map(|i| format!("#{} ({})", i.item_id, i.status.as_str()))
            .collect();
        let rest = r.open.len().saturating_sub(listed.len());
        let more = if rest > 0 {
            format!(", and {rest} more")
        } else {
            String::new()
        };
        AppError::new(
            "plan_has_open_items",
            format!(
                "Plan '{}' still has {} unfinished item(s), so it cannot be closed: {}{}. \
                 Finish them, or mark each one dropped ([-]) / deferred ([>]).",
                r.plan_id,
                r.open.len(),
                listed.join("; "),
                more,
            ),
        )
    }
}

/// 계획을 닫는다 — frontmatter `status: done`, `updated:` 는 `date`. 미완 리프가 하나라도
/// 있으면 거부한다. frontmatter 가 없는 문서는 그대로 돌려준다 (수술할 자리가 없다).
pub fn close_plan(md: &str, date: &str) -> Result<String, PlanCloseRefusal> {
    let parsed = parse_plan(md, "?");
    let open = open_leaves(&parsed);
    if !open.is_empty() {
        return Err(PlanCloseRefusal {
            plan_id: parsed.frontmatter.id.clone(),
            open,
        });
    }
    // 윈도우 체크아웃(CRLF)은 CRLF 그대로 되돌려 쓴다 (#fs-crlf-parsers).
    Ok(eol::keeping(md, |md| write_status_line(md, "done", date)))
}

/// 닫기를 되돌린다 — `done` 인 계획만 `active` 로. 그 밖(`active` · `archived`)은 그대로.
pub fn reopen_plan(md: &str, date: &str) -> String {
    if parse_plan(md, "?").frontmatter.status.as_str() != "done" {
        return md.to_string();
    }
    eol::keeping(md, |md| write_status_line(md, "active", date))
}

/// frontmatter `status:` 한 줄을 갈아 끼우는 순수 수술. `status:` 줄이 없으면 `title:`
/// 다음에 끼운다. 문지기를 우회할 수 없게 비공개다.
fn write_status_line(md: &str, status: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let Some(start) = lines.iter().position(|l| l.trim() == "---") else {
        return md.to_string();
    };
    let Some(end) = lines[start + 1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|e| start + 1 + e)
    else {
        return md.to_string();
    };
    let mut status_set = false;
    for line in lines.iter_mut().take(end).skip(start + 1) {
        let t = line.trim_start();
        if t.starts_with("status:") {
            *line = format!("status: {status}");
            status_set = true;
        } else if t.starts_with("updated:") {
            *line = format!("updated: {date}");
        }
    }
    if !status_set {
        let at = ((start + 1)..end)
            .find(|&i| lines[i].trim_start().starts_with("title:"))
            .map(|i| i + 1)
            .unwrap_or(start + 1);
        lines.insert(at, format!("status: {status}"));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// 미완이 남으면 닫히지 않고, 어느 항목 때문인지 말한다 (2026-09-07 사고의 회귀 자리).
    #[test]
    fn closing_is_refused_while_items_are_open_and_names_them() {
        let md = plan(&[("x", "csp"), (" ", "entry-chunk"), ("!", "stuck")]);
        let refusal = close_plan(&md, "2026-11-14").expect_err("미완 둘을 남기고 닫혔다");
        assert_eq!(refusal.plan_id, "p");
        let ids: Vec<&str> = refusal.open.iter().map(|i| i.item_id.as_str()).collect();
        assert_eq!(ids, vec!["entry-chunk", "stuck"]);
        let err = AppError::from(refusal);
        assert_eq!(err.code, "plan_has_open_items");
    }

    /// 완료 · 폐기 · 이월만 남으면 닫힌다. 본문은 한 글자도 안 바뀐다.
    #[test]
    fn a_plan_with_nothing_open_closes_and_only_the_frontmatter_changes() {
        let md = plan(&[("x", "a"), ("-", "b"), (">", "c")]);
        let closed = close_plan(&md, "2026-11-14").unwrap();
        assert!(closed.contains("status: done\n"));
        assert!(closed.contains("updated: 2026-11-14\n"));
        assert_eq!(
            closed.split("---\n").nth(2),
            md.split("---\n").nth(2),
            "본문이 바뀌었다"
        );
        assert_eq!(parse_plan(&closed, "p").frontmatter.status.as_str(), "done");
    }

    /// 되돌리기는 닫은 것만 연다 — 보관한 계획(archived)은 그대로다.
    #[test]
    fn reopen_only_undoes_a_close() {
        let md = plan(&[("x", "a")]);
        let closed = close_plan(&md, "2026-11-14").unwrap();
        let reopened = reopen_plan(&closed, "2026-11-15");
        assert!(reopened.contains("status: active\n"));
        let archived = md.replace("status: active", "status: archived");
        assert_eq!(reopen_plan(&archived, "2026-11-15"), archived);
        assert_eq!(reopen_plan(&md, "2026-11-15"), md, "열린 계획을 건드렸다");
    }

    /// 윈도우 체크아웃(CRLF)은 CRLF 로 되돌려 쓴다.
    #[test]
    fn crlf_documents_stay_crlf() {
        let md = plan(&[("x", "a")]).replace('\n', "\r\n");
        let closed = close_plan(&md, "2026-11-14").unwrap();
        assert!(closed.contains("status: done\r\n"));
        assert!(!closed.replace("\r\n", "").contains('\n'));
    }
}
