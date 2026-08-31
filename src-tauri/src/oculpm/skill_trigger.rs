//! AD-5 — 트리거 교정 (docs/agent-discipline/00-master-plan.md D2 존 3).
//!
//! 실측(2026-08-29): `Skill` 도구 발동 11회 / 136 세션. 스킬은 **없어서** 안
//! 걸리는 게 아니라 **description 이 안 걸려서** 안 걸린다 — Claude Code 는
//! frontmatter 의 영문 `description` 하나로 발동을 판단하는데, 사람이 그걸 잘
//! 썼는지 알 방법이 지금까지 없었다(F4). 원장이 "이 스킬 30일 0회" 를 말할 수
//! 있게 된 뒤에야 이 제안이 성립한다.
//!
//! 여기서 하는 일은 **description 한 줄의 재작성 초안**뿐이다. 본문은 건드리지
//! 않고, 파일도 쓰지 않는다 — 저장은 프런트가 승인 후 기존 `skills_save` 로
//! 한다 (draft=AI, decision=사람).

use serde::Serialize;

/// 초안 — 프런트가 그대로 그리고, 승인 시 `content` 를 저장한다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SkillTriggerDraft {
    pub dir_name: String,
    /// 지금 frontmatter 에 있는 description (없으면 빈 문자열).
    pub current: String,
    /// 제안된 새 description.
    pub proposed: String,
    /// 왜 이렇게 바꾸는지 한두 줄 (한국어 UI 에 그대로 보인다).
    pub rationale: String,
    /// 저장용 SKILL.md 전문 — **description 행만 교체**하고 나머지는 바이트 보존.
    pub content: String,
}

pub const TRIGGER_SYSTEM_PROMPT: &str = "\
You rewrite the `description` field of a Claude Code SKILL.md so the agent \
actually triggers it. The description is the ONLY signal the agent uses to \
decide whether to load a skill.

Rules for the new description:
- English, one line, 15-40 words, no line breaks.
- Start with concrete trigger conditions: \"Use when …\" / \"Use for …\".
- Name the artifacts, commands, file types, or user phrasings that should fire it.
- Describe WHEN to use it, not what the skill contains.
- Never invent capabilities the body does not have.

Reply with JSON only, no prose and no code fence:
{\"description\": \"...\", \"why\": \"...\"}
`why` is one short sentence in the same language as the skill body, explaining \
what was missing from the old description.";

/// 본문 발췌 상한 — 프롬프트 비용을 묶는다 (스킬 본문은 수십 KB 가 될 수 있다).
const BODY_EXCERPT_BYTES: usize = 2400;

/// LLM 에 넘길 사용자 메시지. 본문은 앞부분만 잘라 넣는다.
pub fn build_prompt(dir_name: &str, current: &str, body: &str) -> String {
    let mut excerpt = String::new();
    for ch in body.chars() {
        if excerpt.len() + ch.len_utf8() > BODY_EXCERPT_BYTES {
            break;
        }
        excerpt.push(ch);
    }
    format!(
        "skill folder: {dir_name}\ncurrent description: {}\n\n--- SKILL.md body (excerpt) ---\n{}\n",
        if current.is_empty() { "(empty)" } else { current },
        excerpt.trim_end(),
    )
}

/// 응답에서 JSON 객체를 관대하게 건져 `(description, why)` 로 판다.
/// 코드펜스·서두 잡담은 첫 `{` ~ 마지막 `}` 로 넘긴다.
pub fn parse_response(response: &str) -> Result<(String, String), String> {
    let start = response
        .find('{')
        .ok_or_else(|| "The rewrite response had no JSON object".to_string())?;
    let end = response
        .rfind('}')
        .ok_or_else(|| "The rewrite response had no JSON object".to_string())?;
    if end <= start {
        return Err("The rewrite response had no JSON object".into());
    }
    let value: serde_json::Value = serde_json::from_str(&response[start..=end])
        .map_err(|e| format!("Could not parse the rewrite response: {e}"))?;
    let text = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|s| !s.is_empty())
    };
    let description =
        text("description").ok_or_else(|| "The rewrite has an empty description".to_string())?;
    Ok((description, text("why").unwrap_or_default()))
}

/// frontmatter 의 `description:` **한 줄만** 갈아 끼운다 — 다른 키·본문은
/// 바이트 그대로 보존한다 (`rulesModel.setRulePaths` 와 같은 규율).
///
/// 블록 스칼라(`description: |`)는 건드리지 않고 거부한다: 여러 줄을 안전하게
/// 자르려면 YAML 을 재직렬화해야 하는데, 그러면 사용자의 다른 키 서식이 깨진다.
pub fn replace_description(content: &str, description: &str) -> Result<String, String> {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.first().map(|l| l.trim_end()) != Some("---") {
        return Err("This skill has no frontmatter, so there is no description to rewrite".into());
    }
    let close = lines
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, l)| l.trim_end() == "---")
        .map(|(i, _)| i)
        .ok_or_else(|| "The skill frontmatter was never closed".to_string())?;

    let quoted = serde_json::to_string(description.trim())
        .map_err(|e| format!("Could not encode the description: {e}"))?;
    let rendered = format!("description: {quoted}");

    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 1);
    let mut replaced = false;
    for (i, line) in lines.iter().enumerate() {
        if i > 0 && i < close && !replaced {
            if let Some(rest) = line.strip_prefix("description:") {
                let rest = rest.trim();
                if rest == "|" || rest == ">" || rest.starts_with("|-") || rest.starts_with(">-") {
                    return Err(
                        "This skill's description is a multi-line YAML block - edit it by hand"
                            .into(),
                    );
                }
                out.push(rendered.clone());
                replaced = true;
                continue;
            }
        }
        out.push((*line).to_string());
    }
    if !replaced {
        // description 이 아예 없던 스킬 — 닫는 `---` 바로 앞에 새로 넣는다.
        out.insert(close, rendered);
    }
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str =
        "---\nname: run-evals\ndescription: \"old\"\nother: keep\n---\n\n# run-evals\n\n본문\n";

    #[test]
    fn replaces_only_the_description_line() {
        let out =
            replace_description(SKILL, "Use when finishing a feature to score EVALS.md").unwrap();
        assert!(out.contains("description: \"Use when finishing a feature to score EVALS.md\""));
        assert!(out.contains("name: run-evals"));
        assert!(out.contains("other: keep"));
        assert!(out.contains("# run-evals\n\n본문"));
        assert!(!out.contains("\"old\""));
    }

    #[test]
    fn inserts_when_the_skill_had_no_description() {
        let src = "---\nname: x\n---\n\n# x\n";
        let out = replace_description(src, "Use when x").unwrap();
        assert_eq!(
            out,
            "---\nname: x\ndescription: \"Use when x\"\n---\n\n# x\n"
        );
    }

    #[test]
    fn refuses_block_scalars_and_missing_frontmatter() {
        assert!(
            replace_description("---\nname: x\ndescription: |\n  a\n  b\n---\n#x\n", "y").is_err()
        );
        assert!(replace_description("# no frontmatter\n", "y").is_err());
        assert!(replace_description("---\nname: x\n", "y").is_err());
    }

    #[test]
    fn quotes_are_escaped_so_the_yaml_stays_valid() {
        let out = replace_description(SKILL, "Use when the \"final\" review runs").unwrap();
        assert!(out.contains(r#"description: "Use when the \"final\" review runs""#));
    }

    #[test]
    fn parses_json_out_of_a_fenced_reply() {
        let (desc, why) = parse_response(
            "```json\n{\"description\": \"Use when\\n reviewing\", \"why\": \"너무 모호했다\"}\n```",
        )
        .unwrap();
        assert_eq!(desc, "Use when reviewing");
        assert_eq!(why, "너무 모호했다");
        assert!(parse_response("no json here").is_err());
        assert!(parse_response("{\"why\": \"x\"}").is_err());
    }

    #[test]
    fn prompt_caps_the_body_excerpt() {
        let body = "가".repeat(4000);
        let prompt = build_prompt("x", "", &body);
        assert!(prompt.len() < BODY_EXCERPT_BYTES + 400, "{}", prompt.len());
    }
}
