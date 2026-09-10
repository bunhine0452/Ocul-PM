//! 시맨틱 토큰 — 서버가 아는 **의미**로 칠하는 문법 강조 {#cap-semantic}.
//!
//! Monarch(정규식 문법)는 `foo` 가 함수인지 변수인지 모른다. 언어 서버는 안다.
//! 그 차이를 화면으로 나르는 것이 이 모듈이고, 하는 일은 둘뿐이다 — 서버가
//! 광고한 **legend**(숫자 → 이름 표)를 읽고, `full` 응답의 숫자 배열을 넘긴다.
//!
//! 좌표를 여기서 풀지 않는다. 5칸 상대 좌표(줄 delta · 칸 delta · 길이 · 종류 ·
//! 수식어 비트)는 Monaco 가 그대로 먹는 모양이라, 중간에서 풀었다 다시 감으면
//! 어긋날 자리만 만든다.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

/// 우리가 "읽을 줄 안다" 고 서버에 알리는 시맨틱 토큰 종류 — LSP 3.17 표준 목록.
///
/// 서버는 이 목록을 참고만 하고 **자기 legend 를 따로 광고한다** (rust-analyzer 는
/// 여기 없는 `builtinType`·`lifetime` 을 낸다). 그래서 색칠은 서버 legend 로 하고,
/// 이 상수는 핸드셰이크에서 "표준 어휘는 안다" 를 말하는 자리일 뿐이다.
pub const SEMANTIC_TOKEN_TYPES: &[&str] = &[
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "typeParameter",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "event",
    "function",
    "method",
    "macro",
    "keyword",
    "modifier",
    "comment",
    "string",
    "number",
    "regexp",
    "operator",
    "decorator",
];

/// 같은 이유의 수식어 목록.
pub const SEMANTIC_TOKEN_MODIFIERS: &[&str] = &[
    "declaration",
    "definition",
    "readonly",
    "static",
    "deprecated",
    "abstract",
    "async",
    "modification",
    "documentation",
    "defaultLibrary",
];

/// 서버가 광고한 시맨틱 토큰 legend — 데이터의 숫자를 이름으로 되돌리는 표.
///
/// 화면(Monaco)이 이 표를 **먼저** 알아야 토큰을 해석할 수 있어서 데이터와
/// 따로 나른다. legend 는 서버 능력에 이미 들어 있으므로 이걸 읽는 데는
/// 요청이 한 번도 안 나간다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LspSemanticLegend {
    pub token_types: Vec<String>,
    pub token_modifiers: Vec<String>,
}

/// `semanticTokensProvider` 능력 → legend.
///
/// `full` 을 안 하는 서버는 `None` 이다 — 범위 요청만 되는 서버에 전체 문서를
/// 물으면 빈 답이 오고, 그러면 화면이 **문법 강조를 통째로 잃는다** (시맨틱
/// 토큰은 Monarch 위에 덮어쓰므로 빈 답이 곧 무채색이다). 종류가 하나도 없는
/// legend 도 같은 이유로 `None`.
pub fn legend_from_capability(cap: &Value) -> Option<LspSemanticLegend> {
    let full = cap.get("full");
    if matches!(full, None | Some(Value::Null) | Some(Value::Bool(false))) {
        return None;
    }
    let names = |key: &str| -> Vec<String> {
        cap.get("legend")
            .and_then(|l| l.get(key))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    let token_types = names("tokenTypes");
    if token_types.is_empty() {
        return None;
    }
    Some(LspSemanticLegend {
        token_types,
        token_modifiers: names("tokenModifiers"),
    })
}

/// `textDocument/semanticTokens/full` → 5개씩 묶인 상대 좌표 배열.
///
/// 다섯 칸(줄 delta · 칸 delta · 길이 · 종류 · 수식어 비트)이 한 토큰이라
/// 길이가 5의 배수가 아니면 마지막 조각을 버린다 — 반쪽 토큰을 넘기면 Monaco
/// 가 배열 끝을 넘어 읽는다.
pub fn tokens_from_json(result: &Value) -> Vec<u32> {
    let mut data: Vec<u32> = result
        .get("data")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|v| v.as_u64().unwrap_or(0) as u32).collect())
        .unwrap_or_default();
    let keep = data.len() - data.len() % 5;
    data.truncate(keep);
    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legend_reads_the_servers_own_vocabulary() {
        // rust-analyzer 는 표준에 없는 이름을 낸다 — 우리 상수가 아니라
        // 서버가 준 순서가 색칠의 기준이다.
        let cap = json!({
            "full": true,
            "legend": {
                "tokenTypes": ["comment", "keyword", "builtinType"],
                "tokenModifiers": ["declaration", "async"],
            },
        });
        let legend = legend_from_capability(&cap).unwrap();
        assert_eq!(legend.token_types, ["comment", "keyword", "builtinType"]);
        assert_eq!(legend.token_modifiers, ["declaration", "async"]);
    }

    /// 전체 문서를 못 주는 서버에 물으면 빈 답이 오고, 시맨틱 토큰은 Monarch
    /// 강조를 **덮으므로** 그 빈 답이 곧 무채색 화면이다. 아예 안 다는 게 맞다.
    #[test]
    fn legend_is_none_when_the_server_cannot_do_a_whole_file() {
        let range_only = json!({ "range": true, "legend": { "tokenTypes": ["keyword"] } });
        assert!(legend_from_capability(&range_only).is_none());
        let full_false = json!({ "full": false, "legend": { "tokenTypes": ["keyword"] } });
        assert!(legend_from_capability(&full_false).is_none());
        // 종류가 하나도 없는 표로는 어떤 숫자도 이름이 못 된다.
        let empty = json!({ "full": true, "legend": { "tokenTypes": [] } });
        assert!(legend_from_capability(&empty).is_none());
        // `full` 이 델타 지원을 담은 객체인 경우도 전체 요청은 된다.
        let obj = json!({ "full": { "delta": true }, "legend": { "tokenTypes": ["keyword"] } });
        assert!(legend_from_capability(&obj).is_some());
    }

    #[test]
    fn tokens_drop_a_half_written_tuple() {
        // 다섯 칸이 한 토큰이다 — 반쪽을 넘기면 화면이 배열 끝을 넘어 읽는다.
        let r = json!({ "data": [0, 0, 4, 1, 0, 1, 2] });
        assert_eq!(tokens_from_json(&r), vec![0, 0, 4, 1, 0]);
        assert!(tokens_from_json(&json!(null)).is_empty());
        assert!(tokens_from_json(&json!({ "data": [] })).is_empty());
    }
}
