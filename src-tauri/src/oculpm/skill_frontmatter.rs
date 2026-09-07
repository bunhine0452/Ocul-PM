//! SKILL.md frontmatter 파싱 — 스킬이 **어떻게 도달되는지**를 정하는 필드들.
//!
//! `commands/skills.rs` 에서 떼어냈다 (파일 크기 게이트). 자리를 옮기는 김에
//! 세운 경계이기도 하다: 여기 있는 네 필드는 전부 *발동*에 관한 것이고,
//! [`skill_trigger`](super::skill_trigger) 가 다루는 "description 을 다시 쓰자"
//! 는 제안과 같은 사실 위에 서 있다.
//!
//! 규율 하나: **파싱 실패는 에러가 아니라 기본값이다.** frontmatter 가 깨졌다고
//! 스킬 폴더가 사라지는 것은 아니고, 목록에서 통째로 빠지면 사용자는 그 스킬이
//! 왜 안 걸리는지 영영 못 본다.

/// frontmatter 에서 뽑아낸 것. 부재·파싱 실패는 전부 기본값이다 —
/// frontmatter 가 깨졌다고 스킬이 무효인 것은 아니다.
#[derive(Debug, Default, PartialEq)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub keywords: Vec<String>,
    pub user_invoked: bool,
}

/// frontmatter 를 관대하게 추출한다.
/// 파싱 실패·부재 시 None — 스킬 자체는 유효할 수 있으므로 에러로 만들지 않는다.
///
/// `keywords` 는 Osaurus 라운드 Phase 5 (`#skill-keywords`) 에서 더했다. 능력
/// 검색은 **이름·설명·키워드만** 색인하고 지시문 본문은 색인하지 않으므로,
/// "사용자가 실제로 말할 단어" 를 여기 적어 두는 것이 도달 가능성을 정한다.
/// 리스트(`[a, b]`)와 쉼표 문자열(`"a, b"`) 둘 다 받는다 — 사람이 손으로 쓰는
/// 필드라 한쪽만 받으면 조용히 비어 버린다.
pub fn parse_frontmatter(content: &str) -> Frontmatter {
    let rest = match content.strip_prefix("---") {
        Some(r) => r,
        None => return Frontmatter::default(),
    };
    let Some(end) = rest.find("\n---") else {
        return Frontmatter::default();
    };
    let yaml: serde_yaml::Value = match serde_yaml::from_str(&rest[..end]) {
        Ok(v) => v,
        Err(_) => return Frontmatter::default(),
    };
    let get = |key: &str| {
        yaml.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let keywords = match yaml.get("keywords") {
        Some(serde_yaml::Value::Sequence(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Some(serde_yaml::Value::String(raw)) => raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    };
    // 사람이 손으로 쓰는 필드라 `true` 와 `"true"` 를 둘 다 받는다 — YAML 은
    // 따옴표가 붙는 순간 문자열이 되고, 한쪽만 받으면 조용히 false 가 된다.
    let user_invoked = match yaml.get("disable-model-invocation") {
        Some(serde_yaml::Value::Bool(b)) => *b,
        Some(serde_yaml::Value::String(raw)) => {
            matches!(raw.trim().to_ascii_lowercase().as_str(), "true" | "yes")
        }
        _ => false,
    };
    Frontmatter {
        name: get("name"),
        description: get("description"),
        keywords,
        user_invoked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_parse_is_lenient() {
        assert_eq!(parse_frontmatter("no frontmatter"), Frontmatter::default());
        assert_eq!(
            parse_frontmatter("---\nname: a\n---\n"),
            Frontmatter {
                name: Some("a".into()),
                ..Default::default()
            }
        );
        let fm = parse_frontmatter("---\nname: a\ndescription: \"b c\"\nextra: 1\n---\nbody");
        assert_eq!(
            (fm.name, fm.description),
            (Some("a".into()), Some("b c".into()))
        );
        // 깨진 YAML → 기본값 폴백 (에러 아님).
        assert_eq!(
            parse_frontmatter("---\n{invalid\n---\n"),
            Frontmatter::default()
        );
    }

    /// `#skill-invocation` — 사용자 발동 스킬은 에이전트 사정권 밖이라 "안 걸림"
    /// 배지가 결함이 아니라 정상이다. 그 사실이 목록에 닿으려면 여기서 읽혀야 한다.
    /// YAML 은 따옴표가 붙는 순간 문자열이 되므로 두 모양을 다 받는다.
    #[test]
    fn disable_model_invocation_accepts_bool_and_string() {
        let cases = [
            ("---\nname: a\ndisable-model-invocation: true\n---\n", true),
            (
                "---\nname: a\ndisable-model-invocation: \"true\"\n---\n",
                true,
            ),
            ("---\nname: a\ndisable-model-invocation: yes\n---\n", true),
            (
                "---\nname: a\ndisable-model-invocation: false\n---\n",
                false,
            ),
            ("---\nname: a\n---\n", false),
        ];
        for (raw, expected) in cases {
            assert_eq!(
                parse_frontmatter(raw).user_invoked,
                expected,
                "frontmatter: {raw:?}"
            );
        }
    }

    /// Phase 5 `#skill-keywords` — 사람이 손으로 쓰는 필드라 리스트와 쉼표
    /// 문자열을 둘 다 받는다. 한쪽만 받으면 조용히 비어 버린다.
    #[test]
    fn keywords_accept_both_yaml_shapes() {
        let list =
            parse_frontmatter("---\nname: a\nkeywords: [요약, tldr, 핵심]\n---\nbody").keywords;
        assert_eq!(list, vec!["요약", "tldr", "핵심"]);
        let csv =
            parse_frontmatter("---\nname: a\nkeywords: \"요약, tldr , 핵심\"\n---\n").keywords;
        assert_eq!(csv, vec!["요약", "tldr", "핵심"]);
        assert!(parse_frontmatter("---\nname: a\n---\n").keywords.is_empty());
    }
}
