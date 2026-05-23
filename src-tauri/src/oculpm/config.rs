//! `OculpmConfig` default values, load/save, and validation.
//!
//! See `docs/major_update/oculpm/00-spec.md` §5 for the schema and
//! `docs/major_update/oculpm/phases/README.md` §0.2 for the conservative
//! `forbid_journal_for_paths` defaults.

use std::path::Path;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::OculpmError;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::spec::{
    AgentsConfig, GitConfig, OculpmConfig, SessionConfig, WatcherConfig, WorkdayConfig,
};

/// Agent ids accepted in `agents.active`. Aligned with the 1차 지원 4종
/// chosen in `00-spec.md` §8.
pub const KNOWN_AGENT_IDS: &[&str] = &["claude-code", "cursor", "antigravity", "gemini-cli"];

#[allow(dead_code)] // Consumed by OculpmManager (W1-PR6) and Settings UI (W4).
impl OculpmConfig {
    /// Conservative defaults for a freshly-initialised project.
    /// See `phases/README.md` §0.2 and `00-spec.md` §5.
    pub fn default_for_new_project() -> Self {
        Self {
            schema_version: 1,
            workday: WorkdayConfig {
                timezone: "Asia/Seoul".into(),
                day_starts_at: "00:00".into(),
            },
            session: SessionConfig {
                inactivity_timeout_minutes: 30,
                auto_close_on_workday_boundary: true,
                auto_close_on_app_quit: true,
                crash_recovery_grace_minutes: 5,
            },
            git: GitConfig {
                journal_committed: true,
                forbid_journal_for_paths: default_forbid_paths(),
                auto_redact_patterns: default_redact_patterns(),
            },
            watcher: WatcherConfig {
                ignore: default_watcher_ignore(),
                respect_gitignore: true,
                debounce_ms: 500,
                batch_max_events: 200,
            },
            agents: AgentsConfig {
                // Empty by default — user picks at onboarding or in Settings.
                active: Vec::new(),
                auto_detect_on_open: true,
                auto_sync_adapters: true,
            },
        }
    }

    /// Load + parse from a TOML file. Unknown keys are silently ignored to
    /// keep forward-compatibility easy.
    pub fn load(path: &Path) -> Result<Self, OculpmError> {
        let text = std::fs::read_to_string(path).map_err(|source| OculpmError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_toml_str(&text)
    }

    /// Parse from a TOML string without touching the filesystem. Handy for
    /// testing and for surface-level UI validation.
    pub fn from_toml_str(text: &str) -> Result<Self, OculpmError> {
        let cfg: OculpmConfig = toml::from_str(text)?;
        Ok(cfg)
    }

    /// Serialise + write to disk via `atomic_io::write_atomic`. Uses
    /// `to_string_pretty` so the file stays human-readable for users editing
    /// it directly. Never leaves a partial file behind.
    pub fn save(&self, path: &Path) -> Result<(), OculpmError> {
        let text = toml::to_string_pretty(self)?;
        write_atomic(path, text.as_bytes())
    }

    /// Validate field invariants. Cheap; safe to call after every mutation.
    ///
    /// Timezone + day_starts_at parsing is delegated to `WorkdayResolver::new`
    /// so the two paths can never drift out of sync.
    pub fn validate(&self) -> Result<(), OculpmError> {
        // Reuses InvalidTimezone / InvalidHHMM errors from W1-PR3.
        let _ = WorkdayResolver::new(&self.workday.timezone, &self.workday.day_starts_at)?;

        if self.session.inactivity_timeout_minutes < 1 {
            return Err(OculpmError::InvalidConfig(
                "session.inactivity_timeout_minutes must be >= 1".into(),
            ));
        }

        if !(1..=10_000).contains(&self.watcher.debounce_ms) {
            return Err(OculpmError::InvalidConfig(format!(
                "watcher.debounce_ms must be in 1..=10000 (got {})",
                self.watcher.debounce_ms
            )));
        }

        if self.watcher.batch_max_events < 1 {
            return Err(OculpmError::InvalidConfig(
                "watcher.batch_max_events must be >= 1".into(),
            ));
        }

        for agent_id in &self.agents.active {
            if !KNOWN_AGENT_IDS.contains(&agent_id.as_str()) {
                return Err(OculpmError::InvalidConfig(format!(
                    "agents.active contains unknown id '{}' (expected one of: {})",
                    agent_id,
                    KNOWN_AGENT_IDS.join(", ")
                )));
            }
        }

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default value sources — split out for readability and easy diffing against
// `phases/README.md` §0.2 and `00-spec.md` §5.
// ─────────────────────────────────────────────────────────────────────────────

fn default_forbid_paths() -> Vec<String> {
    [
        // env / secrets
        ".env",
        ".env.*",
        "**/.env",
        "**/.env.*",
        "**/*secret*",
        "**/*credential*",
        "**/*password*",
        "**/*token*",
        "**/*apikey*",
        "**/*api_key*",
        "**/*private_key*",
        // certificates / keys
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/*.crt",
        "**/*.cer",
        "**/id_rsa",
        "**/id_ed25519",
        // system secret directories
        "**/.ssh/**",
        "**/.gnupg/**",
        "**/.aws/credentials",
        "**/.aws/config",
        "**/.netrc",
        "**/.npmrc",
        "**/.pypirc",
        "**/.docker/config.json",
        // macOS / Windows
        "**/Keychain*",
        "**/keychain*",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect()
}

fn default_redact_patterns() -> Vec<String> {
    [
        r"AKIA[0-9A-Z]{16}",         // AWS Access Key
        r"sk-[A-Za-z0-9_-]{20,}",    // OpenAI / Anthropic-like
        r"ghp_[A-Za-z0-9]{36}",      // GitHub PAT
        r"xox[baprs]-[A-Za-z0-9-]+", // Slack
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect()
}

fn default_watcher_ignore() -> Vec<String> {
    [
        ".oculpm/index/",
        ".oculpm/.lock",
        ".git/",
        "node_modules/",
        "target/",
        "dist/",
        ".next/",
        "build/",
        "*.log",
        ".DS_Store",
    ]
    .iter()
    .map(|&s| s.to_string())
    .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W1/PR4-config.md` §5.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Case 1 — Round-trip: default → save → load → equality.
    /// Also asserts the default itself passes validate().
    #[test]
    fn roundtrip_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let c1 = OculpmConfig::default_for_new_project();
        c1.validate().expect("default must validate");

        c1.save(&path).expect("save");
        let c2 = OculpmConfig::load(&path).expect("load");

        assert_eq!(c1, c2);
    }

    /// Case 2 — Invalid timezone surfaces as InvalidTimezone.
    #[test]
    fn validate_rejects_invalid_timezone() {
        let mut c = OculpmConfig::default_for_new_project();
        c.workday.timezone = "Asia/Seoult".into();
        assert!(matches!(c.validate(), Err(OculpmError::InvalidTimezone(_))));
    }

    /// Case 3 — Invalid HH:MM surfaces as InvalidHHMM.
    #[test]
    fn validate_rejects_invalid_hhmm() {
        let mut c = OculpmConfig::default_for_new_project();
        c.workday.day_starts_at = "25:00".into();
        assert!(matches!(c.validate(), Err(OculpmError::InvalidHHMM(_))));
    }

    /// Case 4 — Inactivity timeout 0 rejected.
    #[test]
    fn validate_rejects_zero_timeout() {
        let mut c = OculpmConfig::default_for_new_project();
        c.session.inactivity_timeout_minutes = 0;
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));
    }

    /// Case 5 — Unknown agent id rejected.
    #[test]
    fn validate_rejects_unknown_agent() {
        let mut c = OculpmConfig::default_for_new_project();
        c.agents.active = vec!["foo".into()];
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));
    }

    /// Case 6 — Unknown top-level TOML keys must not break loading
    /// (forward-compatibility — see `00-spec.md` §5 alternate).
    #[test]
    fn load_ignores_unknown_keys() {
        // A minimal valid TOML with one extra unknown top-level key.
        let text = r#"
schema_version = 1
foo_unknown_key = 42

[workday]
timezone = "Asia/Seoul"
day_starts_at = "00:00"

[session]
inactivity_timeout_minutes = 30
auto_close_on_workday_boundary = true
auto_close_on_app_quit = true
crash_recovery_grace_minutes = 5

[git]
journal_committed = true
forbid_journal_for_paths = []
auto_redact_patterns = []

[watcher]
ignore = []
respect_gitignore = true
debounce_ms = 500
batch_max_events = 200

[agents]
active = []
auto_detect_on_open = true
auto_sync_adapters = true
"#;
        let cfg = OculpmConfig::from_toml_str(text).expect("unknown keys must be ignored");
        assert_eq!(cfg.schema_version, 1);
        assert_eq!(cfg.workday.timezone, "Asia/Seoul");
    }

    /// Bonus — validate covers debounce_ms range and batch_max_events too.
    #[test]
    fn validate_rejects_bad_debounce_and_batch() {
        let mut c = OculpmConfig::default_for_new_project();
        c.watcher.debounce_ms = 0;
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));

        let mut c = OculpmConfig::default_for_new_project();
        c.watcher.debounce_ms = 20_000;
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));

        let mut c = OculpmConfig::default_for_new_project();
        c.watcher.batch_max_events = 0;
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));
    }

    /// Sanity — every default forbid pattern is non-empty.
    #[test]
    fn default_forbid_patterns_nonempty() {
        let c = OculpmConfig::default_for_new_project();
        assert!(c.git.forbid_journal_for_paths.len() >= 25);
        assert!(c
            .git
            .forbid_journal_for_paths
            .iter()
            .all(|p| !p.is_empty()));
    }
}
