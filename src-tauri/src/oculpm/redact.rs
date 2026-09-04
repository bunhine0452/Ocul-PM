//! Secret + forbidden-path helpers for journal-bound data — W4-PR3.
//!
//! Two narrowly-scoped utilities. The path matcher stayed narrow; the content
//! masker did not — it is now on nearly every write path in the crate.
//!
//! * [`build_forbidden_matcher`] / [`is_forbidden_path`] — wraps
//!   `ignore::Gitignore` so callers can ask "should this path ever be
//!   journalled?" without rebuilding the matcher on every event.
//!   Mirrors `00-spec.md` §9 — `git.forbid_journal_for_paths`. Four call sites:
//!   [`watcher`], [`manager`] (journal + AGENTS.md sync), and the MCP tools.
//! * [`compile_redact_patterns`] / [`redact_text`] — regex-driven content
//!   masking. Scope is **body / diff-hunk content only**, never path or
//!   identifier text (variable names like `sk_initialize_module` would
//!   false-positive). dev-report §2 / R1 wired this into three places in
//!   2026-06; it is now **22 non-test files** — verify with
//!   `rg -l 'redact_text|compile_redact_patterns|patterns_for_project' src/`
//!   rather than trusting a hand-kept list here. They fall into six kinds of
//!   path, and a new one belongs to one of them:
//!   1. the journal SQLite projection — on-read masking in
//!      [`cache`][super::cache], so agent-authored secrets never reach the
//!      cache → AI context;
//!   2. journal writers — manual entries, body edits, indexing
//!      ([`manager`]) and the per-entry diff sidecars
//!      ([`entry_diffs`][super::entry_diffs]) at capture time;
//!   3. the agent-facing MCP surface — `mcp::tools` and `mcp::a2a_tools`
//!      (titles, bodies, notes, journal refs an agent hands us);
//!   4. model output — [`journal_draft`][super::journal_draft],
//!      `automation::{runner, scheduler}`, `import::journalize`;
//!   5. the planner / discussion projections and dispatch prompts;
//!   6. anything leaving the machine or the journal — `commands::notion`,
//!      `commands::retro`, `commands::skills`, and rule/skill promotion.
//!
//!   Use [`patterns_for_project`] to load+compile a project's
//!   `auto_redact_patterns` from disk in one call.
//!
//! See `docs/major_update/oculpm/W4/PR3-redact-forbid.md`.
//! See `docs/major_update/oculpm/phases/W4-agents-dual-layer.md` §2.6 for the
//! path-vs-content scoping rationale.
//! See `docs/20260622_dev-report/02-structural-debt.md` §2 for the wiring (R1).
//!
//! [`watcher`]: super::watcher
//! [`manager`]: super::manager

#![allow(dead_code)] // A few accessors stay unused; the core (`redact_text` /
                     // `compile_redact_patterns` / `patterns_for_project`) is
                     // consumed by the journal cache projection, manual-entry
                     // writes, and per-entry diff capture (dev-report §2 / R1).

use std::path::Path;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use regex::Regex;

use crate::oculpm::spec::OculpmConfig;

/// One match recorded by [`redact_text`]. Byte offsets reference the
/// **original** input string (pre-redaction); they are at char boundaries
/// because `regex` only reports UTF-8 safe spans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactHit {
    /// Source regex (its `Regex::as_str()` form) — readable enough for logs
    /// and `IntegrityWarning` payloads; not part of the public API contract.
    pub pattern: String,
    pub start: usize,
    pub end: usize,
}

/// Placeholder written in place of each matched span by [`redact_text`].
pub const REDACTED_PLACEHOLDER: &str = "[REDACTED]";

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden paths
// ─────────────────────────────────────────────────────────────────────────────

/// Build a fresh `Gitignore` matcher from a `forbid_journal_for_paths` slice.
///
/// `root` is used by `ignore` to resolve patterns that start with `/`; for
/// project-relative checks any directory works. Per-line parse errors are
/// swallowed — they mirror watcher behavior, where one malformed pattern
/// should never crash the matcher build. A completely empty / unbuildable
/// patterns set yields `Gitignore::empty()` (matches nothing).
pub fn build_forbidden_matcher(root: &Path, patterns: &[String]) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    for line in patterns {
        let _ = builder.add_line(None, line);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

/// True when `path` (absolute or project-relative) matches any forbidden
/// pattern in `matcher`.
///
/// Windows-style `\` separators are normalised to `/` so a journal entry
/// authored on Windows with `files_touched: [{"path": "src\\.env"}]` is
/// rejected the same way `src/.env` would be on macOS.
///
/// `ignore::Gitignore` panics if asked about an absolute path that doesn't
/// live under its root, so we strip the matcher root when possible and fall
/// back to the file's basename otherwise. The basename fallback is what
/// makes `/elsewhere/.env` still trip `**/.env*` even though we can't anchor
/// it against this project.
pub fn is_forbidden_path(matcher: &Gitignore, path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let p = Path::new(&normalized);
    let owned_basename;
    let candidate: &Path = if p.is_absolute() {
        match p.strip_prefix(matcher.path()) {
            Ok(rel) => rel,
            Err(_) => match p.file_name() {
                Some(name) => {
                    owned_basename = Path::new(name).to_path_buf();
                    // Reborrow as &Path; owned_basename outlives the match.
                    return matcher
                        .matched_path_or_any_parents(&owned_basename, false)
                        .is_ignore();
                }
                None => return false,
            },
        }
    } else {
        p
    };
    matcher
        .matched_path_or_any_parents(candidate, false)
        .is_ignore()
}

// ─────────────────────────────────────────────────────────────────────────────
// Content redaction
// ─────────────────────────────────────────────────────────────────────────────

/// Compile each regex source string. Malformed entries are dropped with a
/// `warn!` rather than failing the whole config — Settings (W4-PR7) will
/// surface compile errors inline so users can fix them.
pub fn compile_redact_patterns(patterns: &[String]) -> Vec<Regex> {
    patterns
        .iter()
        .filter_map(|p| match Regex::new(p) {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::redact",
                    pattern = %p,
                    error = %e,
                    "skipping malformed redact regex"
                );
                None
            }
        })
        .collect()
}

/// Load + compile a project's `auto_redact_patterns` from its
/// `.oculpm/config.toml`. Returns an empty vec when the config is missing or
/// unreadable (→ redaction is a no-op). Centralises the load+compile dance the
/// journal/diff write paths share so each call site doesn't re-implement it
/// (and so paths that run for a project not registered in `OculpmManager`, like
/// the lazy diff reconstruct, can still mask). Used by [`manager`] and
/// [`entry_diffs`][super::entry_diffs].
pub fn patterns_for_project(project_root: &Path) -> Vec<Regex> {
    let cfg_path = project_root.join(".oculpm").join("config.toml");
    OculpmConfig::load(&cfg_path)
        .map(|cfg| compile_redact_patterns(&cfg.git.auto_redact_patterns))
        .unwrap_or_default()
}

/// Replace every match of `patterns` in `text` with [`REDACTED_PLACEHOLDER`].
/// Returns the rewritten string + an ordered list of [`RedactHit`] suitable
/// for logging / `IntegrityWarning` payloads.
///
/// Overlap handling: all hits are collected, then sorted by `(start, end)`
/// and de-duplicated by keeping the leftmost when ranges overlap. The
/// rewrite runs right-to-left so earlier offsets stay valid as the buffer
/// shrinks. Overlapping secrets are vanishingly rare in real journals, so
/// the simple "leftmost wins" policy is enough.
pub fn redact_text(text: &str, patterns: &[Regex]) -> (String, Vec<RedactHit>) {
    let mut raw: Vec<RedactHit> = Vec::new();
    for r in patterns {
        for m in r.find_iter(text) {
            raw.push(RedactHit {
                pattern: r.as_str().to_string(),
                start: m.start(),
                end: m.end(),
            });
        }
    }
    if raw.is_empty() {
        return (text.to_string(), Vec::new());
    }
    raw.sort_by_key(|h| (h.start, h.end));

    let mut kept: Vec<RedactHit> = Vec::with_capacity(raw.len());
    let mut cursor: usize = 0;
    for h in raw {
        if h.start >= cursor {
            cursor = h.end;
            kept.push(h);
        }
    }

    let mut out = text.to_string();
    for h in kept.iter().rev() {
        out.replace_range(h.start..h.end, REDACTED_PLACEHOLDER);
    }
    (out, kept)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — see `docs/major_update/oculpm/W4/PR3-redact-forbid.md` §3.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::OculpmConfig;

    fn defaults_matcher() -> Gitignore {
        let cfg = OculpmConfig::default_for_new_project();
        // A nonexistent root is fine — only patterns starting with `/` would
        // anchor against it, and our defaults are all `**/...` globs.
        build_forbidden_matcher(
            Path::new("/tmp/__oculpm_test__"),
            &cfg.git.forbid_journal_for_paths,
        )
    }

    fn defaults_redact() -> Vec<Regex> {
        let cfg = OculpmConfig::default_for_new_project();
        compile_redact_patterns(&cfg.git.auto_redact_patterns)
    }

    // ─── redact_text — 5 cases ─────────────────────────────────────────────

    #[test]
    fn redact_aws_access_key() {
        let regs = defaults_redact();
        let (out, hits) = redact_text("export AWS_KEY=AKIAABCDEFGHIJKLMNOP rest", &regs);
        assert!(
            out.contains("[REDACTED]"),
            "expected placeholder in {out:?}"
        );
        assert!(!out.contains("AKIAABCDEFGHIJKLMNOP"));
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn redact_github_pat() {
        let regs = defaults_redact();
        // 36 chars after the prefix per the spec regex.
        let token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
        let input = format!("token={token}\n");
        let (out, hits) = redact_text(&input, &regs);
        assert!(out.contains("[REDACTED]"));
        assert!(!out.contains(token));
        assert_eq!(hits.len(), 1);
    }

    /// Korean text surrounding an ASCII secret must not panic on UTF-8 byte
    /// boundaries and must redact the secret cleanly.
    #[test]
    fn redact_inside_korean_text_is_utf8_safe() {
        let regs = defaults_redact();
        let input = "여기 비밀키 → AKIAZZZZZZZZZZZZZZZZ ← 여기까지";
        let (out, hits) = redact_text(input, &regs);
        assert!(out.contains("[REDACTED]"));
        assert!(out.contains("여기 비밀키"));
        assert!(out.contains("여기까지"));
        assert_eq!(hits.len(), 1);
    }

    /// False-positive guard. `sk-` (hyphen) is the OpenAI/Anthropic prefix;
    /// `sk_initialize_module_v1_token` is a variable name and must NOT match.
    #[test]
    fn redact_does_not_match_variable_names_with_underscore() {
        let regs = defaults_redact();
        let input = "let sk_initialize_module_v1_token = compute();";
        let (out, hits) = redact_text(input, &regs);
        assert_eq!(out, input, "variable name must survive redaction");
        assert!(hits.is_empty(), "no hits expected, got {hits:?}");
    }

    /// Positive coverage for the two default shapes that previously had only a
    /// negative/absent test — guards a regex typo in the `sk-` or `xox` rule.
    #[test]
    fn redact_openai_sk_key_and_slack_token() {
        let regs = defaults_redact();
        // OpenAI/Anthropic-style key: `sk-` then >=20 of [A-Za-z0-9_-].
        let sk = "sk-proj-abcdEFGH1234ijklMNOP5678";
        let (out, hits) = redact_text(&format!("OPENAI_API_KEY={sk}"), &regs);
        assert!(
            out.contains("[REDACTED]"),
            "sk- key must be masked: {out:?}"
        );
        assert!(!out.contains(sk));
        assert_eq!(hits.len(), 1);

        // Slack bot token: `xox[baprs]-` then [A-Za-z0-9-]+.
        let xox = "xoxb-not-a-real-token";
        let (out2, hits2) = redact_text(&format!("slack: {xox}"), &regs);
        assert!(
            out2.contains("[REDACTED]"),
            "slack token must be masked: {out2:?}"
        );
        assert!(!out2.contains(xox));
        assert_eq!(hits2.len(), 1);
    }

    #[test]
    fn redact_records_all_hits_for_multiple_matches() {
        let regs = defaults_redact();
        let input = "k1=AKIAAAAAAAAAAAAAAAAA k2=AKIABBBBBBBBBBBBBBBB k3=AKIACCCCCCCCCCCCCCCC";
        let (out, hits) = redact_text(input, &regs);
        assert_eq!(hits.len(), 3, "expected 3 hits, got {hits:?}");
        assert_eq!(out.matches("[REDACTED]").count(), 3);
    }

    // ─── is_forbidden_path — 6 cases ──────────────────────────────────────

    #[test]
    fn forbidden_env_file_relative() {
        let m = defaults_matcher();
        assert!(is_forbidden_path(&m, ".env"));
        assert!(is_forbidden_path(&m, ".env.local"));
        assert!(is_forbidden_path(&m, "src/.env.local"));
    }

    #[test]
    fn forbidden_secret_filenames() {
        let m = defaults_matcher();
        // Default forbid set includes `**/*secret*`, `**/*credential*`, etc.
        assert!(is_forbidden_path(&m, "config/db_secrets.json"));
        assert!(is_forbidden_path(&m, "infra/credentials.json"));
    }

    #[test]
    fn forbidden_aws_credentials_file() {
        let m = defaults_matcher();
        // Default forbid set has `**/.aws/credentials` (a single file) plus
        // `**/.aws/config`. Both should match in either positional form.
        assert!(is_forbidden_path(&m, ".aws/credentials"));
        assert!(is_forbidden_path(&m, "subdir/.aws/credentials"));
    }

    #[test]
    fn not_secrets_paths_pass_through() {
        let m = defaults_matcher();
        assert!(!is_forbidden_path(&m, "src/main.rs"));
        assert!(!is_forbidden_path(&m, "docs/architecture.md"));
        // `notes_about_secrets.md` could match `**/*secret*` and that's the
        // *intended* over-broad behaviour from spec §9 (false positives over
        // false negatives). The case we DO want to pass is one with no
        // secret-y substring at all.
        assert!(!is_forbidden_path(&m, "notes/architecture-overview.md"));
    }

    /// Absolute paths must match the same file-name patterns project-relative
    /// paths do. Directory-anchored globs like `**/secrets/**` are best-effort:
    /// when the absolute path is outside the matcher root we fall back to the
    /// basename, so `/elsewhere/secrets/aws.json` would only match through its
    /// basename (`aws.json` → no hit). Callers wanting directory-anchored
    /// guarantees must pass paths that live under `matcher.path()`.
    #[test]
    fn forbidden_absolute_path_matches() {
        let m = defaults_matcher();
        assert!(is_forbidden_path(&m, "/Users/dev/myrepo/.env"));
        assert!(is_forbidden_path(&m, "/Users/dev/myrepo/.env.production"));
        assert!(is_forbidden_path(&m, "/var/lib/app/credentials.json"));
    }

    /// Windows-style backslash separators are normalised before matching,
    /// so journal entries authored on Windows still trip the same patterns.
    #[test]
    fn forbidden_windows_path_matches() {
        let m = defaults_matcher();
        assert!(is_forbidden_path(&m, "src\\.env.local"));
        assert!(is_forbidden_path(&m, "infra\\credentials.json"));
    }
}
