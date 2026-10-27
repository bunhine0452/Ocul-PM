//! 읽기 전용 복구 — 규격을 어긴 일지를 **디스크는 그대로 둔 채** 읽는다.
//!
//! 두 가지만 한다 (실측 2026-10-27, 캐시의 `parse_ok=0` 12건 전부가 이 둘이었다):
//! `type` 의 커밋 타입 어휘(fix·feat…)를 규격 값으로 읽고, `path:` 값에 YAML
//! 지시 문자(`[` `{` `:` `#`)가 따옴표 없이 들어간 줄을 감싼다. 둘 다 경고를 남겨
//! 어느 에이전트가 규격을 어기는지 보이게 한다. 포매터가 아니다 — 고칠 줄만 건드린다.

use serde_yaml::Value as YamlValue;

use crate::oculpm::spec::EntryType;

/// YAML 을 읽고, 깨지면 **한 번만** 고쳐 다시 읽는다. 고쳐도 안 읽히면 원래 오류를
/// 경고로 남기고 `None`. `path:` 값에 `[`·`{`·`:`·`#` 가 들어가면 사람이 쓴 YAML 은
/// 거의 늘 따옴표를 빠뜨린다 (실측: `{ path: app/[locale]/x.ts, op: update }`).
pub(crate) fn parse_yaml_lenient(yaml: &str, warnings: &mut Vec<String>) -> Option<YamlValue> {
    match serde_yaml::from_str::<YamlValue>(yaml) {
        Ok(value) => Some(value),
        Err(e) => match repair_unquoted_paths(yaml)
            .and_then(|fixed| serde_yaml::from_str::<YamlValue>(&fixed).ok())
        {
            Some(value) => {
                warnings.push(
                    "yaml repaired: unquoted path value(s) in files_touched — quote paths that contain [ ] { } : #"
                        .to_string(),
                );
                Some(value)
            }
            None => {
                warnings.push(format!("yaml parse error: {e}"));
                None
            }
        },
    }
}

/// 규격 값을 먼저, 그다음 별칭 — 별칭이면 경고를 남긴다. 커밋 타입 어휘로 쓴 일지는
/// 읽는다 (실측 12건 중 10건이 이 한 가지였다). 경고는 스탠드업·정직성 패널이
/// 어느 에이전트가 규격을 어기는지 볼 수 있게 한다.
pub(crate) fn parse_entry_type_lenient(s: &str, warnings: &mut Vec<String>) -> Option<EntryType> {
    if let Some(t) = super::parse_entry_type(s) {
        return Some(t);
    }
    let t = entry_type_alias(s)?;
    warnings.push(format!(
        "type '{s}' read as '{}' (alias)",
        format!("{t:?}").to_ascii_lowercase()
    ));
    Some(t)
}

/// 규격 밖이지만 뜻이 하나뿐인 `type` 어휘 — git 커밋 타입(conventional commits)과
/// 그 변형. `perf` 는 리팩토링인지 기능인지 갈려 받지 않는다.
fn entry_type_alias(s: &str) -> Option<EntryType> {
    match s.trim().to_ascii_lowercase().as_str() {
        "fix" | "bugfix" | "hotfix" | "bugs" => Some(EntryType::Bug),
        "feat" | "features" | "feature_to_add" | "features_to_add" => Some(EntryType::Feature),
        "err" | "errors" => Some(EntryType::Error),
        "refactoring" | "refactors" => Some(EntryType::Refactor),
        "chores" | "docs" | "doc" | "test" | "tests" | "ci" | "build" | "style" => {
            Some(EntryType::Chore)
        }
        _ => None,
    }
}

/// `path:` 값에 YAML 지시 문자가 섞인 줄만 따옴표로 감싼다. 바뀐 게 없으면 `None`.
///
/// 두 모양만 본다 — 플로 매핑 `{ path: a/[x]/b.ts, op: update }` 와 블록 항목
/// `- path: a/[x]/b.ts`. 이미 따옴표가 있거나 지시 문자가 없으면 그대로 둔다.
/// 다른 키·다른 줄은 손대지 않는다 — 이건 복구이지 포매터가 아니다.
pub(crate) fn repair_unquoted_paths(yaml: &str) -> Option<String> {
    let mut changed = false;
    let mut out = String::with_capacity(yaml.len() + 16);
    for (i, line) in yaml.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        match repair_path_line(line) {
            Some(fixed) => {
                changed = true;
                out.push_str(&fixed);
            }
            None => out.push_str(line),
        }
    }
    changed.then_some(out)
}

fn repair_path_line(line: &str) -> Option<String> {
    let key_at = line.find("path:")?;
    // `path:` 가 키 자리인지 — 앞은 공백·`-`·`{`·`,` 만 허용.
    if !line[..key_at]
        .chars()
        .all(|c| c.is_whitespace() || matches!(c, '-' | '{' | ','))
    {
        return None;
    }
    let value_start = key_at + "path:".len();
    let rest = &line[value_start..];
    let trimmed = rest.trim_start();
    let pad = rest.len() - trimmed.len();
    if trimmed.is_empty() || trimmed.starts_with('"') || trimmed.starts_with('\'') {
        return None;
    }
    let in_flow = line[..key_at].contains('{');
    // 값의 끝 — 플로면 `,` 나 `}` 앞까지, 블록이면 줄 끝까지 (뒤 공백 제외).
    let value_end = if in_flow {
        trimmed.find([',', '}']).unwrap_or(trimmed.len())
    } else {
        trimmed.len()
    };
    let value = trimmed[..value_end].trim_end();
    if value.is_empty() {
        return None;
    }
    let needs_quote = if in_flow {
        value.contains(['[', ']', '{', '}', '#']) || value.contains(": ")
    } else {
        value.starts_with(['[', '{', '*', '&', '!', '%', '@', '`'])
            || value.contains(" #")
            || value.contains(": ")
    };
    if !needs_quote {
        return None;
    }
    let quoted = format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
    let tail = &trimmed[value_end..];
    Some(format!(
        "{}{}{}{}",
        &line[..value_start],
        &rest[..pad],
        quoted,
        tail
    ))
}
