//! 확인 게이트 — "이 대화가 계획의 항목을 닫고도 그 계획의 **확인 명령**을 돌린 기록을
//! 남기지 않았는가" (플랜 `agent-era-20261122` {#check-gate}).
//!
//! # 왜
//!
//! 배달 게이트([`super::judge`])는 「일지가 있는가」만 묻는다. 「됐다」 는 주장이 확인 명령의
//! 결과 끝 줄로 뒷받침됐는지는 여태 규칙 파일의 문장에만 걸려 있었다 (`AGENTS.md` §1
//! 「판정은 네가 아닌 것이」). 문장은 지켜지지 않을 수 있다 — 2026-07 의 실측(규칙 주입만으로는
//! 기록 준수 0/12)이 배달 게이트를 낳은 것과 같은 이유로, 판정에도 기계가 한 번 짚는 자리를 둔다.
//!
//! # 앱은 판정을 내리지 않는다
//!
//! 이 게이트는 확인 명령을 **돌리지도, 결과를 읽지도** 않는다. 「돌리고 그 끝 줄을 남겨라」 고
//! 대화당 한 번 말할 뿐이고, 못 돌리면 그 까닭을 적고 지나가면 된다 (`docs/PROMISE.md`
//! 「묻고 짚되 막지 않는다」 · CLAUDE.md 「don't let the app read check results into a verdict」).
//!
//! # 틀리는 방향
//!
//! 배달 게이트와 같다 — **덜 붙잡는** 쪽으로만 틀린다. 근거는 그 대화 자신의 트랜스크립트에
//! 적힌 `plan_update` 호출(1차 출처)이고, 다음은 전부 침묵이다:
//!
//! - 트랜스크립트가 없거나 못 읽었다 · MCP 도구 없이 파일을 손으로 고쳤다
//! - 그 계획에 확인 명령이 없다 · 계획이 진행 중(`active`)이 아니다 · 계획 파일을 못 찾았다
//! - 이 대화가 그 계획에 판정을 한 번이라도 남겼다 (닫기 전이든 뒤든)
//! - 이 대화가 시작한 뒤 **누구든** 그 계획에 판정을 남겼다 — 서브에이전트나 옆 대화가 확인
//!   명령을 돌려 적었으면 같은 일을 또 시키지 않는다

use std::path::Path;

use super::transcript::PlanUpdateCall;
use crate::oculpm::planner::judge;
use crate::oculpm::planner::parse::{parse_plan, PlanStatus};
use crate::oculpm::planner::{done_when, paths};

/// 판정 없이 닫힌 계획 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unjudged {
    pub plan_id: String,
    pub title: String,
    /// 계획의 확인 명령 (한 줄).
    pub check: String,
}

/// 이의 — 이 대화가 닫은 항목의 계획 가운데 판정이 없는 것들.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckObjection {
    pub plans: Vec<Unjudged>,
}

/// 이 대화가 항목을 닫았는데(`done`) 판정은 남기지 않은 계획 id — 처음 닫은 순서, 중복 없이.
///
/// 순수하다: 트랜스크립트에서 읽은 호출 목록만 본다.
pub fn closed_without_verdict(updates: &[PlanUpdateCall]) -> Vec<String> {
    let judged = |plan: &str| {
        updates
            .iter()
            .any(|u| u.plan_id == plan && u.note.as_deref().and_then(judge::parse_note).is_some())
    };
    let mut out: Vec<String> = Vec::new();
    for u in updates {
        if u.status == "done" && !out.contains(&u.plan_id) && !judged(&u.plan_id) {
            out.push(u.plan_id.clone());
        }
    }
    out
}

/// 디스크의 계획을 보고 이의를 정한다. `segment_started_at` 은 이 대화의 현재 세그먼트가
/// 시작한 시각(unix 초) — 그 뒤에 누가 남긴 판정이 있으면 그 계획은 뺀다.
pub fn objection(
    root: &Path,
    updates: &[PlanUpdateCall],
    segment_started_at: Option<i64>,
) -> Option<CheckObjection> {
    let plans: Vec<Unjudged> = closed_without_verdict(updates)
        .into_iter()
        .filter_map(|plan_id| unjudged_on_disk(root, &plan_id, segment_started_at))
        .collect();
    (!plans.is_empty()).then_some(CheckObjection { plans })
}

/// 계획 파일을 읽어, 지금도 판정이 빠져 있으면 그 계획.
fn unjudged_on_disk(root: &Path, plan_id: &str, since: Option<i64>) -> Option<Unjudged> {
    // 계획 id 는 파일 이름이 된다 — 경로를 벗어나는 글자가 든 것은 우리 것이 아니다.
    if plan_id.is_empty()
        || !plan_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        || plan_id.starts_with('.')
    {
        return None;
    }
    let dir = paths::planner_dir(root);
    // 파일 이름이 곧 id 인 것이 보통이다. 아닐 때만 폴더를 훑는다(계획 수십 개를 전부 파싱).
    let direct = dir.join(format!("{plan_id}.md"));
    let path = if direct.is_file() {
        direct
    } else {
        paths::find_plan_path(&dir, plan_id)?
    };
    let text = std::fs::read_to_string(path).ok()?;
    let plan = parse_plan(&text, plan_id);
    if plan.frontmatter.id != plan_id || plan.frontmatter.status != PlanStatus::Active {
        return None;
    }
    let check = done_when::check_command(&text)?;
    // 이 대화가 시작한 뒤의 판정은 누가 남겼든 이 일을 덮는다.
    if let (Some(since), Some(last)) = (since, judge::last_verdict(&plan.updates)) {
        if crate::clock::parse_rfc3339(&last.ts).is_some_and(|t| t.as_second() >= since) {
            return None;
        }
    }
    Some(Unjudged {
        plan_id: plan_id.to_string(),
        title: plan.frontmatter.title,
        check,
    })
}

impl CheckObjection {
    /// 게이트가 stderr 로 내보내는 전문 — 무엇을, 어떤 도구로, 못 하면 어떻게.
    pub fn message(&self) -> String {
        const SHOWN: usize = 3;
        let mut lines = vec![format!(
            "oculpm 확인 게이트: 이 대화에서 항목을 닫은 계획 {}개에 확인 명령을 돌린 기록(판정)이 없습니다.",
            self.plans.len()
        )];
        for p in self.plans.iter().take(SHOWN) {
            lines.push(format!(
                "  {} ({}) — 확인 명령: {}",
                p.title, p.plan_id, p.check
            ));
        }
        if self.plans.len() > SHOWN {
            lines.push(format!("  외 {}개", self.plans.len() - SHOWN));
        }
        lines.push(
            "- 확인 명령을 돌리고, 그 결과의 끝 줄을 plan_update 의 note 에 `판정 ✓ <끝 줄>` 또는 \
             `판정 ✗ <끝 줄>` 로 남기세요 (status 는 지금 값 그대로). 「됐다」 는 증거가 아닙니다."
                .to_string(),
        );
        lines.push(
            "- 지금 돌릴 수 없으면(오래 걸린다 · 환경이 없다) 그 까닭을 note 에 적고 계속하세요 \
             (이 게이트는 대화당 한 번만 뜹니다)."
                .to_string(),
        );
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(plan: &str, status: &str, note: Option<&str>) -> PlanUpdateCall {
        PlanUpdateCall {
            plan_id: plan.into(),
            status: status.into(),
            note: note.map(Into::into),
        }
    }

    fn plan_md(status: &str, check: Option<&str>, log_rows: &[&str]) -> String {
        let check = check
            .map(|c| format!("**확인 명령:** {c}\n"))
            .unwrap_or_default();
        format!(
            "---\noculpm_plan: v1\nid: round\ntitle: \"라운드\"\nstatus: {status}\ncreated: 2026-11-22\nupdated: 2026-11-22\nowner: claude-code\n---\n\n**완료 조건:** 초록\n{check}\n## 단계 {{#p}}\n- [x] 하나 {{#a}}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n{}\n<!-- oculpm:plan-log end -->\n",
            log_rows.join("\n")
        )
    }

    fn project(md: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let planner = dir.path().join(".oculpm/planner");
        std::fs::create_dir_all(&planner).unwrap();
        std::fs::write(planner.join("round.md"), md).unwrap();
        dir
    }

    #[test]
    fn closing_without_any_verdict_is_named_once_in_first_close_order() {
        let updates = [
            call("b", "in_progress", None),
            call("b", "done", Some("끝")),
            call("a", "done", None),
            call("b", "done", None),
        ];
        assert_eq!(closed_without_verdict(&updates), ["b", "a"]);
    }

    #[test]
    fn a_verdict_anywhere_in_the_conversation_clears_that_plan() {
        // 닫기 전에 남긴 판정도, 닫은 뒤에 남긴 판정도 — 실패 판정도 판정이다.
        let before = [
            call("a", "in_progress", Some("판정 ✗ 2 failed")),
            call("a", "done", None),
        ];
        assert!(closed_without_verdict(&before).is_empty());
        let after = [
            call("a", "done", None),
            call("a", "done", Some("판정 ✓ 12 passed")),
        ];
        assert!(closed_without_verdict(&after).is_empty());
        // 다른 계획의 판정은 덮지 않는다. `판정:` 은 판정 형식이 아니다.
        let other = [
            call("a", "done", Some("판정: 통과")),
            call("b", "done", Some("판정 ✓ ok")),
        ];
        assert_eq!(closed_without_verdict(&other), ["a"]);
    }

    #[test]
    fn nothing_closed_means_nothing_to_ask() {
        assert!(closed_without_verdict(&[]).is_empty());
        assert!(closed_without_verdict(&[
            call("a", "in_progress", None),
            call("a", "blocked", None)
        ])
        .is_empty());
    }

    #[test]
    fn the_objection_names_the_plan_and_its_check_command() {
        let dir = project(&plan_md("active", Some("pnpm test && cargo test"), &[]));
        let got = objection(dir.path(), &[call("round", "done", None)], None).unwrap();
        assert_eq!(
            got.plans,
            [Unjudged {
                plan_id: "round".into(),
                title: "라운드".into(),
                check: "pnpm test && cargo test".into(),
            }]
        );
        let msg = got.message();
        assert!(msg.contains("pnpm test && cargo test"), "{msg}");
        assert!(
            msg.contains("plan_update") && msg.contains("판정 ✓"),
            "{msg}"
        );
        assert!(msg.contains("대화당 한 번"), "{msg}");
    }

    #[test]
    fn plans_without_a_check_command_or_not_active_are_silent() {
        let closed = [call("round", "done", None)];
        let no_check = project(&plan_md("active", None, &[]));
        assert_eq!(objection(no_check.path(), &closed, None), None);
        let done = project(&plan_md("done", Some("make check"), &[]));
        assert_eq!(objection(done.path(), &closed, None), None);
        // 계획 파일이 없거나 id 가 경로를 벗어나려 하면 우리 것이 아니다.
        let dir = project(&plan_md("active", Some("make check"), &[]));
        assert_eq!(
            objection(dir.path(), &[call("ghost", "done", None)], None),
            None
        );
        assert_eq!(
            objection(dir.path(), &[call("../round", "done", None)], None),
            None
        );
    }

    #[test]
    fn a_verdict_left_by_anyone_since_this_conversation_started_covers_it() {
        let row =
            "| 2026-11-22T10:00:00+09:00 | #a | claude-code | ~→x |  | 판정 ✓ 12 passed · mac |";
        let dir = project(&plan_md("active", Some("make check"), &[row]));
        let closed = [call("round", "done", None)];
        let at = crate::clock::parse_rfc3339("2026-11-22T10:00:00+09:00")
            .unwrap()
            .as_second();
        // 판정이 이 대화가 시작한 뒤에 났다 — 서브에이전트나 옆 대화가 돌렸다.
        assert_eq!(objection(dir.path(), &closed, Some(at - 60)), None);
        // 판정이 이 대화보다 먼저 났다 — 이 대화가 고친 것은 그 판정이 본 적이 없다.
        assert!(objection(dir.path(), &closed, Some(at + 60)).is_some());
        // 언제 시작했는지 모르면 계획에 적힌 것으로는 가르지 못한다 — 대화 자신의 기록만 본다.
        assert!(objection(dir.path(), &closed, None).is_some());
    }
}
