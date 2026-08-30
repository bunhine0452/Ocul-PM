//! In-app AI plan refresh — prompt + tolerant parse of the model's reply
//! (PR-PLN 5). The LLM proposes status updates; the command applies them via the
//! same `plan_edit` primitives, stamping `agent_id = inapp:<provider>`. Only the
//! parse is here (pure + testable); the network call lives in `commands/plan.rs`.

#![allow(dead_code)]

/// One status edit the model asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiEdit {
    pub item_id: String,
    pub status: String,
}

/// System prompt: constrain the model to a JSON array of `{item_id, status}`.
pub const SYSTEM_PROMPT: &str = r#"You update a developer's project plan from recent work signals.
You receive the plan's items (each with a {#id} and current status) and the
recent work-journal entries. Decide which items' status should change based on
the journal, and output ONLY a JSON array:

[{"item_id": "<id without #>", "status": "<new status>"}]

- status ∈ todo | in_progress | done | blocked | deferred | dropped.
- Include an item ONLY if its status should change. If nothing changes, output [].
- Never invent item ids — use only the ids given.
- Output the JSON array and nothing else (no prose, no code fence)."#;

/// Build the user message from the plan + journal context.
pub fn build_user_prompt(plan_title: &str, items_block: &str, journal_block: &str) -> String {
    format!(
        "계획: {plan_title}\n\n=== 항목 (현재 상태) ===\n{items}\n\n=== 최근 작업 일지 ===\n{journal}\n\n위 일지를 근거로 상태가 바뀌어야 하는 항목만 JSON 배열로 출력하세요.",
        plan_title = plan_title,
        items = if items_block.is_empty() { "(없음)" } else { items_block },
        journal = if journal_block.is_empty() { "(없음)" } else { journal_block },
    )
}

/// Tolerantly parse the model reply into edits. Strips code fences and pulls the
/// first `[ … ]` array; anything malformed yields an empty list (fail-soft).
pub fn parse_ai_edits(text: &str) -> Vec<AiEdit> {
    let json = extract_json_array(text);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else {
        return Vec::new();
    };
    let Some(arr) = value.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|e| {
            let obj = e.as_object()?;
            let item_id = obj
                .get("item_id")?
                .as_str()?
                .trim()
                .trim_start_matches('#')
                .to_string();
            let status = obj.get("status")?.as_str()?.trim().to_string();
            if item_id.is_empty() || status.is_empty() {
                return None;
            }
            Some(AiEdit { item_id, status })
        })
        .collect()
}

fn extract_json_array(text: &str) -> String {
    let t = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    match (t.find('['), t.rfind(']')) {
        (Some(s), Some(e)) if e >= s => t[s..=e].to_string(),
        _ => t.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_array() {
        let r = parse_ai_edits(
            r##"[{"item_id":"abs","status":"done"},{"item_id":"#two","status":"in_progress"}]"##,
        );
        assert_eq!(
            r,
            vec![
                AiEdit {
                    item_id: "abs".into(),
                    status: "done".into()
                },
                AiEdit {
                    item_id: "two".into(),
                    status: "in_progress".into()
                },
            ]
        );
    }

    #[test]
    fn strips_code_fence_and_prose() {
        let r = parse_ai_edits(
            "여기 결과:\n```json\n[{\"item_id\":\"x\",\"status\":\"done\"}]\n```\n끝",
        );
        assert_eq!(
            r,
            vec![AiEdit {
                item_id: "x".into(),
                status: "done".into()
            }]
        );
    }

    #[test]
    fn empty_array_and_junk_are_safe() {
        assert!(parse_ai_edits("[]").is_empty());
        assert!(parse_ai_edits("not json at all").is_empty());
        assert!(parse_ai_edits("").is_empty());
        // missing keys skipped
        assert!(parse_ai_edits(r#"[{"item_id":"x"},{"status":"done"}]"#).is_empty());
    }
}
