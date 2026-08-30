//! 미룬 지름길(defer) 원장 — ponytail 의 부채 원장 개념 이식.
//!
//! 코드 주석에 남긴 defer 마커(`oculpm-defer` 뒤에 콜론)를 결정적으로 수확해
//! 회고 화면 카드로 보여준다. 마커 본문은 `;` 로 천장(ceiling)과 재방문
//! 트리거를 구분한다 — `;` 뒤가 없거나 공백이면 **no_trigger** 다. "트리거
//! 없는 마커는 조용히 썩는다"가 이 원장의 핵심이므로 정렬도 no_trigger 우선.
//!
//! evals.rs 와 같은 결: 읽기 전용 신호이며 쓰기는 없다. `RetroSignals` 에
//! 넣지 않는 독립 신호다 — 코드 어디를 걸어도 회고 signature 를 오염시키지
//! 않는다.
//!
//! 주의: 이 저장소 자신도 ocul-pm 으로 추적된다 — 이 파일의 주석·테스트가
//! 스스로 수확되지 않도록, 주석에서는 마커 리터럴(콜론 포함)을 쓰지 않고
//! 테스트 입력은 `concat!` 으로 쪼개 만든다.

use std::path::Path;

use serde::Serialize;

/// 마커 접두 (대소문자 구분). 주석 문자 뒤에 나타난 것만 인정한다.
pub const MARKER: &str = "oculpm-defer:";

/// 수확 상한 — 초과분은 침묵 절단하지 않고 `truncated=true` 로 표시한다.
const MAX_FILES: usize = 2_000;
const MAX_MARKERS: usize = 200;
/// 결정적 바이너리 규칙: 앞 8KB 에 NUL 바이트가 있으면 스킵.
const BINARY_PROBE_BYTES: usize = 8_192;

/// 마커 앞(같은 줄)에 이 중 하나가 있어야 주석으로 인정 — 문자열 리터럴 등
/// 코드 본문의 우연한 등장을 걸러내는 결정적 휴리스틱이다.
const COMMENT_TOKENS: &[&str] = &["//", "#", "/*", "--", "<!--"];

/// gitignore 와 무관하게 항상 제외하는 디렉터리.
const EXCLUDED_DIRS: &[&str] = &[".oculpm", ".git", "node_modules", "target"];

/// 수확된 마커 한 건.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DeferMarker {
    /// 프로젝트 루트 기준 상대 경로 (`/` 구분자).
    pub path: String,
    /// 1-based.
    pub line: u32,
    /// `;` 앞 — 이 지름길의 천장(무엇을 미뤘는가).
    pub ceiling: String,
    /// `;` 뒤 — 재방문 트리거. 없으면 `None`.
    pub trigger: Option<String>,
    /// 트리거가 없는 마커 — 조용히 썩는 것. 정렬에서 앞선다.
    pub no_trigger: bool,
}

/// `defer_signals` 응답. 마커 0건이면 UI 가 카드를 그리지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DeferSignals {
    /// no_trigger 우선, 그다음 path·line 오름차순.
    pub markers: Vec<DeferMarker>,
    /// 실제로 마커를 찾아본(스킵 제외) 파일 수.
    pub files_scanned: u32,
    /// 파일 2,000개·마커 200개 상한에 걸려 일부만 봤다는 표시.
    pub truncated: bool,
}

/// 한 줄에서 마커를 파싱한다 (pure). 반환은 `(ceiling, trigger)`.
pub fn parse_marker(line: &str) -> Option<(String, Option<String>)> {
    let idx = line.find(MARKER)?;
    let before = &line[..idx];
    // 주석 토큰이 마커 **직전**(사이는 공백만)에 있어야 한다 — 느슨한
    // contains 검사는 `https://…/oculpm-defer:…` 의 `//` 나 문자열 리터럴 속
    // 주석 문자까지 통과시켜 원장을 오탐으로 채웠다 (적대 리뷰 확정 사례).
    let head = before.trim_end();
    let in_comment = COMMENT_TOKENS.iter().any(|t| head.ends_with(t)) || before.trim() == "*"; // 블록 주석 이어지는 줄 ` * oculpm-defer:`
    if !in_comment {
        return None;
    }
    let rest = line[idx + MARKER.len()..].trim();
    // 블록 주석 닫힘 문자는 본문이 아니다.
    let rest = rest.trim_end_matches("*/").trim_end_matches("-->").trim();
    Some(match rest.split_once(';') {
        Some((ceiling, trigger)) => {
            let trigger = trigger.trim();
            if trigger.is_empty() {
                // `;` 는 있는데 뒤가 비었다 — 트리거 없음과 같다.
                (ceiling.trim().to_string(), None)
            } else {
                (ceiling.trim().to_string(), Some(trigger.to_string()))
            }
        }
        None => (rest.to_string(), None),
    })
}

/// 프로젝트 루트를 walk 해 defer 원장을 만든다. 실패는 신호를 죽이지 않는다 —
/// 읽기 실패/비 UTF-8/바이너리 파일은 조용히 건너뛴다 (evals 의 관대함과 동일).
pub fn harvest(project_root: &Path) -> DeferSignals {
    harvest_with_caps(project_root, MAX_FILES, MAX_MARKERS)
}

/// 상한 주입 가능한 본체 — 테스트에서 2,001개 파일을 만들지 않기 위한 분리.
fn harvest_with_caps(project_root: &Path, max_files: usize, max_markers: usize) -> DeferSignals {
    // 인덱서의 walk 재사용 — .gitignore 존중 + 사이즈 상한(500KB) + 1차
    // 바이너리 필터를 그대로 얻는다.
    let config = crate::indexer::IndexConfig::default();
    let mut paths: Vec<(String, std::path::PathBuf)> =
        crate::indexer::walk_text_files(project_root, &config)
            .into_iter()
            .filter_map(|abs| {
                let rel = abs.strip_prefix(project_root).ok()?.to_path_buf();
                if is_excluded(&rel) {
                    return None;
                }
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                Some((rel_str, abs))
            })
            .collect();
    // walk 순서는 플랫폼 의존 — 상한 절단이 결정적이도록 경로로 정렬.
    paths.sort_by(|a, b| a.0.cmp(&b.0));

    let mut truncated = paths.len() > max_files;
    paths.truncate(max_files);

    let mut markers: Vec<DeferMarker> = Vec::new();
    let mut files_scanned: u32 = 0;
    'files: for (rel, abs) in paths {
        // 비 UTF-8 은 read_to_string 이 걸러준다.
        let Ok(text) = std::fs::read_to_string(&abs) else {
            continue;
        };
        // NUL 은 유효한 UTF-8 이라 여기까지 올 수 있다 — 결정적 규칙으로 스킵.
        let probe_len = text.len().min(BINARY_PROBE_BYTES);
        if text.as_bytes()[..probe_len].contains(&0) {
            continue;
        }
        files_scanned += 1;
        for (i, line) in text.lines().enumerate() {
            let Some((ceiling, trigger)) = parse_marker(line) else {
                continue;
            };
            if markers.len() >= max_markers {
                // 침묵 절단 금지 — 표시하고 멈춘다.
                truncated = true;
                break 'files;
            }
            let no_trigger = trigger.is_none();
            markers.push(DeferMarker {
                path: rel.clone(),
                line: (i + 1) as u32,
                ceiling,
                trigger,
                no_trigger,
            });
        }
    }

    // 썩는 것(no_trigger) 먼저, 그다음 path·line.
    markers.sort_by(|a, b| {
        b.no_trigger
            .cmp(&a.no_trigger)
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.line.cmp(&b.line))
    });

    DeferSignals {
        markers,
        files_scanned,
        truncated,
    }
}

/// 문서 계열 확장자 — 마커는 "코드 주석" 규격이다. 문서(README·설계문서·
/// 템플릿)는 마커 **사용법을 설명**하느라 리터럴을 담는 것이 필연이라 수확
/// 대상에서 제외한다. 특히 마스터 템플릿(v8)의 규칙 줄이 AGENTS.md 로 전
/// 프로젝트에 배포되므로, 제외하지 않으면 앱이 재생성하는(사용자가 지울 수
/// 없는) 유령 항목이 모든 회고 화면에 영구 표시된다 (적대 리뷰 HIGH).
const DOC_EXTENSIONS: &[&str] = &["md", "mdx", "markdown", "tpl", "rst", "adoc", "txt"];

fn is_excluded(rel: &Path) -> bool {
    if rel
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| DOC_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
    {
        return true;
    }
    rel.components().any(|c| {
        matches!(
            c,
            std::path::Component::Normal(n)
                if n.to_str().is_some_and(|s| EXCLUDED_DIRS.contains(&s))
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // 테스트 입력의 마커는 concat! 으로 쪼갠다 — 이 소스 파일 자체가 수확
    // 대상이 되지 않게 (모듈 문서 주석 참조).
    macro_rules! marker_line {
        ($pre:expr, $rest:expr) => {
            concat!($pre, "oculpm-", "defer:", $rest)
        };
    }

    #[test]
    fn parses_three_comment_styles_with_and_without_trigger() {
        // // 스타일 + 트리거 있음
        let (c, t) = parse_marker(marker_line!(
            "let x = 1; // ",
            " 전역 락이라 동시 1건; 사용자 100+ 되면 샤딩"
        ))
        .unwrap();
        assert_eq!(c, "전역 락이라 동시 1건");
        assert_eq!(t.as_deref(), Some("사용자 100+ 되면 샤딩"));

        // # 스타일 + 트리거 없음 (`;` 자체가 없음)
        let (c, t) = parse_marker(marker_line!("# ", " 하드코딩된 경로")).unwrap();
        assert_eq!(c, "하드코딩된 경로");
        assert!(t.is_none());

        // -- 스타일 + `;` 는 있는데 뒤가 공백 → 역시 트리거 없음
        let (c, t) = parse_marker(marker_line!("-- ", " 인덱스 없음;  ")).unwrap();
        assert_eq!(c, "인덱스 없음");
        assert!(t.is_none());

        // 블록 주석 — 닫힘 문자는 본문에서 떨어진다.
        let (c, t) =
            parse_marker(marker_line!("/* ", " 캐시 무효화 없음; TTL 도입되면 */")).unwrap();
        assert_eq!(c, "캐시 무효화 없음");
        assert_eq!(t.as_deref(), Some("TTL 도입되면"));

        // 트리거의 추가 `;` 는 트리거에 속한다 (split_once).
        let (_, t) = parse_marker(marker_line!("// ", " a; b; c")).unwrap();
        assert_eq!(t.as_deref(), Some("b; c"));
    }

    #[test]
    fn rejects_non_comment_and_case_mismatch() {
        // 주석 문자가 마커 앞에 없다 — 문자열 리터럴 등.
        assert!(parse_marker(marker_line!("let s = \"", " fake\"")).is_none());
        // 대소문자 구분 — 대문자는 마커가 아니다.
        assert!(parse_marker(concat!("// ", "OCULPM-", "DEFER:", " x; y")).is_none());
        // 마커 자체가 없다.
        assert!(parse_marker("// 그냥 주석").is_none());
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn harvest_respects_gitignore_excluded_dirs_and_binary_skip() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // ignore crate 는 git 저장소일 때만 .gitignore 를 적용한다 (require_git).
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.rs\n").unwrap();

        write(
            root,
            "src/a.rs",
            &format!(
                "fn main() {{}}\n{}\n{}\n",
                marker_line!("// ", " 트리거 없는 지름길"),
                marker_line!("// ", " 천장 텍스트; 재방문 조건")
            ),
        );
        write(
            root,
            "ignored.rs",
            marker_line!("// ", " gitignore 로 제외; 절대 안 보임"),
        );
        write(
            root,
            "node_modules/x.js",
            marker_line!("// ", " 의존성 내부; 제외"),
        );
        write(
            root,
            "target/y.rs",
            marker_line!("// ", " 빌드 산출물; 제외"),
        );
        // NUL 이 앞 8KB 에 있는 파일 — 마커가 있어도 스킵.
        let mut bin = marker_line!("// ", " 바이너리; 스킵").as_bytes().to_vec();
        bin.push(0);
        std::fs::write(root.join("blob.txt"), bin).unwrap();

        let s = harvest(root);
        assert_eq!(s.markers.len(), 2, "{:?}", s.markers);
        assert!(s.markers.iter().all(|m| m.path == "src/a.rs"));
        // no_trigger 먼저.
        assert!(s.markers[0].no_trigger);
        assert_eq!(s.markers[0].ceiling, "트리거 없는 지름길");
        assert!(!s.markers[1].no_trigger);
        assert_eq!(s.markers[1].trigger.as_deref(), Some("재방문 조건"));
        assert!(!s.truncated);
        assert!(s.files_scanned >= 1);
    }

    #[test]
    fn harvest_sorts_no_trigger_first_then_path_and_line() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "b.rs", marker_line!("// ", " b 천장; b 트리거"));
        write(
            root,
            "a.rs",
            &format!(
                "{}\n{}\n",
                marker_line!("// ", " a 트리거 있음; 곧"),
                marker_line!("// ", " a 트리거 없음")
            ),
        );
        let s = harvest(root);
        let order: Vec<(&str, u32, bool)> = s
            .markers
            .iter()
            .map(|m| (m.path.as_str(), m.line, m.no_trigger))
            .collect();
        assert_eq!(
            order,
            vec![("a.rs", 2, true), ("a.rs", 1, false), ("b.rs", 1, false)]
        );
    }

    #[test]
    fn harvest_caps_mark_truncated_instead_of_silent_cut() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for name in ["a.rs", "b.rs", "c.rs"] {
            write(root, name, marker_line!("// ", " 상한 테스트"));
        }
        // 파일 상한: 3개 중 2개만 — truncated.
        let s = harvest_with_caps(root, 2, 100);
        assert_eq!(s.markers.len(), 2);
        assert!(s.truncated);

        // 마커 상한: 한 파일에 5개, 상한 3 — truncated.
        let many = (0..5)
            .map(|i| format!("{} {}", marker_line!("// ", " 반복"), i))
            .collect::<Vec<_>>()
            .join("\n");
        write(root, "many.rs", &many);
        let s = harvest_with_caps(root, 100, 3);
        assert_eq!(s.markers.len(), 3);
        assert!(s.truncated);

        // 정확히 상한만큼일 땐 truncated 아님.
        let s = harvest_with_caps(root, 100, 8);
        assert_eq!(s.markers.len(), 8, "{:?}", s.markers);
        assert!(!s.truncated);
    }

    /// 적대 리뷰 회귀 — 오탐 클래스: URL 의 `//`·백틱 인라인 예시·문자열 리터럴.
    #[test]
    fn parse_rejects_non_adjacent_comment_tokens() {
        // URL: `//` 가 마커 직전이 아니다.
        let url = concat!(
            "let u = \"https://docs.example.com/",
            "oculpm-defer",
            ":usage\";"
        );
        assert!(parse_marker(url).is_none(), "URL 오탐");
        // 마크다운 헤딩 스타일 (# 뒤 텍스트가 끼면 인접 아님).
        let heading = concat!("# 사용법 — ", "oculpm-defer", ": 마커 규칙");
        assert!(parse_marker(heading).is_none(), "헤딩 오탐");
        // 인접 케이스는 통과해야 한다.
        let ok = concat!("  // ", "oculpm-defer", ": 전역 락; 샤딩 시");
        assert!(parse_marker(ok).is_some());
        let hash = concat!("# ", "oculpm-defer", ": 캐시 없음; 느려지면");
        assert!(parse_marker(hash).is_some());
        let cont = concat!(" * ", "oculpm-defer", ": 단일 스레드; 병렬화 요구 시");
        assert!(parse_marker(cont).is_some());
    }

    /// 적대 리뷰 HIGH 회귀 — 문서/템플릿은 수확 제외: 템플릿 v8 규칙 줄이
    /// AGENTS.md 로 전 프로젝트에 배포돼도 유령 항목이 생기지 않아야 한다.
    #[test]
    fn harvest_excludes_doc_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let marker_line = concat!(
            "규칙: `// ",
            "oculpm-defer",
            ": <천장>; <트리거>` 를 붙이세요\n"
        );
        std::fs::write(root.join("AGENTS.md"), marker_line).unwrap();
        std::fs::write(root.join("guide.tpl"), marker_line).unwrap();
        std::fs::write(
            root.join("main.rs"),
            concat!("// ", "oculpm-defer", ": 전역 락; 사용자 100+\n"),
        )
        .unwrap();
        let out = harvest(root);
        assert_eq!(out.markers.len(), 1, "코드 파일 1건만: {:?}", out.markers);
        assert_eq!(out.markers[0].path, "main.rs");
    }
}
