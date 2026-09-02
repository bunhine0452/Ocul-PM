//! 실려 놓고 부정되는 규칙 찾기 (플랜 `context-budget-truth` C).
//!
//! 2026-09-03 이 저장소 사용자의 전역 설정 실측: 항상 로드되는 34KB 중 8.9KB 가
//! `~/.claude/CLAUDE.md` 에서 **"따르지 않는다" 고 명시적으로 무효화한** 규칙
//! 파일들이었다. 규칙을 싣는 데 한 번, 그걸 다시 지우는 문장에 또 한 번 —
//! 양쪽으로 토큰을 내면서 얻는 것이 없다.
//!
//! 여기서 그걸 **결정적으로** 지목한다 (LLM 0 · 네트워크 0):
//!
//!   항상 로드되는 규칙의 파일명이 CLAUDE.md 계열 본문에서 언급되고,
//!   **같은 섹션 안에** 부정 표지가 있으면 후보로 올린다.
//!
//! 섹션 단위인 이유는 실제 글이 그렇게 생겼기 때문이다. 사람은 제목에 파일명을
//! 적고 두 문단 뒤에 "→ 따르지 않는다" 라고 쓴다 — 문단 단위로 보면 놓친다.
//!
//! 휴리스틱이라 **반드시 근거 발췌를 함께 낸다.** 판정은 사람이 한다. 그래서
//! 이 모듈은 아무것도 고치지 않고, 화면도 삭제 버튼을 붙이지 않는다.

use std::path::Path;

use serde::Serialize;

use crate::oculpm::rules::{self, RuleEntry, RuleKind, RuleScope};

/// 부정 표지. 한국어는 그대로, 영어는 소문자 비교.
const NEGATION_MARKERS: &[&str] = &[
    "따르지 않는다",
    "따르지 않음",
    "적용하지 않는다",
    "적용하지 않음",
    "참고하지 않는다",
    "쓰지 않는다",
    "사용하지 않는다",
    "기본값 아님",
    "무효화",
    "무시한다",
    "do not follow",
    "don't follow",
    "not applicable",
    "does not apply",
    "ignore this",
    "override",
];

/// 부정 후보 하나.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct NegationFinding {
    /// 부정당하는 규칙 (스코프 루트 상대).
    pub scope: RuleScope,
    pub rel_path: String,
    /// 그 규칙 본문 바이트 — 걷어내면 되찾는 양.
    pub bytes: u32,
    /// 부정이 적힌 파일 (`CLAUDE.md`, `~/.claude/CLAUDE.md` …).
    pub cited_in: String,
    /// 근거 발췌 — 사람이 판정할 수 있게 그대로 보여 준다.
    pub excerpt: String,
}

/// 문서를 마크다운 **섹션**으로 자른다: 제목 줄부터 다음 제목 줄 직전까지.
/// 첫 제목 앞의 서두도 한 섹션으로 친다.
pub(crate) fn sections(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    for line in text.lines() {
        if line.starts_with('#') && !buf.trim().is_empty() {
            out.push(std::mem::take(&mut buf));
        }
        buf.push_str(line);
        buf.push('\n');
    }
    if !buf.trim().is_empty() {
        out.push(buf);
    }
    out
}

/// 규칙을 가리키는 문자열들 — 강한 것부터.
///
/// 맨 스템(`testing`)은 쓰지 않는다. "testing" 같은 흔한 낱말은 아무 문장에나
/// 나와서 오탐을 만든다. 확장자가 붙은 파일명 이상만 신호로 친다.
fn citation_keys(rel_path: &str) -> Vec<String> {
    let segs: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    let mut keys = Vec::new();
    if segs.len() >= 2 {
        keys.push(segs[segs.len() - 2..].join("/"));
    }
    if let Some(last) = segs.last() {
        keys.push((*last).to_string());
    }
    keys
}

fn has_negation(section_lower: &str, section: &str) -> Option<String> {
    for m in NEGATION_MARKERS {
        let hit = if m.is_ascii() {
            section_lower.contains(m)
        } else {
            section.contains(m)
        };
        if hit {
            return Some((*m).to_string());
        }
    }
    None
}

/// 발췌 — 부정 표지 주변을 한 줄로 접는다. 너무 길면 잘라 준다.
fn excerpt_around(section: &str, marker: &str) -> String {
    let idx = section
        .find(marker)
        .or_else(|| section.to_lowercase().find(&marker.to_lowercase()))
        .unwrap_or(0);
    let line = section[..idx].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = section[idx..]
        .find('\n')
        .map(|i| idx + i)
        .unwrap_or(section.len());
    let raw = section[line..end].trim();
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() > 160 {
        format!("{}…", chars[..160].iter().collect::<String>())
    } else {
        raw.to_string()
    }
}

/// CLAUDE.md 계열 본문을 `(표시 경로, 내용)` 으로 모은다.
fn claude_md_texts(
    overview: &rules::RulesOverview,
    project_root: &Path,
    home: &Path,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
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
            out.push((shown, text));
        }
    }
    out
}

/// 항상 로드되는 규칙만 본다 — 조건부 규칙이 부정돼 있어도 비용이 확정이
/// 아니라서 "양쪽으로 낸다" 는 말이 성립하지 않는다.
fn is_always_loaded(e: &RuleEntry) -> bool {
    e.kind == RuleKind::Rule && e.paths.is_empty()
}

/// 감사 본체.
pub fn audit(project_root: &Path, home: &Path) -> Vec<NegationFinding> {
    let overview = rules::overview(project_root, home, false);
    let docs = claude_md_texts(&overview, project_root, home);
    if docs.is_empty() {
        return Vec::new();
    }
    let prepared: Vec<(String, Vec<(String, String)>)> = docs
        .into_iter()
        .map(|(name, text)| {
            let secs = sections(&text)
                .into_iter()
                .map(|s| {
                    let lower = s.to_lowercase();
                    (s, lower)
                })
                .collect();
            (name, secs)
        })
        .collect();

    let mut out = Vec::new();
    for entry in overview
        .project_rules
        .iter()
        .chain(overview.global_rules.iter())
        .filter(|e| is_always_loaded(e))
    {
        let keys = citation_keys(&entry.rel_path);
        if keys.is_empty() {
            continue;
        }
        'docs: for (doc_name, secs) in &prepared {
            for (section, lower) in secs {
                if !keys.iter().any(|k| section.contains(k.as_str())) {
                    continue;
                }
                if let Some(marker) = has_negation(lower, section) {
                    out.push(NegationFinding {
                        scope: entry.scope,
                        rel_path: entry.rel_path.clone(),
                        bytes: entry.bytes,
                        cited_in: doc_name.clone(),
                        excerpt: excerpt_around(section, &marker),
                    });
                    break 'docs;
                }
            }
        }
    }
    out
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

    /// 실제 사례 그대로 — 파일명은 제목에, 부정은 두 문단 뒤에.
    const NEGATING_CLAUDE_MD: &str = "\
# 내 전역 지침

## 따르지 않는 것

### 1. 커버리지 80% — `common/testing.md`

ECC: 유닛/통합/E2E 전부 필수, 커버리지 80% 미만이면 미완.

→ **따르지 않는다.** 테스트는 요청된 작업 범위 안에서 쓴다.

### 2. 커밋 형식 — `common/git-workflow.md`

이건 그대로 따른다.
";

    fn always_rule(body: &str) -> String {
        format!("# 제목\n\n{body}\n")
    }

    #[test]
    fn finds_a_rule_that_is_loaded_then_negated() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(home.path(), ".claude/CLAUDE.md", NEGATING_CLAUDE_MD);
        seed(
            home.path(),
            ".claude/rules/common/testing.md",
            &always_rule("커버리지 80%"),
        );

        let found = audit(proj.path(), home.path());
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].rel_path, ".claude/rules/common/testing.md");
        assert_eq!(found[0].cited_in, "~/.claude/CLAUDE.md");
        assert!(
            found[0].excerpt.contains("따르지 않는다"),
            "{}",
            found[0].excerpt
        );
    }

    /// 같은 문서에 언급돼 있어도 그 섹션에 부정이 없으면 후보가 아니다.
    #[test]
    fn a_rule_that_is_merely_cited_is_not_negated() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(home.path(), ".claude/CLAUDE.md", NEGATING_CLAUDE_MD);
        seed(
            home.path(),
            ".claude/rules/common/git-workflow.md",
            &always_rule("커밋 형식"),
        );

        let found = audit(proj.path(), home.path());
        assert!(
            found.is_empty(),
            "'그대로 따른다' 섹션을 부정으로 읽으면 안 된다: {found:?}"
        );
    }

    /// 조건부 규칙(`paths` 있음)은 대상이 아니다 — 비용이 확정이 아니라서
    /// "싣고 나서 지운다" 는 진단이 성립하지 않는다.
    #[test]
    fn conditional_rules_are_out_of_scope() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(home.path(), ".claude/CLAUDE.md", NEGATING_CLAUDE_MD);
        seed(
            home.path(),
            ".claude/rules/common/testing.md",
            "---\npaths:\n  - \"**/*.ts\"\n---\n\n# 제목\n\n본문\n",
        );
        assert!(audit(proj.path(), home.path()).is_empty());
    }

    /// 흔한 낱말이 본문에 있다고 걸리면 안 된다 — 확장자 붙은 파일명 이상만 신호.
    #[test]
    fn bare_stem_does_not_match() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            home.path(),
            ".claude/CLAUDE.md",
            "# 지침\n\n## 방침\n\ntesting 은 따르지 않는다.\n",
        );
        seed(
            home.path(),
            ".claude/rules/common/testing.md",
            &always_rule("본문"),
        );
        assert!(
            audit(proj.path(), home.path()).is_empty(),
            "맨 스템 'testing' 만으로 걸리면 오탐이 쏟아진다"
        );
    }

    #[test]
    fn project_claude_md_can_negate_too() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            proj.path(),
            "CLAUDE.md",
            "# 프로젝트\n\n## 예외\n\n`rules/legacy.md` 는 이 저장소에서 적용하지 않는다.\n",
        );
        seed(
            proj.path(),
            ".claude/rules/legacy.md",
            &always_rule("옛 규칙"),
        );

        let found = audit(proj.path(), home.path());
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].cited_in, "CLAUDE.md");
        assert_eq!(found[0].scope, RuleScope::Project);
    }

    #[test]
    fn no_claude_md_means_no_findings() {
        let proj = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        seed(
            home.path(),
            ".claude/rules/common/testing.md",
            &always_rule("본문"),
        );
        assert!(audit(proj.path(), home.path()).is_empty());
    }

    #[test]
    fn sections_split_on_headings_not_blank_lines() {
        let secs = sections("서두\n\n# A\n\n본문 A\n\n## B\n\n본문 B\n");
        assert_eq!(secs.len(), 3);
        assert!(secs[1].contains("본문 A") && !secs[1].contains("본문 B"));
    }
}
