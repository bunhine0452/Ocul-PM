//! best-results-round `{#scorecard-cmd}` — Today 「약속 성적표」 카드의 데이터원.
//!
//! `docs/PROMISE.md` 측정 목표 표의 **지금** 열을 산다. 일지 쪽 숫자(증거 비율·7일
//! 재수정)는 `db::scorecard` 가 성적표 스크립트와 같은 정의로 계산하고, 플랜 쪽
//! (활성 플랜 중 완료 조건·확인 명령이 있는 수)은 플래너 디스크를 여기서 읽는다 —
//! 플랜 캐시는 그 두 줄을 투영하지 않고, 디스크가 SSOT 다.

use std::path::Path;

use chrono::{Duration, Local};
use tauri::State;

use crate::db::{scorecard::JournalScore, Db};
use crate::oculpm::planner::{
    done_when::{check_command, done_when},
    log_archive::{is_plan_path, plan_stem},
    parse::parse_plan,
    project::planner_dir,
};

/// 카드의 기본 창 — PROMISE 가 「다음 외부 리뷰까지」를 잰다면 카드는 최근 한 달을 본다.
const DEFAULT_DAYS: u32 = 30;

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, specta::Type)]
pub struct PlanScore {
    pub active_plans: u32,
    pub with_done_when: u32,
    pub with_check: u32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
pub struct PromiseScorecard {
    pub window_days: u32,
    pub journal: JournalScore,
    pub plans: PlanScore,
}

/// 활성 플랜을 디스크에서 세어 완료 조건·확인 명령이 있는 수를 돌려준다.
pub fn plan_score(planner_root: &Path) -> PlanScore {
    let mut out = PlanScore::default();
    let Ok(entries) = std::fs::read_dir(planner_root) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_plan_path(&path) {
            continue;
        }
        let Ok(md) = std::fs::read_to_string(&path) else {
            continue;
        };
        if parse_plan(&md, &plan_stem(&path))
            .frontmatter
            .status
            .as_str()
            != "active"
        {
            continue;
        }
        out.active_plans += 1;
        if done_when(&md).is_some() {
            out.with_done_when += 1;
        }
        if check_command(&md).is_some() {
            out.with_check += 1;
        }
    }
    out
}

/// 「약속 성적표」 — `days` 가 없으면 30일. 오늘 포함 `days` 일의 workday 창.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_promise_scorecard(
    db: State<'_, Db>,
    project_id: u32,
    days: Option<u32>,
) -> Result<PromiseScorecard, String> {
    let days = days.unwrap_or(DEFAULT_DAYS).clamp(7, 365);
    let since = (Local::now().date_naive() - Duration::days(days as i64 - 1))
        .format("%Y%m%d")
        .to_string();
    let journal = db
        .journal_score(project_id, since)
        .await
        .map_err(|e| e.to_string())?;
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let plans = plan_score(&planner_dir(Path::new(&project.root_path)));
    Ok(PromiseScorecard {
        window_days: days,
        journal,
        plans,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_active_plans_and_their_goal_lines() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("a.md"),
            "---\noculpm_plan: v1\nid: a\ntitle: \"a\"\nstatus: active\n---\n**완료 조건:** 둘 다 초록\n**확인 명령:** cargo test\n- [ ] x {#x}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("b.md"),
            "---\noculpm_plan: v1\nid: b\ntitle: \"b\"\nstatus: active\n---\n**Done when:** ships\n- [ ] y {#y}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("c.md"),
            "---\noculpm_plan: v1\nid: c\ntitle: \"c\"\nstatus: done\n---\n**완료 조건:** 닫힌 플랜은 안 센다\n- [x] z {#z}\n",
        )
        .unwrap();
        std::fs::write(root.join("a.log.md"), "---\noculpm_plan_log: v1\n---\n").unwrap();
        assert_eq!(
            plan_score(root),
            PlanScore {
                active_plans: 2,
                with_done_when: 2,
                with_check: 1
            }
        );
        assert_eq!(plan_score(&root.join("missing")), PlanScore::default());
    }
}
