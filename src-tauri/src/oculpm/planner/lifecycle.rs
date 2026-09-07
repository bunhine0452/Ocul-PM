//! 플랜 생명주기 전이 — `active` ⇄ `done` / `archived` 의 **유일한 문지기**.
//!
//! `plan_edit.rs` 에서 `set_plan_status` 를 떼어 왔다. 이유는 둘이다: 저 파일이
//! 이미 파일 크기 래칫 위(859줄)라 한 줄도 못 늘리고, 여기 붙는 것이 순수한
//! 문자열 수술이 아니라 **판정**(문서를 파싱해 미완 항목을 세는 일)이라 저
//! 모듈의 "No I/O, no parse" 성격과도 다르기 때문이다.
//!
//! ## 왜 문지기가 필요한가
//!
//! 2026-09-07, `hardening-and-optimization` 플랜이 미완 항목 둘(`{#csp}`·
//! `{#entry-chunk}`)을 남긴 채 `status: done` 으로 닫혀 있는 것이 발견돼
//! 되돌렸다. 잠긴 플랜은 `plan_status` 가 통째로 건너뛰므로
//! (`mcp/tools/plan_ops.rs` — `frontmatter.status != "active"` 면 continue),
//! 그 두 항목은 어느 미완 목록에도 다시 나타나지 않는다. 조용히 사라진 것이다.
//! `v3-release` 의 `{#glyph-hygiene}` 는 이미 벌어진 것을 청소했을 뿐 재발을
//! 막지 못한다 — 청소는 사건이고 문지기는 성질이다.
//!
//! ## 전이가 일어나는 자리 (2026-09-07 전수)
//!
//! - `commands/plan.rs::plan_set_status` — 플래너 화면의 「완료·잠금」 토글
//! - `commands/plan.rs::plan_set_status_bulk` — 레일의 「묶어서 보관」
//! - `mobile_bridge/dispatch.rs` 의 `"plan_set_status"` — 폰이 같은 커맨드를
//!   부른다. 프런트만 막았다면 정확히 여기로 샜다.
//!
//! MCP·CLI 표면에는 플랜 **레벨** status 를 쓰는 도구가 아예 없다 —
//! `plan_update` 는 항목만 고치고, 잠긴 플랜은 해시 대조보다 먼저 거부한다.
//! 세 자리가 전부 이 함수를 지나고, 반환 타입이 `Result` 라 **새 호출자도
//! 거부를 처리하지 않고는 컴파일되지 않는다**. 남는 우회로는 프론트매터를
//! 에디터로 손수 고치는 것 하나인데, 그건 코드가 막을 수 있는 자리가 아니다.
//!
//! ## `archived` 는 왜 막지 않는가 (판단)
//!
//! 이 저장소에서 두 낱말은 서로 다른 주장을 한다. `done` 은 **끝냈다**는 완료
//! 선언이고, `archived` 는 **더는 안 본다**는 선반이다. `{#glyph-hygiene}` 가
//! `skill-catalog-round-2` 를 두고 "archived 여야" 라고 적은 것이 바로 그
//! 용법이다 — 미완 8건을 남긴 채 접은 라운드라 done 이 아니라 archived 다.
//! 실측으로도 지금 이 저장소의 archived 플랜 16개가 미완 항목을 갖고 있고,
//! 그 미완은 대부분 `v3-release` 로 이월돼 살아 있다.
//!
//! archived 까지 함께 막으면 「못 끝냈다」를 정직하게 적을 자리가 사라지고,
//! 남는 길은 done 으로 거짓말하거나 강제 플래그를 만드는 것뿐이다. 그래서
//! **archived 를 done 의 셋째 탈출구로 둔다** — 거부 메시지가 그 길을 말한다.
//!
//! 대가는 적어 둔다: archived 도 잠긴 상태라 `plan_status` 에서 빠지므로,
//! 접힌 미완 항목이 미완 목록에 다시 뜨지는 않는다. 그것을 보이게 하는 일
//! (살아 있는 플랜으로의 이월)은 여전히 사람의 규율이다.
//!
//! ## 강제 옵션은 두지 않았다
//!
//! `plan_ops.rs` 가 CAS 의 `base_hash` 를 필수로 만들며 적은 이유가 그대로
//! 적용된다: 우회 플래그가 있으면 계약이 둘이 되고, 마찰을 만나는 쪽은 언제나
//! 둘째 계약을 고른다. 게다가 여기서는 정상 경로가 이미 싸다 — 글리프 한 자를
//! `-`(dropped)나 `>`(deferred)로 바꾸면 닫힌다. 그 한 자가 곧 "이건 안 한다"는
//! 기록이고, 강제 플래그는 정확히 그 기록을 지우는 장치다.

use crate::app_error::AppError;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus, ParsedPlan};

/// 닫기를 막는 미완 항목 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenItem {
    pub item_id: String,
    pub title: String,
    pub status: ItemStatus,
}

/// 「미완」의 정의 — `[ ]` todo · `[~]` in_progress · `[!]` blocked.
///
/// `[x]` done 은 물론이고 `[-]` dropped·`[>]` deferred 도 **정리된 것**으로
/// 본다. 그 둘이 빠져나갈 문이다: 안 할 일은 dropped, 나중 할 일은 deferred 로
/// 적으면 플랜이 닫힌다. blocked 를 미완 쪽에 두는 이유는, `[!]` 가 "막혔다"는
/// 현재 상태지 "안 한다"는 결정이 아니기 때문이다 — 막힌 채로 접으려면 결정을
/// 한 번 내려 deferred 로 바꾸면 된다.
fn is_open(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Todo | ItemStatus::InProgress | ItemStatus::Blocked
    )
}

/// 플랜을 `done` 으로 닫지 못하게 붙잡는 항목들 — **리프만** 센다.
///
/// 부모 항목의 글리프는 하위의 롤업 파생값이라(`parse::rollup_status`) 부모까지
/// 세면 같은 사실을 두 번 말한다. `plan_status` 의 done/total 카운트와 진척
/// 바가 리프 기준인 것과 같은 이유다.
pub fn open_items_blocking_done(md: &str) -> Vec<OpenItem> {
    open_leaves(&parse_plan(md, PLAN_ID_FALLBACK))
}

fn open_leaves(parsed: &ParsedPlan) -> Vec<OpenItem> {
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

/// 거부 — **어느 항목 때문인지**를 들고 다닌다.
///
/// 문지기가 조용하면 사용자는 버튼이 고장 났다고 읽는다. 이 값이 [`AppError`]
/// 로 바뀌어 커맨드 경계를 넘고, 프런트는 `code` 를 i18n 키로 쓰거나(사전에
/// 없으면) `detail` 원문을 그대로 보여 준다 (`src/i18n/errors.ts::tError`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanCloseRefusal {
    pub plan_id: String,
    pub open: Vec<OpenItem>,
}

/// 프론트매터에 `id:` 가 없는 문서를 위한 이름. 오류 문장에만 쓰인다.
const PLAN_ID_FALLBACK: &str = "?";
/// 오류 문장에 이름을 싣는 항목 수 상한 — 나머지는 개수로만 말한다.
const MAX_LISTED: usize = 8;
/// 제목을 자르는 길이 (문자 기준 — 한글이 반 토막 나지 않게).
const MAX_TITLE_CHARS: usize = 48;

impl PlanCloseRefusal {
    /// 사람이 읽는 영어 원문 (`AppError.detail` 규약). **다음 행동까지** 말한다.
    fn detail(&self) -> String {
        let listed: Vec<String> = self
            .open
            .iter()
            .take(MAX_LISTED)
            .map(|i| format!("#{} ({}) {}", i.item_id, i.status.as_str(), clip(&i.title)))
            .collect();
        let rest = self.open.len().saturating_sub(listed.len());
        let more = if rest > 0 {
            format!(", and {rest} more")
        } else {
            String::new()
        };
        format!(
            "Plan '{}' still has {} unfinished item(s), so it cannot be marked done: {}{}. \
             Finish them, or mark each one dropped ([-]) / deferred ([>]) to say you are not \
             doing it, or file the plan as archived instead of done.",
            self.plan_id,
            self.open.len(),
            listed.join("; "),
            more,
        )
    }
}

fn clip(title: &str) -> String {
    let mut out: String = title.chars().take(MAX_TITLE_CHARS).collect();
    if out.chars().count() < title.chars().count() {
        out.push('…');
    }
    out
}

impl From<PlanCloseRefusal> for AppError {
    fn from(r: PlanCloseRefusal) -> Self {
        AppError::new("plan_has_open_items", r.detail())
    }
}

/// 플랜 레벨 `status:` 를 바꾼다 (그리고 `updated:` 를 올린다).
///
/// **`done` 으로 가는 전이만 검사한다** — 모듈 문서의 판단 참고. `active`(잠금
/// 해제)와 `archived`(선반)는 언제나 통과한다. 프론트매터가 없는 문서는 예전과
/// 같이 그대로 돌려준다 (수술할 자리가 없다).
pub fn set_plan_status(md: &str, status: &str, date: &str) -> Result<String, PlanCloseRefusal> {
    if status == "done" {
        let parsed = parse_plan(md, PLAN_ID_FALLBACK);
        let open = open_leaves(&parsed);
        if !open.is_empty() {
            return Err(PlanCloseRefusal {
                plan_id: parsed.frontmatter.id.clone(),
                open,
            });
        }
    }
    Ok(write_status_line(md, status, date))
}

/// 프론트매터 `status:` 한 줄을 갈아 끼우는 순수 수술 (옛 `plan_edit` 구현
/// 그대로). `status:` 줄이 없으면 `title:` 다음에 끼운다. 프론트매터 울타리가
/// 없는 문서는 손대지 않는다.
///
/// 문지기를 우회할 수 없도록 **비공개**다 — 밖에서 쓸 수 있는 것은
/// [`set_plan_status`] 뿐이다.
fn write_status_line(md: &str, status: &str, date: &str) -> String {
    let mut lines: Vec<String> = md.split('\n').map(String::from).collect();
    let start = match lines.iter().position(|l| l.trim() == "---") {
        Some(s) => s,
        None => return md.to_string(),
    };
    let end = match lines[start + 1..].iter().position(|l| l.trim() == "---") {
        Some(e) => start + 1 + e,
        None => return md.to_string(),
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
    use crate::oculpm::planner::parse::PlanStatus;

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

    /// **미완이 남으면 done 으로 못 닫는다 — 그리고 어느 항목 때문인지 말한다.**
    ///
    /// 이 라운드에 실제로 난 사고(`hardening-and-optimization`)의 회귀 자리다.
    #[test]
    fn done_is_refused_while_items_are_open_and_the_error_names_them() {
        let md = plan(&[("x", "csp"), (" ", "entry-chunk"), ("~", "wip")]);
        let refusal = set_plan_status(&md, "done", "2026-09-07")
            .expect_err("미완 둘을 남기고 닫혔다 — 문지기가 없다");

        assert_eq!(refusal.plan_id, "p");
        let ids: Vec<&str> = refusal.open.iter().map(|i| i.item_id.as_str()).collect();
        assert_eq!(ids, vec!["entry-chunk", "wip"], "완료 항목까지 잡았다");

        // 조용한 거부가 아니다 — 오류가 항목 id 와 다음 행동을 모두 말한다.
        let err = AppError::from(refusal);
        assert_eq!(err.code, "plan_has_open_items");
        let detail = err.detail.unwrap();
        assert!(detail.contains("#entry-chunk (todo)"), "{detail}");
        assert!(detail.contains("#wip (in_progress)"), "{detail}");
        assert!(
            !detail.contains("#csp"),
            "완료 항목이 이유로 실렸다: {detail}"
        );
        assert!(
            detail.contains("dropped") && detail.contains("deferred"),
            "{detail}"
        );
        assert!(
            detail.contains("archived"),
            "셋째 탈출구를 안 알려줬다: {detail}"
        );
    }

    /// `[!]` blocked 도 미완이다 — "막혔다"는 현재 상태지 결정이 아니다.
    #[test]
    fn blocked_still_blocks_the_close() {
        let md = plan(&[("x", "a"), ("!", "b")]);
        let refusal = set_plan_status(&md, "done", "2026-09-07").unwrap_err();
        assert_eq!(refusal.open.len(), 1);
        assert_eq!(refusal.open[0].status, ItemStatus::Blocked);
    }

    /// **정상 경로**: 남은 것을 dropped/deferred 로 정리하면 닫힌다.
    #[test]
    fn tidying_the_leftovers_into_dropped_or_deferred_lets_the_plan_close() {
        let md = plan(&[("x", "a"), ("-", "b"), (">", "c")]);
        let out = set_plan_status(&md, "done", "2026-09-07").expect("정리했는데도 거부됐다");
        let p = parse_plan(&out, "p");
        assert_eq!(p.frontmatter.status, PlanStatus::Done);
        assert_eq!(p.frontmatter.updated.as_deref(), Some("2026-09-07"));
    }

    /// 부모 항목은 이유로 실리지 않는다 — 글리프가 하위의 파생값이라 같은
    /// 사실을 두 번 말하게 된다.
    #[test]
    fn a_parent_item_is_not_its_own_reason() {
        let md = "---\nid: p\ntitle: \"t\"\nstatus: active\n---\n\
                  ## Phase {#ph}\n- [~] 부모 {#mom}\n  - [ ] 아이 {#kid}\n";
        let open = open_items_blocking_done(md);
        assert_eq!(
            open.iter().map(|i| i.item_id.as_str()).collect::<Vec<_>>(),
            vec!["kid"]
        );
    }

    /// `archived` 와 `active` 는 언제나 통과한다 (모듈 문서의 판단).
    #[test]
    fn archiving_and_unlocking_are_never_refused() {
        let md = plan(&[(" ", "a"), ("~", "b")]);
        let archived = set_plan_status(&md, "archived", "2026-09-07").expect("보관이 거부됐다");
        assert_eq!(
            parse_plan(&archived, "p").frontmatter.status,
            PlanStatus::Archived
        );
        // 잘못 닫힌 플랜을 되돌리는 길은 절대 막히면 안 된다.
        let done = plan(&[("x", "a")]);
        let locked = set_plan_status(&done, "done", "2026-09-07").unwrap();
        let active = set_plan_status(&locked, "active", "2026-09-08").unwrap();
        assert_eq!(
            parse_plan(&active, "p").frontmatter.status,
            PlanStatus::Active
        );
    }

    /// 항목이 하나도 없는 플랜은 닫을 수 있다 (막을 것이 없다).
    #[test]
    fn an_empty_plan_closes() {
        let md = "---\noculpm_plan: v1\nid: p\ntitle: \"빈 계획\"\nstatus: active\n---\n";
        assert!(set_plan_status(md, "done", "2026-09-07").is_ok());
    }

    /// `status:` 줄이 없으면 끼워 넣고, 본문은 그대로 둔다 (옛 계약 유지).
    #[test]
    fn the_status_line_is_inserted_when_missing_and_the_body_survives() {
        let md = "---\nid: p\ntitle: \"t\"\n---\n## A\n- [x] x {#x}\n";
        let out = set_plan_status(md, "done", "2026-09-07").unwrap();
        let p = parse_plan(&out, "p");
        assert_eq!(p.frontmatter.status.as_str(), "done");
        assert!(out.contains("- [x] x {#x}"));
    }

    /// 오류 문장이 무한히 길어지지 않는다 — 나머지는 개수로만 말한다.
    #[test]
    fn the_reason_list_is_capped_but_the_count_is_honest() {
        let items: Vec<(&str, String)> = (0..12).map(|i| (" ", format!("it-{i}"))).collect();
        let refs: Vec<(&str, &str)> = items.iter().map(|(g, id)| (*g, id.as_str())).collect();
        let refusal = set_plan_status(&plan(&refs), "done", "2026-09-07").unwrap_err();
        assert_eq!(refusal.open.len(), 12, "판정은 전부 본다");
        let detail = AppError::from(refusal).detail.unwrap();
        assert!(detail.contains("12 unfinished"), "{detail}");
        assert!(detail.contains("and 4 more"), "{detail}");
    }

    /// 긴 제목은 문자 경계에서 잘린다 (한글이 반 토막 나면 패닉이다).
    #[test]
    fn a_long_korean_title_is_clipped_on_a_char_boundary() {
        let long = "가".repeat(200);
        assert_eq!(clip(&long).chars().count(), MAX_TITLE_CHARS + 1);
        assert_eq!(clip("짧다"), "짧다");
    }
}
