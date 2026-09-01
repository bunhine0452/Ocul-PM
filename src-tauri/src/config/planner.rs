//! 현재 상태를 읽고 목표 문서와 대조해 [`ConfigPlan`] 을 만든다
//! (Osaurus 라운드 Phase 6 #config-plan-apply).
//!
//! 이 모듈은 **아무것도 쓰지 않는다.** UI · CLI · MCP 세 진입점이 같은
//! `plan` 을 부르고, 승인 카드는 여기서 나온 목록을 그대로 보여 준다.
//! 적용 뒤 대조 검증도 같은 함수를 한 번 더 부르는 것이다 — "됐다" 를
//! apply 호출의 성공이 아니라 **다시 계산한 diff 가 비었음**으로 말한다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use specta::Type;

use super::schema::{self, ArtifactRef, ConfigDoc, ProjectSection};

/// 규칙 재귀 깊이 상한 — `rules.rs` 의 `MAX_RULES_DEPTH` 와 같은 값.
const MAX_RULES_DEPTH: u8 = 4;
/// 한 절에서 훑는 파일 수 상한 (비정상 트리 가드).
const MAX_ARTIFACTS: usize = 500;

// ─────────────────────────────────────────────────────────────────────────────
// 계획 타입
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigSurface {
    /// SQLite `settings` 표.
    Settings,
    /// `.oculpm/config.toml`.
    OculpmConfig,
    Rule,
    Skill,
    Automation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigOp {
    /// 지금 없는 값을 새로 쓴다.
    Add,
    /// 있는 값을 목표 값으로 바꾼다.
    Change,
    /// 이미 목표 상태다.
    Unchanged,
    /// 문서가 선언했지만 **이행할 수 없다** — 사유는 `reason` 에 있다.
    /// 조용히 무시하지 않는 것이 이 op 의 존재 이유다.
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ConfigPlanItem {
    pub surface: ConfigSurface,
    /// 표면 안에서의 키. 설정은 설정 키, `.oculpm` 은 점 경로, 아티팩트는 id.
    pub key: String,
    pub op: ConfigOp,
    /// 지금 값 (없으면 `None`).
    pub from: Option<String>,
    /// 목표 값. 아티팩트는 해시다.
    pub to: Option<String>,
    /// `Blocked` 사유 코드 — `content_not_carried` · `secret_excluded` ·
    /// `no_project` · `invalid_value`. UI 가 i18n 키로 바꾼다.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ConfigPlan {
    /// 이 계획이 대상으로 삼은 프로젝트 루트 (없으면 설정만 계획했다).
    pub project_root: Option<String>,
    pub items: Vec<ConfigPlanItem>,
    pub added: u32,
    pub changed: u32,
    pub unchanged: u32,
    pub blocked: u32,
}

impl ConfigPlan {
    fn from_items(project_root: Option<String>, items: Vec<ConfigPlanItem>) -> Self {
        let count = |op: ConfigOp| items.iter().filter(|i| i.op == op).count() as u32;
        Self {
            project_root,
            added: count(ConfigOp::Add),
            changed: count(ConfigOp::Change),
            unchanged: count(ConfigOp::Unchanged),
            blocked: count(ConfigOp::Blocked),
            items,
        }
    }

    /// 쓸 것이 남았는가. 대조 검증은 이것이 `false` 여야 "적용 완료" 다.
    pub fn has_writes(&self) -> bool {
        self.added > 0 || self.changed > 0
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 현재 상태
// ─────────────────────────────────────────────────────────────────────────────

/// 디스크와 DB 에서 읽어 온 지금 상태. 순수 함수로 계획하기 위해 I/O 를
/// 여기 한 번에 모은다 — 테스트는 이 구조체를 손으로 만든다.
#[derive(Debug, Clone, Default)]
pub struct ConfigState {
    pub settings: BTreeMap<String, String>,
    /// `.oculpm/config.toml` 을 YAML `Value` 로. 프로젝트가 없으면 `None`.
    pub oculpm: Option<Value>,
    pub rules: BTreeMap<String, String>,
    pub skills: BTreeMap<String, String>,
    pub automations: BTreeMap<String, String>,
}

/// 프로젝트 루트에서 아티팩트 해시를 모은다. 설정은 DB 라 호출자가 넣는다.
pub fn capture(settings: BTreeMap<String, String>, project_root: Option<&Path>) -> ConfigState {
    let mut state = ConfigState {
        settings,
        ..Default::default()
    };
    let Some(root) = project_root else {
        return state;
    };
    state.oculpm = read_oculpm_config(root);
    state.rules = hash_rules(root);
    state.skills = hash_skills(root);
    state.automations = hash_automations(root);
    state
}

fn read_oculpm_config(root: &Path) -> Option<Value> {
    let path = root.join(".oculpm").join("config.toml");
    let text = std::fs::read_to_string(path).ok()?;
    // TOML → YAML `Value` 는 serde 를 두 번 태워 옮긴다. 중간 표현을 손으로
    // 쓰지 않는 이유는 스펙 구조체가 커지면 그 코드가 조용히 뒤처지기 때문.
    let toml_value: toml::Value = toml::from_str(&text).ok()?;
    serde_yaml::to_value(toml_value).ok()
}

fn hash_rules(root: &Path) -> BTreeMap<String, String> {
    let base = root.join(".claude").join("rules");
    let mut out = BTreeMap::new();
    walk_md(&base, &base, 0, &mut out);
    out
}

fn walk_md(base: &Path, dir: &Path, depth: u8, out: &mut BTreeMap<String, String>) {
    if depth > MAX_RULES_DEPTH || out.len() >= MAX_ARTIFACTS {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            walk_md(base, &path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let (Ok(bytes), Ok(rel)) = (std::fs::read(&path), path.strip_prefix(base)) {
                out.insert(rel_id(rel), schema::hash_bytes(&bytes));
            }
        }
    }
}

fn hash_skills(root: &Path) -> BTreeMap<String, String> {
    let base = root.join(".claude").join("skills");
    let mut out = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(&base) else {
        return out;
    };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    dirs.sort();
    for dir in dirs {
        // `.disabled/` 는 비활성 보관함이다 — 존재하지 않는 것으로 센다.
        let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !dir.is_dir() || name.starts_with('.') {
            continue;
        }
        // 스킬의 정의는 SKILL.md 다. 보조 파일은 참조라 해시에 넣지 않는다
        // — 넣으면 assets 하나 고칠 때마다 "표류" 로 보인다.
        if let Ok(bytes) = std::fs::read(dir.join("SKILL.md")) {
            out.insert(name.to_string(), schema::hash_bytes(&bytes));
        }
    }
    out
}

fn hash_automations(root: &Path) -> BTreeMap<String, String> {
    let base = root.join(".oculpm").join("automation");
    let mut out = BTreeMap::new();
    for kind in ["schedules", "watchers"] {
        let dir = base.join(kind);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if let Ok(bytes) = std::fs::read(&path) {
                out.insert(format!("{kind}/{stem}"), schema::hash_bytes(&bytes));
            }
        }
    }
    out
}

fn rel_id(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

// ─────────────────────────────────────────────────────────────────────────────
// export
// ─────────────────────────────────────────────────────────────────────────────

/// 지금 상태를 문서로. 시크릿·머신 상태는 [`schema::is_portable_key`] 가 뺀다.
pub fn export(state: &ConfigState) -> ConfigDoc {
    let settings = state
        .settings
        .iter()
        .filter(|(k, _)| schema::is_portable_key(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    let project = state.oculpm.as_ref().map(|oculpm| ProjectSection {
        oculpm: Some(oculpm.clone()),
        rules: refs(&state.rules),
        skills: refs(&state.skills),
        automations: refs(&state.automations),
    });

    ConfigDoc {
        version: schema::SCHEMA_VERSION.into(),
        settings,
        project,
    }
}

fn refs(map: &BTreeMap<String, String>) -> Vec<ArtifactRef> {
    map.iter()
        .map(|(id, blake3)| ArtifactRef {
            id: id.clone(),
            blake3: blake3.clone(),
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// plan
// ─────────────────────────────────────────────────────────────────────────────

/// 목표 문서와 현재 상태의 diff. 순수 함수다.
pub fn plan(state: &ConfigState, desired: &ConfigDoc, project_root: Option<&Path>) -> ConfigPlan {
    let mut items = Vec::new();

    for (key, want) in &desired.settings {
        // 파싱이 이미 막지만 문서가 코드로 만들어지는 길도 있다 (MCP).
        if schema::is_secret_key(key) {
            items.push(blocked(
                ConfigSurface::Settings,
                key,
                None,
                Some(want.clone()),
                "secret_excluded",
            ));
            continue;
        }
        let have = state.settings.get(key);
        items.push(ConfigPlanItem {
            surface: ConfigSurface::Settings,
            key: key.clone(),
            op: match have {
                None => ConfigOp::Add,
                Some(v) if v == want => ConfigOp::Unchanged,
                Some(_) => ConfigOp::Change,
            },
            from: have.cloned(),
            to: Some(want.clone()),
            reason: None,
        });
    }

    let Some(section) = desired.project.as_ref() else {
        return ConfigPlan::from_items(project_root.map(display_path), items);
    };

    // 프로젝트 절이 있는데 열린 프로젝트가 없으면 조용히 건너뛰지 않는다.
    if project_root.is_none() {
        items.push(blocked(
            ConfigSurface::OculpmConfig,
            "project",
            None,
            None,
            "no_project",
        ));
        return ConfigPlan::from_items(None, items);
    }

    if let Some(want) = section.oculpm.as_ref() {
        let mut wanted = BTreeMap::new();
        schema::flatten(want, "", &mut wanted);
        let mut current = BTreeMap::new();
        if let Some(cur) = state.oculpm.as_ref() {
            schema::flatten(cur, "", &mut current);
        }
        for (path, want_value) in wanted {
            let have = current.get(&path);
            items.push(ConfigPlanItem {
                surface: ConfigSurface::OculpmConfig,
                key: path,
                op: match have {
                    None => ConfigOp::Add,
                    Some(v) if *v == want_value => ConfigOp::Unchanged,
                    Some(_) => ConfigOp::Change,
                },
                from: have.cloned(),
                to: Some(want_value),
                reason: None,
            });
        }
    }

    artifact_items(
        ConfigSurface::Rule,
        &section.rules,
        &state.rules,
        &mut items,
    );
    artifact_items(
        ConfigSurface::Skill,
        &section.skills,
        &state.skills,
        &mut items,
    );
    artifact_items(
        ConfigSurface::Automation,
        &section.automations,
        &state.automations,
        &mut items,
    );

    ConfigPlan::from_items(project_root.map(display_path), items)
}

/// 아티팩트 절은 **읽기 전용 보고**다 (D11) — 해시에서 내용을 복원할 수
/// 없으므로 맞으면 `Unchanged`, 아니면 `Blocked` 다. 없는 것을 만들어 내는
/// 길은 플러그인 번들 임포트 쪽이다 (그쪽은 내용을 실제로 갖고 온다).
fn artifact_items(
    surface: ConfigSurface,
    wanted: &[ArtifactRef],
    current: &BTreeMap<String, String>,
    items: &mut Vec<ConfigPlanItem>,
) {
    for want in wanted {
        match current.get(&want.id) {
            Some(have) if *have == want.blake3 => items.push(ConfigPlanItem {
                surface,
                key: want.id.clone(),
                op: ConfigOp::Unchanged,
                from: Some(have.clone()),
                to: Some(want.blake3.clone()),
                reason: None,
            }),
            other => items.push(blocked(
                surface,
                &want.id,
                other.cloned(),
                Some(want.blake3.clone()),
                "content_not_carried",
            )),
        }
    }
}

fn blocked(
    surface: ConfigSurface,
    key: &str,
    from: Option<String>,
    to: Option<String>,
    reason: &str,
) -> ConfigPlanItem {
    ConfigPlanItem {
        surface,
        key: key.to_string(),
        op: ConfigOp::Blocked,
        from,
        to,
        reason: Some(reason.to_string()),
    }
}

fn display_path(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::schema::parse_doc;

    fn state_with(settings: &[(&str, &str)]) -> ConfigState {
        ConfigState {
            settings: settings
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn settings_diff_splits_add_change_unchanged() {
        let state = state_with(&[("theme", "nord"), ("core_model", "sonnet")]);
        let doc = parse_doc(
            "oculpm_config: v1\nsettings:\n  theme: nord\n  core_model: haiku\n  content_language: ko\n",
        )
        .unwrap();
        let plan = plan(&state, &doc, None);
        assert_eq!((plan.added, plan.changed, plan.unchanged), (1, 1, 1));
        let by_key = |k: &str| plan.items.iter().find(|i| i.key == k).unwrap().clone();
        assert_eq!(by_key("theme").op, ConfigOp::Unchanged);
        assert_eq!(by_key("core_model").op, ConfigOp::Change);
        assert_eq!(by_key("core_model").from.as_deref(), Some("sonnet"));
        assert_eq!(by_key("content_language").op, ConfigOp::Add);
        assert!(plan.has_writes());
    }

    #[test]
    fn identical_state_yields_no_writes() {
        let state = state_with(&[("theme", "nord")]);
        let doc = parse_doc("oculpm_config: v1\nsettings:\n  theme: nord\n").unwrap();
        let plan = plan(&state, &doc, None);
        assert!(!plan.has_writes(), "same state must plan zero writes");
        assert_eq!(plan.unchanged, 1);
    }

    #[test]
    fn oculpm_section_without_open_project_is_blocked_not_ignored() {
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    agents:\n      auto_reconcile: true\n",
        )
        .unwrap();
        let plan = plan(&ConfigState::default(), &doc, None);
        assert_eq!(plan.blocked, 1);
        assert_eq!(plan.items[0].reason.as_deref(), Some("no_project"));
    }

    #[test]
    fn oculpm_diff_compares_only_named_paths() {
        let state = ConfigState {
            oculpm: Some(
                serde_yaml::from_str(
                    "agents:\n  auto_reconcile: false\n  active: [claude-code]\nwatcher:\n  debounce_ms: 500\n",
                )
                .unwrap(),
            ),
            ..Default::default()
        };
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    agents:\n      auto_reconcile: true\n",
        )
        .unwrap();
        let plan = plan(&state, &doc, Some(Path::new("/tmp/p")));
        assert_eq!(
            plan.items.len(),
            1,
            "unnamed paths are not this doc's business"
        );
        assert_eq!(plan.items[0].key, "agents.auto_reconcile");
        assert_eq!(plan.items[0].op, ConfigOp::Change);
        assert_eq!(plan.items[0].from.as_deref(), Some("false"));
    }

    #[test]
    fn artifacts_match_by_hash_and_drift_is_blocked_with_a_reason() {
        let mut state = ConfigState::default();
        state
            .rules
            .insert("a.md".into(), schema::hash_bytes(b"same"));
        state
            .rules
            .insert("b.md".into(), schema::hash_bytes(b"local"));
        let doc = ConfigDoc {
            version: "v1".into(),
            settings: BTreeMap::new(),
            project: Some(ProjectSection {
                rules: vec![
                    ArtifactRef::new("a.md", b"same"),
                    ArtifactRef::new("b.md", b"theirs"),
                    ArtifactRef::new("c.md", b"missing"),
                ],
                ..Default::default()
            }),
        };
        let plan = plan(&state, &doc, Some(Path::new("/tmp/p")));
        assert_eq!(plan.unchanged, 1);
        assert_eq!(plan.blocked, 2, "drifted + missing are both unapplicable");
        assert!(!plan.has_writes(), "artifacts never produce writes");
        for item in plan.items.iter().filter(|i| i.op == ConfigOp::Blocked) {
            assert_eq!(item.reason.as_deref(), Some("content_not_carried"));
        }
    }

    #[test]
    fn export_drops_secrets_and_machine_state() {
        let state = state_with(&[
            ("theme", "nord"),
            ("anthropic_api_key", "sk-live"),
            ("last_seen_version", "2.29.0"),
            ("project_instructions.7", "…"),
        ]);
        let doc = export(&state);
        assert_eq!(doc.settings.len(), 1);
        assert!(doc.settings.contains_key("theme"));
        let text = schema::render_doc(&doc).unwrap();
        assert!(
            !text.contains("sk-live"),
            "export must never carry a secret"
        );
        assert!(!text.contains("last_seen_version"));
    }

    #[test]
    fn export_then_plan_is_empty() {
        let state = state_with(&[("theme", "nord"), ("core_model", "haiku")]);
        let doc = export(&state);
        let plan = plan(&state, &doc, None);
        assert!(
            !plan.has_writes(),
            "a doc exported from a state must plan zero writes against it"
        );
    }

    #[test]
    fn hashes_artifacts_off_disk() {
        let tmp = std::env::temp_dir().join(format!("oculpm-cfg-{}", std::process::id()));
        let rules = tmp.join(".claude/rules/typescript");
        std::fs::create_dir_all(&rules).unwrap();
        std::fs::write(rules.join("style.md"), b"hello").unwrap();
        let skill = tmp.join(".claude/skills/run-evals");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), b"skill").unwrap();
        let autos = tmp.join(".oculpm/automation/schedules");
        std::fs::create_dir_all(&autos).unwrap();
        std::fs::write(autos.join("weekly.md"), b"auto").unwrap();

        let state = capture(BTreeMap::new(), Some(&tmp));
        assert_eq!(
            state.rules.get("typescript/style.md"),
            Some(&schema::hash_bytes(b"hello"))
        );
        assert_eq!(
            state.skills.get("run-evals"),
            Some(&schema::hash_bytes(b"skill"))
        );
        assert_eq!(
            state.automations.get("schedules/weekly"),
            Some(&schema::hash_bytes(b"auto"))
        );
        std::fs::remove_dir_all(&tmp).ok();
    }
}
