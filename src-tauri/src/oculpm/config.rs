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
    AgentsConfig, AutomationConfig, GitConfig, OculpmConfig, SessionConfig, WatcherConfig,
    WorkdayConfig,
};

/// Agent ids accepted in `agents.active`. Aligned with `00-spec.md` §8 plus
/// W4 dogfooding finding (2026-05-25): `agents-md` is the universal AGENTS.md
/// surface that the other adapters delegate to via `@AGENTS.md` stubs.
pub const KNOWN_AGENT_IDS: &[&str] = &[
    "agents-md",
    "claude-code",
    "cursor",
    "antigravity",
    "gemini-cli",
    // v2 U4 (A1) — 어댑터 확대. Codex CLI 는 AGENTS.md 를 네이티브로 읽어
    // 별도 어댑터가 필요 없다.
    "windsurf",
    "copilot",
    "aider",
    "cline",
    "zed",
];

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
                // W4 dogfooding fix (2026-05-25) — external agents (Claude
                // Code / antigravity / etc.) have natural pauses while waiting
                // on LLM responses or user prompts. 30 min split single
                // logical sessions into many. 60 min covers most agent gaps;
                // session_resume_grace handles the remaining tail.
                inactivity_timeout_minutes: 60,
                session_resume_grace_minutes: 15,
            },
            git: GitConfig {
                forbid_journal_for_paths: default_forbid_paths(),
                auto_redact_patterns: default_redact_patterns(),
            },
            watcher: WatcherConfig {
                ignore: default_watcher_ignore(),
                respect_gitignore: true,
                debounce_ms: 500,
                // 기본은 숫자 그대로 — 티어를 고른 사람만 이름을 적는다.
                responsiveness: None,
            },
            agents: AgentsConfig {
                // `agents-md` is the universal surface — always on by default
                // so the root AGENTS.md gets the master content even before
                // the user toggles individual adapters. Per-adapter ids stay
                // empty until detection or Settings picks them.
                active: vec!["agents-md".into()],
                // F1 — automatic background LLM reconciliation is opt-in.
                auto_reconcile: false,
                // PR-CI1 — hook-session journal drafting is opt-in (billable).
                auto_journal_draft: false,
                // PR-CI3 — rules cross-tool translation is opt-in.
                rules_translate: vec![],
                // TK1 — master template language (ko | en).
                template_language: "ko".into(),
            },
            // D4 — 자동화는 전부 옵인. 새 프로젝트도 꺼진 채로 시작한다.
            automation: AutomationConfig::default(),
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
        let generated = toml::to_string_pretty(self)?;

        let text = match std::fs::read_to_string(path) {
            Ok(existing) => {
                // 멱등 쓰기 (2026-07-20, 2026-09-08 수정): 내용이 같으면 디스크를
                // 건드리지 않는다. 같은-내용 재작성이 mtime 만 바꿔 (a) 우리
                // watcher 의 "config.toml changed" 재시작 경고, (b) 이 레포를 dev
                // 로 열 때 @tailwindcss/vite 가 change 이벤트에 raw full-reload 를
                // 쏘는 웹뷰 전체 리로드(스파이 스택으로 확정)를 유발했다.
                //
                // **판정은 바이트가 아니라 값이다.** 바이트 비교는 주석이 있는
                // 파일에서 절대 같아지지 않아(생성본에는 주석이 없다) 이 문이
                // 늘 열려 있었고, 설정을 저장할 때마다 손으로 쓴 주석이 통째로
                // 날아갔다 — 실제 피해자는 `forbid_journal_for_paths` 의
                // {#token-glob-false-positive} 근거 16줄이다. 값이 안 바뀌므로
                // diff 가 "설정 안 건드렸네"로 읽혀 조용히 지워졌다.
                if Self::from_toml_str(&existing).is_ok_and(|current| &current == self) {
                    return Ok(());
                }
                merge_preserving_decor(&existing, &generated, self)
            }
            // 파일이 없거나 못 읽으면 생성본을 그대로 쓴다.
            Err(_) => generated,
        };

        if std::fs::read(path).is_ok_and(|existing| existing == text.as_bytes()) {
            return Ok(());
        }
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

        for agent_id in &self.agents.active {
            if !KNOWN_AGENT_IDS.contains(&agent_id.as_str()) {
                return Err(OculpmError::InvalidConfig(format!(
                    "agents.active contains unknown id '{}' (expected one of: {})",
                    agent_id,
                    KNOWN_AGENT_IDS.join(", ")
                )));
            }
        }

        // 폭주 가드의 상한 자체가 폭주하지 않게. 0 은 "전면 정지" 로 유효하다.
        if self.automation.daily_run_budget > 1_000 {
            return Err(OculpmError::InvalidConfig(format!(
                "automation.daily_run_budget must be <= 1000 (got {})",
                self.automation.daily_run_budget
            )));
        }

        for target in &self.agents.rules_translate {
            if !crate::oculpm::rules::TRANSLATE_TARGETS.contains(&target.as_str()) {
                return Err(OculpmError::InvalidConfig(format!(
                    "agents.rules_translate contains unknown target '{}' (expected one of: {})",
                    target,
                    crate::oculpm::rules::TRANSLATE_TARGETS.join(", ")
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
        // {#token-glob-false-positive} — 위 이름 글롭들은 **소스 파일까지** 시크릿으로
        // 오인한다. 실측 피해자: `styles/tokens.css`·`design_tokens.test.ts`(디자인
        // 토큰)와 `secrets.rs`(키체인 모듈). 이름에 token/secret 이 들어갔다는
        // 이유로 `files_touched` 에서 조용히 떨어져, 그 파일을 고친 일지가 무엇을
        // 고쳤는지 말하지 못했다.
        //
        // 좁히는 축은 **확장자**다 — 자격증명은 소스 확장자를 쓰지 않는다(실제 꼴은
        // 확장자 없음·점파일·`.json`/`.yml`·`.pem`/`.key`). 이름 글롭의 넓이는 그대로
        // 두고(모르는 꼴은 계속 막힌다) 소스 확장자만 되돌린다. 뒤 규칙이 이기므로
        // 이 줄들은 이름 글롭 **바로 뒤**, 아래 경로 규칙 **앞**이어야 한다.
        // `.md`·`.json`·`.yml` 은 일부러 뺐다 — 자격증명이 실제로 사는 확장자다.
        //
        // 이 목록은 `.oculpm/config.toml` 의 같은 블록과 짝이다. 한쪽만 고치면
        // **새 프로젝트만** 예전 오탐을 물려받는다.
        "!**/*.rs",
        "!**/*.ts",
        "!**/*.tsx",
        "!**/*.js",
        "!**/*.jsx",
        "!**/*.mjs",
        "!**/*.cjs",
        "!**/*.css",
        "!**/*.scss",
        "!**/*.py",
        "!**/*.go",
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

/// 생성된 TOML 의 **값만** 기존 문서에 얹는다 — 손으로 쓴 주석과 서식은
/// 사용자 것이라 남긴다 (`mcp/codex.rs` 가 남의 MCP 서버 정의에 쓰는 것과 같은
/// 규율). 바뀐 키만 갈아끼우므로 손대지 않은 자리는 글자 하나 안 움직인다.
///
/// 값이 우선이다 — 병합 결과가 `want` 를 그대로 되읽지 못하면 주석을 포기하고
/// 생성본을 돌려준다. 설정 파일이 실제 설정과 어긋나는 쪽이 훨씬 나쁘다.
fn merge_preserving_decor(existing: &str, generated: &str, want: &OculpmConfig) -> String {
    let Ok(mut doc) = existing.parse::<toml_edit::Document>() else {
        return generated.to_string();
    };
    let Ok(wanted) = generated.parse::<toml_edit::Document>() else {
        return generated.to_string();
    };
    merge_table(doc.as_table_mut(), wanted.as_table());

    let merged = doc.to_string();
    match OculpmConfig::from_toml_str(&merged) {
        Ok(back) if &back == want => merged,
        _ => generated.to_string(),
    }
}

fn merge_table(current: &mut toml_edit::Table, wanted: &toml_edit::Table) {
    // 구조체에서 사라진 키는 파일에서도 지운다 — 안 그러면 죽은 설정이 남는다.
    let stale: Vec<String> = current
        .iter()
        .map(|(key, _)| key.to_string())
        .filter(|key| !wanted.contains_key(key))
        .collect();
    for key in stale {
        current.remove(&key);
    }

    for (key, want_item) in wanted.iter() {
        match (current.get_mut(key), want_item) {
            // 표는 파고든다 — 통째로 갈아끼우면 안쪽 주석이 다 날아간다.
            (Some(toml_edit::Item::Table(cur_table)), toml_edit::Item::Table(want_table)) => {
                merge_table(cur_table, want_table);
            }
            // 값이 같으면 손대지 않는다. 이 한 줄이 배열 **안쪽** 주석을 살린다 —
            // 우리 피해자였던 forbid_journal_for_paths 의 근거 블록이 거기 있다.
            (Some(cur_item), _) => {
                if !same_value(cur_item, want_item) {
                    *cur_item = want_item.clone();
                }
            }
            (None, _) => {
                current.insert(key, want_item.clone());
            }
        }
    }
}

/// 서식·주석을 무시한 값 비교. `toml` 파서가 주석을 버리므로, 같은 조각을 양쪽
/// 다 한 번 통과시키면 "줄바꿈만 다른 같은 배열"이 같다고 나온다.
fn same_value(a: &toml_edit::Item, b: &toml_edit::Item) -> bool {
    fn plain(item: &toml_edit::Item) -> Option<toml::Value> {
        let mut table = toml_edit::Table::new();
        table.insert("v", item.clone());
        toml::from_str::<toml::Value>(&table.to_string())
            .ok()?
            .get("v")
            .cloned()
    }
    match (plain(a), plain(b)) {
        (Some(x), Some(y)) => x == y,
        // 읽어내지 못하면 같다고 우기지 않는다 — 덮어쓰는 쪽이 안전하다.
        _ => false,
    }
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

    /// 2026-09-08 — 설정을 저장할 때마다 손으로 쓴 주석이 통째로 날아갔다.
    /// 멱등 검사가 바이트 비교였는데, 생성본에는 주석이 없어 주석이 있는 파일은
    /// 절대 같아지지 않았기 때문이다. 실제 피해자는 forbid_journal_for_paths 의
    /// {#token-glob-false-positive} 근거 블록이고, 값이 하나도 안 바뀌므로 diff
    /// 가 "설정 안 건드렸네"로 읽혀 조용히 지워졌다.
    #[test]
    fn save_without_changes_leaves_the_file_untouched() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let cfg = OculpmConfig::default_for_new_project();
        cfg.save(&path).expect("first save");

        // 사용자가(또는 우리가) 손으로 근거 주석을 달아 둔 상태를 흉내낸다.
        let annotated = std::fs::read_to_string(&path)
            .unwrap()
            .replace("[git]", "# 왜 이 목록이 이렇게 생겼는지에 대한 근거\n[git]");
        std::fs::write(&path, &annotated).unwrap();

        // 같은 값으로 다시 저장 — 디스크를 아예 건드리지 않아야 한다.
        cfg.save(&path).expect("idempotent save");

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            annotated,
            "값이 그대로면 파일도 한 바이트도 달라지지 않아야 한다"
        );
    }

    /// 값이 실제로 바뀌면 그 키만 갈아끼우고, 손대지 않은 자리의 주석은 살아야
    /// 한다. 배열 **안쪽** 주석까지 포함해서 — 우리 피해자가 거기 있었다.
    #[test]
    fn save_with_changes_keeps_untouched_comments() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let cfg = OculpmConfig::default_for_new_project();
        cfg.save(&path).expect("first save");

        let annotated = std::fs::read_to_string(&path)
            .unwrap()
            .replace("[watcher]", "# 워처 주석은 살아남아야 한다\n[watcher]")
            .replace("[git]", "# git 주석도 마찬가지\n[git]");
        std::fs::write(&path, &annotated).unwrap();

        let mut changed = cfg.clone();
        changed.watcher.debounce_ms = 900;
        changed.save(&path).expect("save after change");

        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("# 워처 주석은 살아남아야 한다"), "{after}");
        assert!(after.contains("# git 주석도 마찬가지"), "{after}");
        assert_eq!(
            OculpmConfig::load(&path).unwrap().watcher.debounce_ms,
            900,
            "값은 확실히 바뀌어야 한다"
        );
    }

    /// 배열 원소 사이에 낀 주석 — 실제 사고 현장의 모양 그대로.
    #[test]
    fn save_keeps_comments_inside_an_untouched_array() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let cfg = OculpmConfig::default_for_new_project();
        cfg.save(&path).expect("first save");

        let raw = std::fs::read_to_string(&path).unwrap();
        let marker = "\"**/*private_key*\",";
        assert!(raw.contains(marker), "기본 목록 모양이 바뀌었다: {raw}");
        let annotated = raw.replace(
            marker,
            &format!("{marker}\n    # 아래 되돌림 규칙은 이 자리에 있어야 한다"),
        );
        std::fs::write(&path, &annotated).unwrap();

        let mut changed = cfg.clone();
        changed.session.inactivity_timeout_minutes = 45;
        changed.save(&path).expect("save after change");

        let after = std::fs::read_to_string(&path).unwrap();
        assert!(
            after.contains("# 아래 되돌림 규칙은 이 자리에 있어야 한다"),
            "건드리지 않은 배열 안쪽 주석이 사라졌다: {after}"
        );
        assert_eq!(
            OculpmConfig::load(&path).unwrap(),
            changed,
            "병합 결과가 값을 그대로 되읽어야 한다"
        );
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
    }

    /// D4 — `[automation]` 이 통째로 빠진 기존 config 는 **전부 off** 로
    /// 파싱되고, `schema_version` 은 그대로다 (신규 섹션이라 스펙 불변).
    #[test]
    fn missing_automation_section_parses_to_all_off() {
        let text = r#"
schema_version = 1

[workday]
timezone = "Asia/Seoul"
day_starts_at = "00:00"

[session]
inactivity_timeout_minutes = 60

[git]
forbid_journal_for_paths = []
auto_redact_patterns = []

[watcher]
ignore = []
respect_gitignore = true
debounce_ms = 500

[agents]
active = []
"#;
        let cfg = OculpmConfig::from_toml_str(text).expect("기존 config 는 그대로 읽혀야 한다");
        assert_eq!(cfg.schema_version, 1, "신규 섹션은 스키마를 올리지 않는다");
        assert!(!cfg.automation.schedules);
        assert!(!cfg.automation.watchers);
        assert_eq!(cfg.automation.daily_run_budget, 20);
        cfg.validate().expect("validate");
    }

    /// 통째로 빠진 `[automation]` 과 부분만 적힌 `[automation]` 이 같은 값을 내야
    /// 한다 — `#[derive(Default)]` 를 썼다면 예산이 0 이 돼 조용히 전면 정지된다.
    #[test]
    fn automation_defaults_agree() {
        let partial = OculpmConfig::from_toml_str(
            r#"
schema_version = 1
[workday]
timezone = "Asia/Seoul"
day_starts_at = "00:00"
[session]
inactivity_timeout_minutes = 60
[git]
forbid_journal_for_paths = []
auto_redact_patterns = []
[watcher]
ignore = []
respect_gitignore = true
debounce_ms = 500
[agents]
active = []
[automation]
schedules = true
"#,
        )
        .expect("partial");
        assert!(partial.automation.schedules);
        assert_eq!(
            partial.automation.daily_run_budget,
            AutomationConfig::default().daily_run_budget
        );
    }

    /// 폭주 가드의 상한 자체는 검증된다. `0`(전면 정지)은 유효하다.
    #[test]
    fn validate_bounds_the_daily_run_budget() {
        let mut c = OculpmConfig::default_for_new_project();
        c.automation.daily_run_budget = 0;
        assert!(c.validate().is_ok(), "0 = 전면 정지 (유효)");
        c.automation.daily_run_budget = 5_000;
        assert!(matches!(c.validate(), Err(OculpmError::InvalidConfig(_))));
    }

    /// Sanity — every default forbid pattern is non-empty.
    #[test]
    fn default_forbid_patterns_nonempty() {
        let c = OculpmConfig::default_for_new_project();
        assert!(c.git.forbid_journal_for_paths.len() >= 25);
        assert!(c.git.forbid_journal_for_paths.iter().all(|p| !p.is_empty()));
    }
}
