//! 에이전트·모델 이름의 표준형 — **읽을 때만** 적용한다.
//!
//! 실측 2026-10-27: 일지 3,900건에 같은 모델이 30가지 넘는 표기로 적혀 있었다
//! (`Opus 5 (1M context)` · `claude-opus-5[1m]` · `Opus 5 (1M)` · `claude-opus-5` …),
//! 터미널 세션 id 가 에이전트 id 자리에 들어간 것(`codex-term-57032`)도 있었다.
//! 「어느 에이전트가 어느 모델로」 통계가 그대로 갈라졌다.
//!
//! 디스크(frontmatter)는 에이전트가 적은 그대로 둔다 — 이 모듈은 캐시 투영에서만
//! 쓰고, 못 읽는 표기는 원문을 돌려준다. 값을 만들어 내지 않는다.

/// 패밀리 뒤에 붙는 변형 어휘 — 이것만 이름에 남긴다. 나머지 꼬리(`context` ·
/// `감독` · `구현 세션`)는 버린다.
const VARIANTS: &[&str] = &["flash", "pro", "mini", "nano", "thinking", "luna", "terra"];

/// `(토큰, 표시 이름)` — 표시 이름이 대소문자의 정답이다.
const FAMILIES: &[(&str, &str)] = &[
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
    ("fable", "Fable"),
    ("mythos", "Mythos"),
    ("gpt", "GPT"),
    ("gemini", "Gemini"),
    ("codex", "Codex"),
    ("kimi", "Kimi"),
    ("deepseek", "DeepSeek"),
    ("qwen", "Qwen"),
    ("llama", "Llama"),
    ("mistral", "Mistral"),
];

/// `claude-code-term-34061` → `claude-code`. 터미널이 세션마다 붙인 꼬리는 에이전트가
/// 아니다. 다른 모양은 그대로.
pub fn canonical_agent_id(raw: &str) -> String {
    let s = raw.trim();
    if let Some(idx) = s.find("-term-") {
        let head = &s[..idx];
        let tail = &s[idx + "-term-".len()..];
        if !head.is_empty() && !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            return head.to_string();
        }
    }
    s.to_string()
}

/// 모델 표기 하나를 `Family version [Variant] [(1M)]` 로. 패밀리를 못 찾으면 `None` —
/// 호출측은 원문을 쓴다.
pub fn canonical_model(raw: &str) -> Option<String> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    // `[`·`(`·`/` 는 꼬리의 시작이자 토큰 경계다. `.` 은 버전 안에서만 산다.
    let tokens: Vec<&str> = lower
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
        .filter(|t| !t.is_empty())
        .collect();
    let (fi, family) = tokens
        .iter()
        .enumerate()
        .find_map(|(i, t)| FAMILIES.iter().find(|(k, _)| k == t).map(|(_, d)| (i, *d)))?;

    let mut version = String::new();
    let mut variant: Option<&str> = None;
    let mut long_context = tokens.contains(&"1m");
    let mut i = fi + 1;
    // 패밀리 바로 뒤의 숫자 토큰들이 버전이다. `opus-5-5` 처럼 쪼개진 것은 `.` 로
    // 잇되, 이미 `.` 이 든 것(`4.8`) 뒤의 숫자는 꼬리(컨텍스트 창 등)로 본다.
    while i < tokens.len() {
        let t = tokens[i];
        let numeric = t.chars().all(|c| c.is_ascii_digit() || c == '.')
            && t.chars().any(|c| c.is_ascii_digit());
        if numeric && t != "1" {
            if version.is_empty() {
                version.push_str(t.trim_end_matches('.'));
            } else if !version.contains('.') && !t.contains('.') {
                version.push('.');
                version.push_str(t);
            } else {
                break;
            }
            i += 1;
            continue;
        }
        if t == "1m" {
            long_context = true;
            i += 1;
            continue;
        }
        if let Some(v) = VARIANTS.iter().find(|v| **v == t) {
            variant = Some(v);
            i += 1;
            continue;
        }
        break;
    }
    // 패밀리와 숫자가 붙어 있는 표기 (`gpt6` · `o3`)는 패밀리 토큰 자체에 숫자가 없으니
    // 여기 오지 않는다 — FAMILIES 가 정확히 일치하는 토큰만 받기 때문이다.
    let mut out = family.to_string();
    if !version.is_empty() {
        if family == "GPT" {
            out.push('-');
        } else {
            out.push(' ');
        }
        out.push_str(&version);
    }
    if let Some(v) = variant {
        out.push(' ');
        let mut cs = v.chars();
        if let Some(c) = cs.next() {
            out.extend(c.to_uppercase());
            out.push_str(cs.as_str());
        }
    }
    if long_context {
        out.push_str(" (1M)");
    }
    Some(out)
}

/// 캐시 투영용 — 못 읽으면 원문(trim)을 돌려준다.
pub fn display_model(raw: &str) -> String {
    canonical_model(raw).unwrap_or_else(|| raw.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 실제 캐시에 있던 표기들 — 같은 모델은 같은 이름이 돼야 한다.
    #[test]
    fn the_thirty_spellings_collapse() {
        for raw in [
            "Opus 5 (1M context)",
            "claude-opus-5[1m]",
            "Opus 5 (1M)",
            "opus 5 1M",
        ] {
            assert_eq!(
                canonical_model(raw).as_deref(),
                Some("Opus 5 (1M)"),
                "{raw}"
            );
        }
        for raw in [
            "Opus 5",
            "claude-opus-5",
            "Opus 5 (감독)",
            "Opus 5 (구현 세션 s)",
        ] {
            assert_eq!(canonical_model(raw).as_deref(), Some("Opus 5"), "{raw}");
        }
        assert_eq!(
            canonical_model("claude-opus-5-5").as_deref(),
            Some("Opus 5.5")
        );
        assert_eq!(
            canonical_model("Opus 5.5 (1M)").as_deref(),
            Some("Opus 5.5 (1M)")
        );
        assert_eq!(
            canonical_model("Opus 4.8 (1M context)").as_deref(),
            Some("Opus 4.8 (1M)")
        );
        assert_eq!(
            canonical_model("claude-fable-5").as_deref(),
            Some("Fable 5")
        );
        assert_eq!(canonical_model("Fable 5.1").as_deref(), Some("Fable 5.1"));
        assert_eq!(canonical_model("Sonnet 5.5").as_deref(), Some("Sonnet 5.5"));
    }

    #[test]
    fn other_vendors_and_variants() {
        assert_eq!(canonical_model("GPT-6").as_deref(), Some("GPT-6"));
        assert_eq!(canonical_model("gpt-6").as_deref(), Some("GPT-6"));
        assert_eq!(canonical_model("GPT-6 Luna").as_deref(), Some("GPT-6 Luna"));
        assert_eq!(
            canonical_model("gpt-5.6-terra").as_deref(),
            Some("GPT-5.6 Terra")
        );
        assert_eq!(
            canonical_model("gemini-3.8-flash").as_deref(),
            Some("Gemini 3.8 Flash")
        );
        assert_eq!(canonical_model("gemini-pro").as_deref(), Some("Gemini Pro"));
        // 두 모델을 적은 것은 첫 모델로 — 감독/구현 꼬리는 버린다.
        assert_eq!(
            canonical_model("Fable 5.1 (감독) / Opus 5 (구현 세션 s)").as_deref(),
            Some("Fable 5.1")
        );
    }

    #[test]
    fn unknown_spellings_fall_back_to_the_raw_text() {
        assert_eq!(canonical_model("5"), None);
        assert_eq!(canonical_model(""), None);
        assert_eq!(canonical_model("my-local-model"), None);
        assert_eq!(display_model(" my-local-model "), "my-local-model");
    }

    #[test]
    fn terminal_session_suffixes_are_not_agents() {
        assert_eq!(canonical_agent_id("codex-term-57032"), "codex");
        assert_eq!(canonical_agent_id("claude-code-term-34061"), "claude-code");
        assert_eq!(canonical_agent_id("claude-code"), "claude-code");
        assert_eq!(canonical_agent_id("x-term-"), "x-term-");
        assert_eq!(canonical_agent_id("x-term-ab"), "x-term-ab");
    }
}
