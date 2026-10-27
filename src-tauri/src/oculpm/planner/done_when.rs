//! 플랜의 「완료 조건」 한 줄 — 작업 너머의 목표.
//!
//! 플랜 본문의 `**완료 조건:** …` (또는 `**Done when:** …`) 첫 줄. 세션 시작 훅
//! (`plan-context.sh`)과 이어하기 자료(`resume.rs`), `plan_status` 가 같은 줄을 읽는다 —
//! 할 일 목록만 받은 에이전트는 왜 하는지를 모른다 (고도, 2026-10-27). 셸 쪽 정규식과
//! **같은 계약**이다: 한쪽만 바꾸면 앱이 보여 주는 것과 실제로 실리는 것이 갈라진다.

const MARKERS: &[&str] = &["**완료 조건:**", "**Done when:**"];

/// 본문에서 첫 완료 조건 줄의 **내용**(마커 제외, trim). 없으면 `None`.
pub fn done_when(md: &str) -> Option<String> {
    md.lines().find_map(|line| {
        let line = line.trim();
        MARKERS
            .iter()
            .find_map(|m| line.strip_prefix(m))
            .map(|rest| rest.trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

/// `plan_create` 가 쓰는 줄 — 한 줄로 접고 마커를 붙인다.
pub fn render_line(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("**완료 조건:** {one_line}")
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
    fn render_folds_to_one_line() {
        assert_eq!(
            render_line("  둘 다\n  초록  "),
            "**완료 조건:** 둘 다 초록"
        );
        assert_eq!(done_when(&render_line("x\ny")).as_deref(), Some("x y"));
    }
}
