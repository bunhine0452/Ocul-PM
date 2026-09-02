//! 「0회」의 이유를 가르는 신호 수집 (플랜 `context-budget-truth` D).
//!
//! 제안 패널은 30일 발동 0회인 스킬을 전부 "설명이 발동 기준입니다" 라며
//! 「설명 고쳐 쓰기」 후보로 밀었다. 그런데 2026-09-03 이 저장소의 0회 스킬
//! 5개는 이유가 제각각이었고, **설명 문제는 하나뿐**이었다:
//!
//! - `project-inception` — 2년째 굴러가는 저장소라 킥오프 사건이 없었다
//! - `run-evals` — `EVALS.md` 가 없다. 발동할 대상 자체가 없다
//! - `tdd-workflow` — CLAUDE.md 가 "명시 요청할 때만" 이라고 억제해 뒀다
//! - `lang-review` — 방금 만들었다
//!
//! 앞의 셋에 설명을 고쳐 쓰면 **안 맞는 상황에 끼어드는 스킬**이 된다. 제안이
//! 상황을 나쁘게 만드는 것이다.
//!
//! 이 모듈은 판정하지 않고 **신호만** 모은다 (선행조건 파일 부재 · 억제 문장 ·
//! 파일 나이). 네 상태로 가르는 것은 프런트의 순수 함수라 화면 없이 테스트된다.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::commands::skills::SkillScope;
use crate::oculpm::rule_negation::sections;
use crate::oculpm::rule_scope::walk_project_files;
use crate::oculpm::rules::{self, RuleScope};

/// 억제 표지 — "필요할 때만 쓴다" 는 말. 부정(`rule_negation`)과 다르다:
/// 부정은 "안 쓴다", 억제는 "부를 때만 쓴다" 다.
const SUPPRESSION_MARKERS: &[&str] = &[
    "요청할 때만",
    "요청했을 때만",
    "명시적으로 요청",
    "명시 요청",
    "부를 때만",
    "시킬 때만",
    "only when asked",
    "only on request",
    "only when i ask",
    "when explicitly requested",
];

/// 설명에서 선행조건으로 읽을 파일 확장자.
const PRECONDITION_EXTS: &[&str] = &[
    "md", "json", "toml", "yaml", "yml", "lock", "txt", "cfg", "ini",
];

/// 스킬 하나의 「왜 0회인가」 신호.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillDormancySignal {
    pub scope: SkillScope,
    pub dir_name: String,
    /// description 이 가리키는데 이 프로젝트에 **없는** 파일들.
    /// 비어 있지 않으면 발동할 대상 자체가 없다는 뜻이다.
    pub missing_files: Vec<String>,
    /// 이 스킬을 억제하는 문서 (`CLAUDE.md`, `~/.claude/CLAUDE.md`).
    pub suppressed_in: Option<String>,
    /// 억제 근거 발췌 — 휴리스틱이라 사람이 판정할 수 있어야 한다.
    pub suppressed_excerpt: Option<String>,
    /// SKILL.md 를 마지막으로 고친 뒤 지난 **날수**. 못 읽으면 `None`.
    ///
    /// 절대 시각이 아니라 나이인 이유: 분류기가 묻는 것은 "계측 창보다 새로
    /// 만든 파일인가" 하나뿐이다. 나이면 그 질문에 바로 답하고, 시각을
    /// 주고받으면 양쪽이 각자 시계를 읽어야 한다.
    pub age_days: Option<u32>,
}

/// 설명에서 파일처럼 보이는 토큰을 뽑는다 (`EVALS.md`, `package.json` …).
///
/// 정규식을 쓰지 않는다 — 의존을 늘리지 않고도 "점 앞뒤가 파일명 문자" 라는
/// 조건이면 충분하다. 경로 구분자가 섞인 토큰(`.oculpm/planner`)은 파일 하나를
/// 가리키지 않으므로 버린다.
pub fn file_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in text.split(|c: char| c.is_whitespace() || "()[]{}\"'`,;:!?".contains(c)) {
        let tok = raw.trim_matches(|c: char| c == '.' || c == '·');
        let Some((stem, ext)) = tok.rsplit_once('.') else {
            continue;
        };
        if stem.is_empty() || stem.contains('/') || stem.contains('\\') {
            continue;
        }
        if !PRECONDITION_EXTS.contains(&ext.to_lowercase().as_str()) {
            continue;
        }
        if !stem
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            continue;
        }
        if seen.insert(tok.to_string()) {
            out.push(tok.to_string());
        }
    }
    out
}

/// 억제 문장 찾기 — 스킬 이름이 언급된 섹션에 억제 표지가 있는가.
fn suppression_for(skill_name: &str, docs: &[(String, Vec<String>)]) -> Option<(String, String)> {
    for (doc, secs) in docs {
        for section in secs {
            if !section.contains(skill_name) {
                continue;
            }
            let lower = section.to_lowercase();
            for m in SUPPRESSION_MARKERS {
                let hit = if m.is_ascii() {
                    lower.contains(m)
                } else {
                    section.contains(m)
                };
                if hit {
                    return Some((doc.clone(), excerpt_line(section, m)));
                }
            }
        }
    }
    None
}

fn excerpt_line(section: &str, marker: &str) -> String {
    let idx = section
        .find(marker)
        .or_else(|| section.to_lowercase().find(&marker.to_lowercase()))
        .unwrap_or(0);
    let start = section[..idx].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = section[idx..]
        .find('\n')
        .map(|i| idx + i)
        .unwrap_or(section.len());
    let raw = section[start..end].trim();
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() > 160 {
        format!("{}…", chars[..160].iter().collect::<String>())
    } else {
        raw.to_string()
    }
}

fn age_days(path: &Path) -> Option<u32> {
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let elapsed = std::time::SystemTime::now().duration_since(modified).ok()?;
    Some((elapsed.as_secs() / 86_400).min(u32::MAX as u64) as u32)
}

/// 신호 수집 본체.
pub fn collect(
    project_root: &Path,
    home: &Path,
    skills: &[(SkillScope, String, String, String)],
) -> Vec<SkillDormancySignal> {
    // 선행조건 판정의 분모 — 프로젝트에 실제로 있는 파일 basename 집합.
    let present: HashSet<String> = walk_project_files(project_root)
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();

    let overview = rules::overview(project_root, home, false);
    let mut docs: Vec<(String, Vec<String>)> = Vec::new();
    for entry in &overview.claude_md {
        if !entry.exists {
            continue;
        }
        let root = match entry.scope {
            RuleScope::Project => project_root,
            RuleScope::Global => home,
        };
        if let Ok(text) = std::fs::read_to_string(root.join(&entry.rel_path)) {
            let shown = if entry.scope == RuleScope::Global {
                format!("~/{}", entry.rel_path)
            } else {
                entry.rel_path.clone()
            };
            docs.push((shown, sections(&text)));
        }
    }

    skills
        .iter()
        .map(|(scope, dir_name, description, skill_md_path)| {
            let missing_files = file_tokens(description)
                .into_iter()
                .filter(|tok| !present.contains(tok))
                .collect();
            let sup = suppression_for(dir_name, &docs);
            SkillDormancySignal {
                scope: *scope,
                dir_name: dir_name.clone(),
                missing_files,
                suppressed_in: sup.as_ref().map(|(d, _)| d.clone()),
                suppressed_excerpt: sup.map(|(_, e)| e),
                age_days: age_days(Path::new(skill_md_path)),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn seed(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn extracts_file_like_tokens_only() {
        let toks =
            file_tokens("프로젝트의 EVALS.md 평가 기준을 실행합니다. package.json 도 봅니다.");
        assert_eq!(toks, vec!["EVALS.md", "package.json"]);
        // 문장 부호·경로·낯선 확장자는 걸러진다.
        assert!(file_tokens("이건 e.g. 그냥 문장. src/app.tsx 와 v1.2 참고").is_empty());
    }

    #[test]
    fn missing_precondition_file_is_reported() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), "README.md", "x");
        let skills = vec![(
            SkillScope::Project,
            "run-evals".to_string(),
            "프로젝트의 EVALS.md 평가 기준을 실행할 때".to_string(),
            String::new(),
        )];
        let out = collect(proj.path(), home.path(), &skills);
        assert_eq!(out[0].missing_files, vec!["EVALS.md"]);
    }

    #[test]
    fn present_precondition_file_is_not_reported() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(proj.path(), "EVALS.md", "기준");
        let skills = vec![(
            SkillScope::Project,
            "run-evals".to_string(),
            "프로젝트의 EVALS.md 평가 기준".to_string(),
            String::new(),
        )];
        assert!(collect(proj.path(), home.path(), &skills)[0]
            .missing_files
            .is_empty());
    }

    #[test]
    fn suppression_sentence_is_found_with_evidence() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            home.path(),
            ".claude/CLAUDE.md",
            "# 지침\n\n## 테스트\n\nTDD 는 `tdd-workflow` 로 요청할 때만 쓴다.\n",
        );
        let skills = vec![(
            SkillScope::Global,
            "tdd-workflow".to_string(),
            "테스트 먼저".to_string(),
            String::new(),
        )];
        let out = collect(proj.path(), home.path(), &skills);
        assert_eq!(out[0].suppressed_in.as_deref(), Some("~/.claude/CLAUDE.md"));
        assert!(out[0]
            .suppressed_excerpt
            .as_ref()
            .unwrap()
            .contains("요청할 때만"));
    }

    #[test]
    fn unmentioned_skill_is_not_suppressed() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            home.path(),
            ".claude/CLAUDE.md",
            "# 지침\n\n## 테스트\n\nTDD 는 요청할 때만 쓴다.\n",
        );
        let skills = vec![(
            SkillScope::Global,
            "lang-review".to_string(),
            "코드 리뷰".to_string(),
            String::new(),
        )];
        assert!(collect(proj.path(), home.path(), &skills)[0]
            .suppressed_in
            .is_none());
    }

    #[test]
    fn age_days_reads_the_skill_file() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            proj.path(),
            ".claude/skills/x/SKILL.md",
            "---\nname: x\n---\n",
        );
        let path = proj.path().join(".claude/skills/x/SKILL.md");
        let skills = vec![(
            SkillScope::Project,
            "x".to_string(),
            String::new(),
            path.display().to_string(),
        )];
        // 방금 만든 파일 — 나이 0일. 읽지 못하면 None 이라 "새 파일" 로 오인되지 않는다.
        assert_eq!(
            collect(proj.path(), home.path(), &skills)[0].age_days,
            Some(0)
        );
    }
}
