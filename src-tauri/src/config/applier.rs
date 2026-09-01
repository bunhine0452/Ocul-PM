//! [`ConfigPlan`] 을 실제로 적용한다 (Osaurus 라운드 Phase 6 #config-plan-apply).
//!
//! 규약 셋:
//!
//! - **계획에 없는 것은 쓰지 않는다.** 적용은 언제나 planner 가 만든 목록을
//!   입력으로 받는다 — 승인 카드가 보여 준 것과 쓰이는 것이 같은 목록이다.
//! - **문서가 이름 붙이지 않은 것은 지우지 않는다.** 목표 상태는 "이 키들이
//!   이 값이어야 한다" 이지 "이 밖의 모든 것을 없애라" 가 아니다.
//! - **완료는 대조로 말한다** (#config-verify). apply 가 성공을 반환해도
//!   호출자는 다시 `plan` 을 돌려 남은 diff 가 0 인지 확인하고, 아니면
//!   `Partial` 로 정직하게 보고한다.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::Path;

use super::planner::{ConfigOp, ConfigPlan, ConfigSurface};
use super::schema::{self, ConfigDoc};
use crate::oculpm::spec::OculpmConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigApplyStatus {
    /// 계획한 쓰기가 전부 됐고 대조 검증도 비었다.
    Applied,
    /// 일부만 됐다 — 실패했거나, 대조에서 diff 가 남았다.
    Partial,
    /// 쓸 것이 없었다 (이미 목표 상태).
    NoOp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ConfigApplyFailure {
    pub surface: ConfigSurface,
    pub key: String,
    /// 기계가 읽는 사유 코드.
    pub code: String,
    /// 영어 원문 (로그·복사용).
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ConfigApplyResult {
    pub status: ConfigApplyStatus,
    /// 실제로 쓴 항목의 키.
    pub applied: Vec<String>,
    pub failed: Vec<ConfigApplyFailure>,
    /// 애초에 이행할 수 없다고 계획된 항목 수 (표류한 규칙 등).
    pub blocked: u32,
    /// 대조 검증에서 **남은** 쓰기 수. 0 이어야 `Applied` 다.
    pub residual: u32,
}

/// 계획에서 설정 표에 쓸 (키, 값) 목록을 뽑는다. 순수 함수 — DB 는 호출자가.
pub fn settings_writes(plan: &ConfigPlan) -> Vec<(String, String)> {
    plan.items
        .iter()
        .filter(|i| i.surface == ConfigSurface::Settings)
        .filter(|i| matches!(i.op, ConfigOp::Add | ConfigOp::Change))
        .filter_map(|i| i.to.clone().map(|v| (i.key.clone(), v)))
        .collect()
}

/// 계획이 `.oculpm/config.toml` 을 건드리는가.
pub fn touches_oculpm(plan: &ConfigPlan) -> bool {
    plan.items.iter().any(|i| {
        i.surface == ConfigSurface::OculpmConfig && matches!(i.op, ConfigOp::Add | ConfigOp::Change)
    })
}

/// `.oculpm/config.toml` 에 문서의 `project.oculpm` 절을 병합해 쓴다.
///
/// 부분 지정을 현재 값 **위에** 덮으므로 문서가 말하지 않은 필드는 그대로다.
/// 병합 결과는 반드시 [`OculpmConfig`] 로 역직렬화한 뒤 `validate()` 를 지나야
/// 저장된다 — 잘못된 YAML 한 줄이 프로젝트 설정을 못 읽는 상태로 만들지 않게.
pub fn apply_oculpm(project_root: &Path, desired: &ConfigDoc) -> Result<bool, ConfigApplyFailure> {
    let Some(patch) = desired.project.as_ref().and_then(|p| p.oculpm.as_ref()) else {
        return Ok(false);
    };

    let path = project_root.join(".oculpm").join("config.toml");
    let text =
        std::fs::read_to_string(&path).map_err(|e| failure("config.toml", "read_failed", e))?;
    let current: toml::Value =
        toml::from_str(&text).map_err(|e| failure("config.toml", "parse_failed", e))?;
    let mut merged =
        serde_yaml::to_value(current).map_err(|e| failure("config.toml", "convert_failed", e))?;
    schema::deep_merge(&mut merged, patch);

    let config: OculpmConfig =
        serde_yaml::from_value(merged).map_err(|e| failure("config.toml", "invalid_value", e))?;
    config
        .validate()
        .map_err(|e| failure("config.toml", "invalid_value", e))?;
    // 같은 바이트면 무기록 — 워처 증폭을 막는 저장소 공통 규약.
    let rendered =
        toml::to_string_pretty(&config).map_err(|e| failure("config.toml", "render_failed", e))?;
    if rendered == text {
        return Ok(false);
    }
    config
        .save(&path)
        .map_err(|e| failure("config.toml", "write_failed", e))?;
    Ok(true)
}

fn failure(key: &str, code: &str, e: impl std::fmt::Display) -> ConfigApplyFailure {
    ConfigApplyFailure {
        surface: ConfigSurface::OculpmConfig,
        key: key.to_string(),
        code: code.to_string(),
        detail: e.to_string(),
    }
}

/// 적용 결과 + 대조 검증의 남은 diff 를 하나의 결론으로 접는다.
///
/// **`Applied` 를 말할 수 있는 조건은 하나뿐이다** — 실패가 없고 재계산한
/// 계획에 쓸 것이 남지 않았을 때. apply 호출이 성공했다는 사실만으로는
/// 완료라고 말하지 않는다 (#config-verify).
pub fn conclude(
    applied: Vec<String>,
    failed: Vec<ConfigApplyFailure>,
    blocked: u32,
    residual: u32,
) -> ConfigApplyResult {
    let status = if !failed.is_empty() || residual > 0 {
        ConfigApplyStatus::Partial
    } else if applied.is_empty() {
        ConfigApplyStatus::NoOp
    } else {
        ConfigApplyStatus::Applied
    };
    ConfigApplyResult {
        status,
        applied,
        failed,
        blocked,
        residual,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::planner::{self, ConfigState};
    use crate::config::schema::parse_doc;
    use std::collections::BTreeMap;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "oculpm-apply-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join(".oculpm")).unwrap();
        dir
    }

    fn seed_config(root: &Path) {
        OculpmConfig::default_for_new_project()
            .save(&root.join(".oculpm").join("config.toml"))
            .unwrap();
    }

    #[test]
    fn settings_writes_only_carries_planned_changes() {
        let state = ConfigState {
            settings: BTreeMap::from([("theme".to_string(), "nord".to_string())]),
            ..Default::default()
        };
        let doc = parse_doc("oculpm_config: v1\nsettings:\n  theme: nord\n  core_model: haiku\n")
            .unwrap();
        let plan = planner::plan(&state, &doc, None);
        let writes = settings_writes(&plan);
        assert_eq!(
            writes,
            vec![("core_model".to_string(), "haiku".to_string())]
        );
    }

    #[test]
    fn merges_partial_oculpm_and_leaves_unnamed_fields_alone() {
        let root = tmpdir("merge");
        seed_config(&root);
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    agents:\n      auto_reconcile: true\n",
        )
        .unwrap();
        assert!(apply_oculpm(&root, &doc).unwrap());

        let after = OculpmConfig::load(&root.join(".oculpm").join("config.toml")).unwrap();
        assert!(after.agents.auto_reconcile, "named field applied");
        assert_eq!(
            after.agents.active,
            vec!["agents-md".to_string()],
            "unnamed sibling survives"
        );
        assert_eq!(after.schema_version, 1, "schema_version untouched");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn applying_twice_is_idempotent() {
        let root = tmpdir("idem");
        seed_config(&root);
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    automation:\n      daily_run_budget: 5\n",
        )
        .unwrap();
        assert!(apply_oculpm(&root, &doc).unwrap(), "first apply writes");
        assert!(
            !apply_oculpm(&root, &doc).unwrap(),
            "second apply must write nothing"
        );

        let state = planner::capture(BTreeMap::new(), Some(&root));
        let plan = planner::plan(&state, &doc, Some(&root));
        assert!(!plan.has_writes(), "re-plan after apply must be empty");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_a_value_the_config_type_cannot_hold() {
        let root = tmpdir("bad");
        seed_config(&root);
        let doc = parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    automation:\n      daily_run_budget: \"lots\"\n",
        )
        .unwrap();
        let err = apply_oculpm(&root, &doc).unwrap_err();
        assert_eq!(err.code, "invalid_value");

        let after = OculpmConfig::load(&root.join(".oculpm").join("config.toml")).unwrap();
        assert_eq!(after.automation.daily_run_budget, 20, "file left untouched");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn conclude_refuses_to_call_a_residual_diff_done() {
        let ok = conclude(vec!["theme".into()], vec![], 0, 0);
        assert_eq!(ok.status, ConfigApplyStatus::Applied);

        let residual = conclude(vec!["theme".into()], vec![], 0, 2);
        assert_eq!(
            residual.status,
            ConfigApplyStatus::Partial,
            "a non-empty re-plan is never 'applied'"
        );

        let failed = conclude(
            vec!["theme".into()],
            vec![ConfigApplyFailure {
                surface: ConfigSurface::OculpmConfig,
                key: "config.toml".into(),
                code: "write_failed".into(),
                detail: "permission denied".into(),
            }],
            0,
            0,
        );
        assert_eq!(failed.status, ConfigApplyStatus::Partial);

        assert_eq!(
            conclude(vec![], vec![], 3, 0).status,
            ConfigApplyStatus::NoOp
        );
    }
}
