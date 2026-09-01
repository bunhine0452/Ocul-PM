//! 선언적 설정 문서 `oculpm_config: v1` (Osaurus 라운드 Phase 6 #config-schema).
//!
//! 설정을 **원하는 상태(desired state)** 로 적은 YAML 한 장이다. 소스컨트롤에
//! 올려 팀이 같은 앱 설정을 쓰게 하는 것이 목적이라 두 규약이 절대적이다:
//!
//! 1. **시크릿은 절대 들어가지 않는다.** API 키는 OS 키체인에 살고
//!    (`secrets.rs`) `settings` 표에 없다. 그래도 방어적으로 [`is_secret_key`]
//!    로 한 겹 더 막는다 — 나중에 누가 키를 settings 에 넣어도 export 를
//!    타고 나가지 않는다.
//! 2. **문서는 자기가 이름 붙인 것만 소유한다.** 여기 없는 설정 키는 "지워야
//!    할 것" 이 아니라 "이 문서가 말하지 않는 것" 이다. 그래서 apply 는
//!    추가·변경만 하고 삭제하지 않는다.
//!
//! 규칙·스킬·자동화 절은 **해시로 존재와 표류만** 적는다 (D11) — 내용은
//! 싣지 않는다. 세 아티팩트 전부 온디스크가 SSOT 이고 git 이 이미 내용을
//! 나르므로, YAML 이 내용을 또 나르면 SSOT 가 둘이 된다.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

/// 문서 최상단 마커 키.
pub const SCHEMA_KEY: &str = "oculpm_config";
/// 이 앱이 읽고 쓰는 문서 버전.
pub const SCHEMA_VERSION: &str = "v1";

/// 값이 시크릿일 수 있음을 알리는 키 조각. 하나라도 걸리면 export 에서 빠지고
/// apply 에서 거절된다 — settings 표에 시크릿이 없다는 전제가 언젠가 깨져도
/// 문서로 새 나가지 않게 하는 두 번째 자물쇠다.
pub const SECRET_KEY_MARKERS: &[&str] = &[
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "credential",
];

/// 기계 상태라서 문서에 담지 않는 설정 키 (완전 일치 또는 `.` 접두).
/// 값 자체가 이 머신에서만 뜻이 있어 옮기면 오히려 틀린다.
pub const LOCAL_ONLY_KEYS: &[&str] = &[
    // 마지막으로 본 앱 버전 — 릴리스 노트 카드 상태.
    "last_seen_version",
    // 배경 모델 1회 시드 표식 — 안내 카드가 닫히면 비워진다.
    "core_model_seeded",
    // 프로젝트 id 로 키가 매겨진다 — id 는 머신마다 다르다.
    "project_instructions.",
];

/// 설정 키가 시크릿일 수 있는가.
pub fn is_secret_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SECRET_KEY_MARKERS.iter().any(|m| lower.contains(m))
}

/// 설정 키가 이 머신에만 뜻이 있는가.
pub fn is_local_only_key(key: &str) -> bool {
    LOCAL_ONLY_KEYS.iter().any(|pattern| {
        // `.` 로 끝나면 접두 규칙 (`project_instructions.` → 그 아래 전부),
        // 아니면 완전 일치. 접두를 완전 일치로 오인하면 이웃 키까지 지운다.
        if let Some(prefix) = pattern.strip_suffix('.') {
            key.starts_with(prefix)
                && key.len() > prefix.len()
                && key.as_bytes()[prefix.len()] == b'.'
        } else {
            key == *pattern
        }
    })
}

/// 문서가 나를 수 있는 설정 키인가 (시크릿도 머신 상태도 아니다).
pub fn is_portable_key(key: &str) -> bool {
    !is_secret_key(key) && !is_local_only_key(key)
}

// ─────────────────────────────────────────────────────────────────────────────
// 문서
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDoc {
    /// 스키마 마커 — 항상 `"v1"`.
    #[serde(rename = "oculpm_config")]
    pub version: String,
    /// SQLite `settings` 표의 키→값. 문서가 이름 붙인 키만 다룬다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub settings: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectSection>,
}

impl Default for ConfigDoc {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION.into(),
            settings: BTreeMap::new(),
            project: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectSection {
    /// `.oculpm/config.toml` 의 **부분** 지정. 여기 적힌 경로만 비교·적용한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oculpm: Option<Value>,
    /// `.claude/rules/**/*.md` — id 는 `.claude/rules` 기준 상대 경로.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<ArtifactRef>,
    /// `.claude/skills/*/SKILL.md` — id 는 스킬 폴더명.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<ArtifactRef>,
    /// `.oculpm/automation/{schedules,watchers}/*.md` — id 는 `<kind>/<stem>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub automations: Vec<ArtifactRef>,
}

/// 내용을 나르지 않는 아티팩트 참조 — 존재와 표류만 말한다.
///
/// 사람이 손으로 쓸 때는 절마다 자연스러운 이름을 쓸 수 있게 `path`·`name` 을
/// 별칭으로 받는다. 우리가 쓸 때는 언제나 `id` 다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRef {
    #[serde(alias = "path", alias = "name")]
    pub id: String,
    /// 내용 해시. 접두를 붙여 어떤 함수인지 값 자체가 말한다.
    /// (sha256 이 아니라 blake3 인 이유: 저장소가 이미 blake3 을 쓰고 —
    /// `indexer.rs` 의 해시 게이트 — 이 값은 우리끼리만 비교한다.)
    pub blake3: String,
}

impl ArtifactRef {
    pub fn new(id: impl Into<String>, bytes: &[u8]) -> Self {
        Self {
            id: id.into(),
            blake3: hash_bytes(bytes),
        }
    }
}

/// 아티팩트 내용 해시 — `blake3:<hex 16자>`. 전체 64자를 쓰지 않는 이유는
/// 사람이 diff 로 읽는 문서이고, 16자(64비트)면 한 프로젝트의 파일 수백 개
/// 사이에서 충돌이 실질적으로 없기 때문이다.
pub fn hash_bytes(bytes: &[u8]) -> String {
    let full = blake3::hash(bytes).to_hex();
    format!("blake3:{}", &full[..16])
}

// ─────────────────────────────────────────────────────────────────────────────
// YAML 입출력
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocError {
    /// YAML 자체가 깨졌다.
    Parse(String),
    /// `oculpm_config:` 가 없거나 우리가 모르는 버전이다.
    Version(String),
    /// 문서가 시크릿으로 보이는 키를 담고 있다.
    Secret(String),
}

impl DocError {
    pub fn code(&self) -> &'static str {
        match self {
            DocError::Parse(_) => "config_doc_parse",
            DocError::Version(_) => "config_doc_version",
            DocError::Secret(_) => "config_doc_secret",
        }
    }
    pub fn detail(&self) -> String {
        match self {
            DocError::Parse(m) => format!("cannot parse config document: {m}"),
            DocError::Version(v) => {
                format!("unsupported {SCHEMA_KEY}: expected {SCHEMA_VERSION}, got {v}")
            }
            DocError::Secret(k) => format!("config document carries a secret-looking key: {k}"),
        }
    }
}

/// YAML 텍스트 → 문서. 버전과 시크릿을 **파싱 시점에** 막는다 — 문서가
/// 시크릿을 담고 들어오는 길과 나가는 길을 둘 다 닫아야 규약이 성립한다.
pub fn parse_doc(text: &str) -> Result<ConfigDoc, DocError> {
    let doc: ConfigDoc = serde_yaml::from_str(text).map_err(|e| DocError::Parse(e.to_string()))?;
    if doc.version != SCHEMA_VERSION {
        return Err(DocError::Version(doc.version));
    }
    if let Some(k) = doc.settings.keys().find(|k| is_secret_key(k)) {
        return Err(DocError::Secret(k.clone()));
    }
    Ok(doc)
}

/// 문서 → YAML 텍스트. 사람이 읽고 고치는 파일이라 머리말을 붙인다.
pub fn render_doc(doc: &ConfigDoc) -> Result<String, DocError> {
    if let Some(k) = doc.settings.keys().find(|k| is_secret_key(k)) {
        return Err(DocError::Secret(k.clone()));
    }
    let body = serde_yaml::to_string(doc).map_err(|e| DocError::Parse(e.to_string()))?;
    Ok(format!(
        "# ocul-pm 선언적 설정 — `oculpm config plan|apply` 로 씁니다.\n\
         # API 키는 여기 없습니다 (OS 키체인에 삽니다).\n\
         # 규칙·스킬·자동화는 해시로 존재만 적습니다 — 내용은 git 이 나릅니다.\n\
         {body}"
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Value 평탄화 · 병합
// ─────────────────────────────────────────────────────────────────────────────

/// 매핑을 점 경로 → 압축 JSON 스칼라로 편다. 리스트는 통째로 한 값이다
/// (`agents.active` 는 순서가 뜻을 갖는다 — 원소 단위로 비교하면 안 된다).
pub fn flatten(value: &Value, prefix: &str, out: &mut BTreeMap<String, String>) {
    match value {
        Value::Mapping(map) => {
            for (k, v) in map {
                let Some(key) = k.as_str() else { continue };
                let path = if prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten(v, &path, out);
            }
        }
        other => {
            if prefix.is_empty() {
                return;
            }
            out.insert(prefix.to_string(), render_scalar(other));
        }
    }
}

/// 비교·표시용 한 줄 표현. JSON 으로 찍어 `true`/`20`/`"ko"`/`["a","b"]` 처럼
/// 타입이 값에 남게 한다 — `true` 와 `"true"` 가 같아 보이면 안 된다.
pub fn render_scalar(v: &Value) -> String {
    match serde_json::to_value(v) {
        Ok(j) => j.to_string(),
        Err(_) => String::new(),
    }
}

/// `patch` 를 `base` 위에 깊게 덮는다. 매핑끼리만 병합하고 나머지는 교체다
/// (리스트를 이어붙이지 않는다 — 목표 상태는 "이것이 전부" 라는 뜻이다).
pub fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Mapping(b), Value::Mapping(p)) => {
            for (k, v) in p {
                match b.get_mut(k) {
                    Some(slot) => deep_merge(slot, v),
                    None => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_markers_catch_key_shapes() {
        for k in [
            "anthropic_api_key",
            "GITHUB_TOKEN",
            "my_secret",
            "db_password",
        ] {
            assert!(is_secret_key(k), "{k} should read as a secret");
        }
        assert!(!is_secret_key("core_model"));
        assert!(!is_secret_key("theme"));
    }

    #[test]
    fn local_only_keys_are_excluded_but_neighbours_survive() {
        assert!(is_local_only_key("last_seen_version"));
        assert!(is_local_only_key("project_instructions.7"));
        assert!(!is_local_only_key("project_instructions"));
        assert!(!is_local_only_key("last_seen_version_extra"));
        assert!(is_portable_key("core_model"));
    }

    #[test]
    fn round_trips_through_yaml() {
        let mut doc = ConfigDoc::default();
        doc.settings.insert("theme".into(), "nord".into());
        doc.settings
            .insert("core_model".into(), "claude-haiku-4-5".into());
        doc.project = Some(ProjectSection {
            oculpm: Some(serde_yaml::from_str("agents:\n  auto_reconcile: true\n").unwrap()),
            rules: vec![ArtifactRef::new("typescript/coding-style.md", b"x")],
            ..Default::default()
        });
        let text = render_doc(&doc).unwrap();
        let back = parse_doc(&text).unwrap();
        assert_eq!(back.settings, doc.settings);
        assert_eq!(
            back.project.as_ref().unwrap().rules,
            doc.project.as_ref().unwrap().rules
        );
    }

    #[test]
    fn rejects_unknown_version_and_secret_keys() {
        let bad = "oculpm_config: v2\nsettings: {}\n";
        assert_eq!(
            parse_doc(bad).unwrap_err().code(),
            "config_doc_version",
            "v2 must not be read as v1"
        );
        let leak = "oculpm_config: v1\nsettings:\n  anthropic_api_key: sk-live\n";
        assert_eq!(parse_doc(leak).unwrap_err().code(), "config_doc_secret");
    }

    #[test]
    fn artifact_ref_accepts_human_aliases() {
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  rules:\n    - path: a.md\n      blake3: 'blake3:00'\n  skills:\n    - name: run-evals\n      blake3: 'blake3:01'\n",
        )
        .unwrap();
        let p = doc.project.unwrap();
        assert_eq!(p.rules[0].id, "a.md");
        assert_eq!(p.skills[0].id, "run-evals");
    }

    #[test]
    fn flatten_keeps_types_and_treats_lists_as_one_value() {
        let v: Value =
            serde_yaml::from_str("agents:\n  active: [claude-code, cursor]\n  auto_reconcile: true\nautomation:\n  daily_run_budget: 20\n")
                .unwrap();
        let mut out = BTreeMap::new();
        flatten(&v, "", &mut out);
        assert_eq!(out["agents.active"], r#"["claude-code","cursor"]"#);
        assert_eq!(out["agents.auto_reconcile"], "true");
        assert_eq!(out["automation.daily_run_budget"], "20");
        assert_eq!(out.len(), 3, "list must not explode into per-index keys");
    }

    #[test]
    fn deep_merge_replaces_lists_and_merges_maps() {
        let mut base: Value = serde_yaml::from_str(
            "agents:\n  active: [a, b]\n  auto_reconcile: false\nwatcher:\n  debounce_ms: 500\n",
        )
        .unwrap();
        let patch: Value = serde_yaml::from_str("agents:\n  active: [c]\n").unwrap();
        deep_merge(&mut base, &patch);
        let mut out = BTreeMap::new();
        flatten(&base, "", &mut out);
        assert_eq!(out["agents.active"], r#"["c"]"#, "list is replaced whole");
        assert_eq!(
            out["agents.auto_reconcile"], "false",
            "sibling key survives the merge"
        );
        assert_eq!(out["watcher.debounce_ms"], "500");
    }
}
