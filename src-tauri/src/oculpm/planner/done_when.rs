//! 플랜의 「완료 조건」·「확인 명령」 한 줄씩 — 작업 너머의 목표와, 그 목표를 통과/실패로
//! 판정할 명령.
//!
//! 플랜 본문의 `**완료 조건:** …` (또는 `**Done when:** …`) 첫 줄과 `**확인 명령:** …`
//! (또는 `**Check:** …`) 첫 줄. 세션 시작 훅(`plan-context.sh`)과 이어하기 자료
//! (`resume.rs`), `plan_status` 가 같은 줄을 읽는다 — 할 일 목록만 받은 에이전트는 왜
//! 하는지를 모르고(고도, 2026-10-27), 통과/실패를 내는 명령이 없는 에이전트는 「됐다」
//! 는 주장으로 끝낸다(깊이, 2026-10-28). 셸 쪽 정규식과 **같은 계약**이다: 한쪽만
//! 바꾸면 앱이 보여 주는 것과 실제로 실리는 것이 갈라진다.

const GOAL_MARKERS: &[&str] = &["**완료 조건:**", "**Done when:**"];
const CHECK_MARKERS: &[&str] = &["**확인 명령:**", "**Check:**"];

fn first_marker_line(md: &str, markers: &[&str]) -> Option<String> {
    md.lines().find_map(|line| {
        let line = line.trim();
        markers
            .iter()
            .find_map(|m| line.strip_prefix(m))
            .map(|rest| rest.trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

/// 본문에서 첫 완료 조건 줄의 **내용**(마커 제외, trim). 없으면 `None`.
pub fn done_when(md: &str) -> Option<String> {
    first_marker_line(md, GOAL_MARKERS)
}

/// 본문에서 첫 확인 명령 줄의 내용 — 에이전트가 돌려 통과/실패를 받을 명령. 없으면 `None`.
pub fn check_command(md: &str) -> Option<String> {
    first_marker_line(md, CHECK_MARKERS)
}

fn fold(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `plan_create` 가 쓰는 줄 — 한 줄로 접고 마커를 붙인다.
pub fn render_line(text: &str) -> String {
    format!("**완료 조건:** {}", fold(text))
}

/// `plan_create` 가 쓰는 확인 명령 줄.
pub fn render_check_line(text: &str) -> String {
    format!("**확인 명령:** {}", fold(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_first_marker_line_in_either_language() {
        let md = "---\nstatus: active\n---\n\n소개.\n\n**완료 조건:** 훅이 목표를 싣는다.  \n\n## 단계 {#p}\n- [ ] a {#a}\n**완료 조건:** 둘째는 무시\n";
        assert_eq!(done_when(md).as_deref(), Some("훅이 목표를 싣는다."));
        assert_eq!(
            done_when("**Done when:** ships\n").as_deref(),
            Some("ships")
        );
        assert_eq!(done_when("**완료 조건:**   \n"), None);
        assert_eq!(done_when("no goal here"), None);
    }

    #[test]
    fn check_command_is_a_separate_line() {
        let md = "**완료 조건:** 둘 다 초록\n**확인 명령:** pnpm test && cargo test\n";
        assert_eq!(done_when(md).as_deref(), Some("둘 다 초록"));
        assert_eq!(
            check_command(md).as_deref(),
            Some("pnpm test && cargo test")
        );
        assert_eq!(
            check_command("**Check:** `pytest -q`").as_deref(),
            Some("`pytest -q`")
        );
        assert_eq!(check_command("**완료 조건:** 명령은 아니다"), None);
    }

    #[test]
    fn render_folds_to_one_line() {
        assert_eq!(
            render_line("  둘 다\n  초록  "),
            "**완료 조건:** 둘 다 초록"
        );
        assert_eq!(done_when(&render_line("x\ny")).as_deref(), Some("x y"));
        assert_eq!(
            render_check_line("pnpm test &&\n cargo test"),
            "**확인 명령:** pnpm test && cargo test"
        );
    }
}
