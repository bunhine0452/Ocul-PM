//! 도구 인자를 한 번에 맞게 받는다 (love-round-20261123 #mcp-arg-forgiveness).
//!
//! 실측(이 저장소 세션 691 호출 중 실패 21): `journal_write` 실패 9건이 전부 필수 인자 누락이었고, 그
//! 호출들의 키는 모두 `body` 였다(`body_markdown` 이 아니라). 도구가 필수 인자를 하나씩 `ok_or` 로 검사해
//! 첫 누락만 영어로 돌려줬으므로, `body` 로 보낸 에이전트는 「'slug' is required」 를 받고 slug 를 더해
//! 다시 보낸 뒤에야 「'body_markdown' is required」 를 받았다 — 왕복이 두 번이다.
//!
//! 그래서 셋을 한 자리에서 한다:
//! - 흔한 동의어(`body` → `body_markdown`)는 **받아들이고** 응답의 `received` 로 「이렇게 받았다」 고 알린다.
//!   조용히 받으면 에이전트는 틀린 이름을 계속 쓰고, 다음 서버 판이 그 이름을 버리면 다시 깨진다.
//! - 빠진 필수 인자는 **전부** 한 문장으로, 각 인자의 스키마 설명 한 토막을 붙여 돌려준다.
//! - 모르는 키는 거절하지 않고 `warnings` 로 알린다 (버려진 것을 버려졌다고 말한다).

use serde_json::Value;

/// 받은 인자를 동의어까지 풀어 고친 사본 + 무엇을 어떻게 받았는지.
pub(super) struct Normalized {
    pub args: Value,
    /// 「`body` 를 `body_markdown` 으로 받았어요」 같은 알림 — 성공 응답의 `received`.
    pub received: Vec<String>,
}

/// `(동의어, 정식 이름)` 표대로 인자를 옮긴다. 정식 이름이 이미 있으면 동의어는 손대지 않는다
/// (둘 다 준 호출은 정식 이름이 이긴다 — 모르는 키 경고가 동의어를 짚는다).
pub(super) fn normalize(args: &Value, aliases: &[(&str, &str)], en: bool) -> Normalized {
    let mut out = match args {
        Value::Object(_) => args.clone(),
        _ => Value::Object(Default::default()),
    };
    let mut received = Vec::new();
    let Some(map) = out.as_object_mut() else {
        return Normalized {
            args: out,
            received,
        };
    };
    for (alias, canon) in aliases {
        if map.contains_key(*canon) {
            continue;
        }
        if let Some(v) = map.remove(*alias) {
            map.insert((*canon).to_string(), v);
            received.push(if en {
                format!("took `{alias}` as `{canon}` — use `{canon}` next time")
            } else {
                format!("`{alias}` 를 `{canon}` 으로 받았어요 — 다음엔 `{canon}` 으로")
            });
        }
    }
    Normalized {
        args: out,
        received,
    }
}

/// 비었거나 없는 필수 인자들 (문자열은 공백만 있어도 빈 것, 배열은 원소가 없으면 빈 것).
pub(super) fn missing<'a>(args: &Value, required: &[&'a str]) -> Vec<&'a str> {
    required
        .iter()
        .copied()
        .filter(|k| match args.get(*k) {
            None | Some(Value::Null) => true,
            Some(Value::String(s)) => s.trim().is_empty(),
            Some(Value::Array(a)) => a.is_empty(),
            Some(_) => false,
        })
        .collect()
}

/// 스키마의 `properties` 에 없는 키들. `extra` 는 스키마 밖이지만 받는 이름(동의어 등)이다.
pub(super) fn unknown_keys(args: &Value, schema: &Value, extra: &[&str]) -> Vec<String> {
    let props = schema.pointer("/inputSchema/properties");
    let Some(map) = args.as_object() else {
        return Vec::new();
    };
    map.keys()
        .filter(|k| props.and_then(|p| p.get(k.as_str())).is_none())
        .filter(|k| !extra.contains(&k.as_str()))
        .cloned()
        .collect()
}

/// 모르는 키를 버렸다는 경고 한 줄.
pub(super) fn unknown_warning(unknown: &[String], en: bool) -> Option<String> {
    if unknown.is_empty() {
        return None;
    }
    let list = unknown
        .iter()
        .map(|k| format!("`{k}`"))
        .collect::<Vec<_>>()
        .join(" · ");
    Some(if en {
        format!("ignored unknown argument(s) {list} — see the tool schema for the names it reads")
    } else {
        format!("모르는 인자 {list} 는 버렸어요 — 도구 스키마의 이름을 보세요")
    })
}

/// 빠진 필수 인자 전부를 한 문장으로 — 인자마다 스키마 설명의 첫 토막을 붙인다.
pub(super) fn missing_error(tool: &str, missing: &[&str], schema: &Value, en: bool) -> String {
    let parts = missing
        .iter()
        .map(|k| {
            let hint = schema
                .pointer(&format!("/inputSchema/properties/{k}/description"))
                .and_then(Value::as_str)
                .map(first_clause)
                .filter(|h| !h.is_empty());
            match hint {
                Some(h) => format!("`{k}` ({h})"),
                None => format!("`{k}`"),
            }
        })
        .collect::<Vec<_>>()
        .join(" · ");
    if en {
        format!(
            "{tool}: missing {} required argument(s) — {parts}. Fill them all and call again (nothing was written).",
            missing.len()
        )
    } else {
        format!(
            "{tool}: 필수 인자 {}개가 없어요 — {parts}. 한 번에 모두 채워 다시 불러 주세요 (아무것도 쓰지 않았어요).",
            missing.len()
        )
    }
}

/// 설명의 첫 토막 — 첫 줄표 · 괄호 · 문장 끝 앞, 60자 안. 강조 표시(`**`)는 뗀다. 마침표는 뒤에 공백이
/// 있을 때만 끊는다 — `.oculpm/` 같은 경로 안의 점에서 자르면 토막이 뜻을 잃는다.
fn first_clause(desc: &str) -> String {
    let d = desc.replace("**", "");
    let cut = [" — ", " (", ". ", "\n"]
        .iter()
        .filter_map(|sep| d.find(sep))
        .min()
        .map(|i| &d[..i])
        .unwrap_or(&d)
        .trim();
    cut.chars().take(60).collect::<String>().trim().to_string()
}

/// 이 프로젝트의 규칙 언어가 영어인가 — 거절 문구의 언어다 (`title.rs` 와 같은 판정).
pub(super) fn project_en(root: &std::path::Path) -> bool {
    super::load_config(root).agents.template_language == "en"
}

/// `tools/list` 의 정의 하나 — 거절 문구가 스키마 설명을 빌린다.
pub(super) fn definition_of(name: &str) -> Value {
    super::tool_definitions()
        .as_array()
        .and_then(|list| list.iter().find(|t| t["name"] == name).cloned())
        .unwrap_or(Value::Null)
}
