//! `.oculpm/README.md` 자동 생성 (#a2-skills-activation — 퍼널 활성화 배선 ①).
//!
//! journal/planner 가 git 에 커밋되면 저장소를 보는 팀원·방문자가 `.oculpm/` 을
//! 처음 만난다 — 이 디렉터리의 정체를 설명하는 README 가 곧 발견 채널이다
//! ("이게 뭐지, 지워도 되나" 를 "아, 작업 기록이구나" 로). **이미 있으면 절대
//! 덮어쓰지 않는다** — 한 번 생성된 뒤에는 사용자 소유 파일이다.

use std::path::Path;

use crate::oculpm::atomic_io::write_atomic;

/// 생성 마커 — 향후 내용 개정 시 구버전 자동 생성본만 식별하기 위한 표식
/// (덮어쓰기에 쓰지는 않는다 — 존재하면 무조건 불변).
pub const README_MARKER: &str = "<!-- oculpm:readme v1 -->";

const README_BODY: &str = "\
# .oculpm — 이 폴더는 뭔가요?

이 프로젝트는 [ocul-pm](https://oculpm.com) 으로 추적됩니다 — AI 코딩 에이전트가
무엇을 했는지를 **사람이 읽는 마크다운**으로 남기는 로컬-퍼스트 작업 기록입니다.

| 경로 | 내용 |
|---|---|
| `journal/` | 작업 일지 — 버그/기능/리팩토링 단위의 회고 기록 |
| `planner/` | 살아있는 계획 문서 — 항목별 진행 글리프와 갱신 로그 |
| `discussion/` | 결정 전 문제 정의·옵션 비교 문서 |
| `agents/` | 에이전트 기록 규칙 템플릿 |
| `index/` · `hooks/` | 앱 관리 영역 (gitignore — 커밋되지 않음) |

모든 파일은 평범한 마크다운입니다 — 앱 없이 그대로 읽을 수 있고, 저장소와 함께
버전됩니다. 세션 타임라인·diff 대조·회고·정직성 감사는 ocul-pm 앱에서 봅니다.

*This directory is created by [ocul-pm](https://oculpm.com), a local-first work
journal for AI coding agents. Everything here is plain Markdown — readable
without the app.*
";

/// `.oculpm/README.md` 가 없으면 만든다. 있으면 무조건 불변 (내용 비교조차
/// 하지 않는다). 실패는 삼킨다 — README 는 최선 노력이지 기록 경로의 일부가
/// 아니며, 호출측(init/journal_write)의 본 작업을 막으면 안 된다.
pub fn ensure_oculpm_readme(root: &Path) {
    let dir = root.join(".oculpm");
    if !dir.is_dir() {
        return;
    }
    let path = dir.join("README.md");
    if path.exists() {
        return;
    }
    let content = format!("{README_BODY}\n{README_MARKER}\n");
    let _ = write_atomic(&path, content.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_readme_once_and_never_overwrites() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // .oculpm 이 없으면 아무것도 하지 않는다 (비추적 가드와 같은 정신).
        ensure_oculpm_readme(root);
        assert!(!root.join(".oculpm/README.md").exists());

        std::fs::create_dir_all(root.join(".oculpm")).unwrap();
        ensure_oculpm_readme(root);
        let text = std::fs::read_to_string(root.join(".oculpm/README.md")).unwrap();
        assert!(text.contains("oculpm.com"), "{text}");
        assert!(text.trim_end().ends_with(README_MARKER));

        // 사용자가 고친 내용은 절대 되돌리지 않는다.
        std::fs::write(root.join(".oculpm/README.md"), "사용자 수정본").unwrap();
        ensure_oculpm_readme(root);
        assert_eq!(
            std::fs::read_to_string(root.join(".oculpm/README.md")).unwrap(),
            "사용자 수정본"
        );
    }
}
