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
//!   2026-06; it is now [`CALL_SITE_FILES`] non-test files. **That number is
//!   measured, not remembered** — `tests/egress_inventory.rs` counts the files
//!   on disk and fails when the constant drifts, because the hand-kept "three
//!   places" in this very paragraph was wrong by an order of magnitude for
//!   three months. They fall into six kinds of path, and a new one belongs to
//!   one of them:
//!   1. the journal SQLite projection — on-read masking in
//!      [`cache`][super::cache], so agent-authored secrets never reach the
//!      cache → AI context;
//!   2. journal writers — manual entries, body edits, indexing
//!      ([`manager`]) and the per-entry diff sidecars
//!      ([`entry_diffs`][super::entry_diffs]) at capture time;
//!   3. the agent-facing MCP surface — `mcp::tools` (titles, bodies, notes,
//!      journal refs an agent hands us);
//!   4. model output — [`journal_draft`][super::journal_draft],
//!      `automation::{runner, scheduler}`, `import::journalize`;
//!   5. the planner / discussion projections and dispatch prompts;
//!   6. anything leaving the machine or the journal — `commands::notion`,
//!      `commands::skills` and rule/skill promotion.
//!
//!   Use [`patterns_for_project`] to load+compile a project's
//!   `auto_redact_patterns` from disk in one call.
//!
//! # What is *not* covered ({#redact-doc-truth})
//!
//! Redaction is a boundary, not a blanket — and a boundary has an outside.
//! [`EXEMPT_LLM_PROMPT_SITES`] prompt-building sites reach a model without
//! passing through this module or the masked cache projection. They are
//! enumerated with a reason each in `tests/llm_prompt_ledger.rs`
//! (`LLM_PROMPT_SITES`), which fails when a new one appears undeclared — and,
//! since 2026-10-07, also when a call goes through a wrapper (`call_llm`,
//! `ChatBackend`, …) the ledger has not classified. Before that the scan only
//! saw files that spelled out `llm::create`, so four sites sat outside it. The
//! short version: the AI panel and the mobile bridge relay what the *user*
//! typed (the promise's own exception), and the project overview reads README
//! and manifest files straight off disk. Nothing agent-authored reaches a model
//! unmasked. (The greenfield seed-goal prompt was a fourth such site until v3
//! removed it — the wizard seeds the file-based Planner instead.)
//!
//! See `docs/major_update/oculpm/W4/PR3-redact-forbid.md`.
//! See `docs/major_update/oculpm/phases/W4-agents-dual-layer.md` §2.6 for the
//! path-vs-content scoping rationale.
//! See `docs/20260622_dev-report/02-structural-debt.md` §2 for the wiring (R1).
//!
//! [`watcher`]: super::watcher
//! [`manager`]: super::manager

// `compile_redact_patterns` / `patterns_for_project`) is
// consumed by the journal cache projection, manual-entry
// writes, and per-entry diff capture (dev-report §2 / R1).

use std::path::Path;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use regex::Regex;

use crate::oculpm::spec::OculpmConfig;

/// Non-test files under `src-tauri/src/` that call into this module.
///
/// Measured, not remembered: `tests/egress_inventory.rs` scans the tree and
/// fails when this drifts. Bump it in the same commit that adds or removes a
/// call site — the number is a claim the module doc makes, and a stale claim
/// about where secrets get masked is worse than no claim.
///
/// 27 부터 (같은 라운드의 두 자리): `planner/log_archive.rs` — 아카이브 사이드카도
/// 사람이 읽는 파일이라 옮기는 행을 한 번 더 지난다 (`{#plan-log-archive}`);
/// `mcp/tools/search/rollup_hits.rs` — 주간 요약의 스니펫도 에이전트
/// 에게 가는 글이라 종류 3(에이전트 대면 MCP 표면)에 속한다. 롤업 본문은
/// 마스킹된 캐시 투영에서 났지만, 사람이 그 파일을 손으로 고칠 수 있으므로
/// 내보내기 직전에 한 번 더 지난다 (journal-scale-round `{#rollup-first}`).
///
/// 28 부터: `journal_index.rs` — 일지 의미검색 색인은 마스킹된 캐시 투영이
/// 아니라 **디스크 원문**을 읽는다. 청크 텍스트가 SQLite 에 남고 검색 결과로
/// 화면에 뜨므로, 자르기 직전에 한 번 지난다
/// (journal-scale-round `{#search-semantic-journal}`).
///
/// 27 → 28 (보안 피드백 2차, 2026-10-07): `commands/release_notes.rs` — 릴리스
/// 노트 초안이 디스크에서 바로 읽은 `CHANGELOG.md` 문체 표본을 모델에 보내기
/// 전에 가린다. 그 전에는 프롬프트 원장이 래퍼(`map_reduce_blocks`)를 지나는 이
/// 자리를 보지 못해 표본이 가려지지 않은 채 나갔다.
pub const CALL_SITE_FILES: usize = 28;

/// Prompt-building sites that reach a model **without** redaction — neither
/// directly nor through the masked cache projection.
///
/// See the module doc's "What is not covered" and `LLM_PROMPT_SITES` in
/// `tests/llm_prompt_ledger.rs`, which owns the per-site reasons.
pub const EXEMPT_LLM_PROMPT_SITES: usize = 3;

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
///
/// 윈도우 두 가지 (크로스플랫폼 L-FS):
/// - 절대 경로는 **구분자를 바꾸기 전에** 네이티브 모양으로 루트를 벗긴다. 워처가
///   주는 경로는 `canonicalize` 된 루트 위의 `\\?\C:\…` 인데, `/` 로 먼저 바꾸면
///   `//?/C:/…`(UNC 로 읽힌다)가 되어 루트와 영영 안 맞고 basename 판정으로 떨어진다 —
///   `secrets/**` 같은 디렉터리 패턴이 조용히 빠진다.
/// - 드라이브 없이 루트만 있는 경로(`/Users/dev/.env` · `\x`)는 윈도우에서 절대 경로가
///   아니다. 상대 경로로 넘기면 `ignore` 가 "path is expected to be under the root" 로
///   패닉하므로 절대 경로와 같은 갈래(루트 벗기기 → basename)로 보낸다. 유닉스에서
///   `has_root()` 는 `is_absolute()` 와 같다 — 동작 불변.
pub fn is_forbidden_path(matcher: &Gitignore, path: &str) -> bool {
    #[cfg(windows)]
    {
        let native = Path::new(path);
        if native.is_absolute() {
            if let Some(rel) = crate::git::relative_to(matcher.path(), native) {
                return matcher
                    .matched_path_or_any_parents(Path::new(&rel), false)
                    .is_ignore();
            }
        }
    }
    let normalized = path.replace('\\', "/");
    let p = Path::new(&normalized);
    let owned_basename;
    let candidate: &Path = if p.is_absolute() || p.has_root() {
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

/// 내장 바닥 — 프로젝트 설정과 **상관없이** 언제나 가리는 패턴.
///
/// 예전에는 이 넷(AWS 액세스 키·`sk-`·`ghp_`·Slack)이 `auto_redact_patterns` 의
/// 기본값이었다. 그래서 두 가지가 샜다 (2026-10-07 외부 보안 피드백 #1·#3):
/// (1) `config.toml` 은 저장소에 실려 오므로 남의 저장소가 `auto_redact_patterns
/// = []` 한 줄로 마스킹을 끌 수 있었고, (2) 기존 프로젝트는 init 때 적힌 넷을
/// 파일에 들고 있어 기본값을 늘려도 아무도 받지 못했다. 이제 설정의 목록은
/// **이 위에 더하는** 패턴이다.
///
/// 오탐보다 미탐이 비싸지만, 이 목록은 일지·diff 본문 전체에 걸리므로 모양이
/// 분명한 것만 둔다 — 접두가 있는 토큰, 맥락(키 이름·`user:pass@`)이 붙은 값.
/// `.env` 꼴 할당은 **대문자 키 + 공백 없는 `=`**(그 파일의 관례)만 보고, 숫자뿐인
/// 값(`MAX_TOKENS=4096`)은 건너뛴다.
pub const BUILTIN_PATTERNS: &[&str] = &[
    // ── 예전 기본값 넷 (문자열 그대로 — 옛 config 의 같은 줄과 중복 제거된다)
    r"AKIA[0-9A-Z]{16}",         // AWS Access Key
    r"sk-[A-Za-z0-9_-]{20,}",    // OpenAI / Anthropic / OpenRouter
    r"ghp_[A-Za-z0-9]{36}",      // GitHub PAT (classic)
    r"xox[baprs]-[A-Za-z0-9-]+", // Slack
    // ── 접두가 있는 토큰
    r"ASIA[0-9A-Z]{16}",                           // AWS 임시(STS) 액세스 키
    r"gh[ousr]_[A-Za-z0-9]{36}",                   // GitHub OAuth·사용자·서버·갱신 토큰
    r"github_pat_[A-Za-z0-9_]{22,}",               // GitHub fine-grained PAT
    r"glpat-[A-Za-z0-9_-]{20,}",                   // GitLab PAT
    r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", // Stripe 비밀·제한 키
    r"AIza[0-9A-Za-z_-]{35}",                      // Google API 키
    r"GOCSPX-[A-Za-z0-9_-]{28}",                   // Google OAuth 클라이언트 시크릿
    r"\bnpm_[A-Za-z0-9]{36}\b",                    // npm 토큰
    r"pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}",     // PyPI 토큰
    r"\bhf_[A-Za-z0-9]{34,}\b",                    // Hugging Face 토큰
    r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+", // Slack 웹훅
    // ── 모양으로 알 수 있는 것
    r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", // JWT
    r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----", // PEM 개인키
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:\s*[A-Za-z0-9+/=]{16,})+", // 잘린 PEM 개인키
    // ── 맥락이 붙은 값
    r#"(?i)aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}"#, // AWS 시크릿 키
    r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{20,}", // Authorization: Bearer …
    // 접속 문자열의 `user:pass@` (DB·큐·http 기본 인증)
    r"\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|https?|ftp)://[^\s:@/]+:[^\s@/]+@",
    // `.env` 꼴 비밀 할당 — 대문자 키 + 공백 없는 `=` + 숫자만은 아닌 값. 줄 머리에
    // 묶지 않는다: `DB_PASSWORD=… ./run.sh` 처럼 명령 앞에 붙는 꼴이 대화에 흔하다.
    r"\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Z0-9_]*=[^\s#]*[^\s#0-9][^\s#]*",
];

/// [`BUILTIN_PATTERNS`] 를 한 번만 컴파일한다 — 호출 자리가 서른 곳 가까이 되고
/// 일부는 일지마다 부른다.
fn builtin_regexes() -> &'static [Regex] {
    static COMPILED: std::sync::OnceLock<Vec<Regex>> = std::sync::OnceLock::new();
    COMPILED.get_or_init(|| {
        BUILTIN_PATTERNS
            .iter()
            .map(|p| Regex::new(p).expect("내장 redact 패턴은 컴파일돼야 한다"))
            .collect()
    })
}

/// 이름만으로 비밀이 사는 파일 — `.gitignore` 와 무관하게 **원문을 남기지 않는다.**
///
/// 색인한 청크는 SQLite 에 평문으로 남고 의미 검색 결과로 AI 패널 프롬프트에 실려
/// 나가며(2026-10-08 검토), 로컬 히스토리 스냅샷은 되돌리기용 원문이라 마스킹을 걸
/// 수 없다. 둘 다 이 판정 하나를 지난다 (`indexer::is_skipped_name` ·
/// `history::should_capture`) — 목록이 둘이면 하나는 반드시 뒤처진다. `.env.*` 는
/// `.env.example` 까지 막는다: 예시 파일에 진짜 값을 적는 일이 흔하다.
pub fn is_secret_file_name(name: &str) -> bool {
    const NAMES: &[&str] = &[
        ".env",
        ".npmrc",
        ".pypirc",
        ".netrc",
        ".git-credentials",
        "credentials.json",
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
    ];
    const SUFFIXES: &[&str] = &[".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"];
    let lower = name.to_ascii_lowercase();
    NAMES.contains(&lower.as_str())
        || lower.starts_with(".env.")
        || SUFFIXES.iter().any(|s| lower.ends_with(s))
}

/// 프로젝트의 마스킹 패턴 = [`BUILTIN_PATTERNS`] + 사용자가 더한 `patterns`.
/// 바닥은 설정으로 끌 수 없다 — 빈 목록을 넘겨도 바닥은 남는다. 같은 문자열은
/// 한 번만 싣는다. Malformed user entries are dropped with a `warn!` rather
/// than failing the whole config — Settings (W4-PR7) surfaces compile errors
/// inline so users can fix them.
pub fn compile_redact_patterns(patterns: &[String]) -> Vec<Regex> {
    let mut out: Vec<Regex> = builtin_regexes().to_vec();
    for p in patterns {
        if BUILTIN_PATTERNS.contains(&p.as_str()) || out.iter().any(|r| r.as_str() == p) {
            continue;
        }
        match Regex::new(p) {
            Ok(r) => out.push(r),
            Err(e) => {
                tracing::warn!(
                    target: "oculpm::redact",
                    pattern = %p,
                    error = %e,
                    "skipping malformed redact regex"
                );
            }
        }
    }
    out
}

/// Load + compile a project's `auto_redact_patterns` from its
/// `.oculpm/config.toml`. When the config is missing or unreadable this is the
/// builtin floor alone — never empty: a repo that ships a broken `config.toml`
/// must not switch masking off (the floor's whole point; it used to return an
/// empty vec here). Centralises the load+compile dance the
/// journal/diff write paths share so each call site doesn't re-implement it
/// (and so paths that run for a project not registered in `OculpmManager`, like
/// the lazy diff reconstruct, can still mask). Used by [`manager`] and
/// [`entry_diffs`][super::entry_diffs].
pub fn patterns_for_project(project_root: &Path) -> Vec<Regex> {
    let cfg_path = project_root.join(".oculpm").join("config.toml");
    OculpmConfig::load(&cfg_path)
        .map(|cfg| compile_redact_patterns(&cfg.git.auto_redact_patterns))
        .unwrap_or_else(|_| compile_redact_patterns(&[]))
}

/// Replace every match of `patterns` in `text` with [`REDACTED_PLACEHOLDER`].
/// Returns the rewritten string + an ordered list of [`RedactHit`] suitable
/// for logging / `IntegrityWarning` payloads.
///
/// Overlap handling: all hits are collected, sorted by `(start, end)`, and
/// overlapping ranges are **merged into their union** — the kept hit carries
/// the pattern of the first (leftmost) match. The rewrite runs right-to-left
/// so earlier offsets stay valid as the buffer shrinks.
///
/// It used to keep only the leftmost hit and *drop* anything overlapping it.
/// With two patterns matching the same key at different lengths (a strict
/// user rule `sk-[A-Za-z0-9]{20}` next to the default `sk-[A-Za-z0-9_-]{20,}`)
/// the shorter one sorted first and won, and the tail of the key survived as
/// `[REDACTED]tail…`. A mask that leaks half a secret is worse than none — it
/// reads as "this was checked".
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
    for h in raw {
        match kept.last_mut() {
            Some(last) if h.start < last.end => last.end = last.end.max(h.end),
            _ => kept.push(h),
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
    use super::is_secret_file_name;

    #[test]
    fn secret_file_names_are_recognised_by_name_alone() {
        for n in [
            ".env",
            ".env.local",
            ".env.example",
            ".npmrc",
            "id_ed25519",
            "server.PEM",
            "cert.p12",
        ] {
            assert!(is_secret_file_name(n), "{n}");
        }
        for n in [
            "env.rs",
            "README.md",
            "keys.rs",
            "monkey.ts",
            "Cargo.toml",
            "environment.ts",
        ] {
            assert!(!is_secret_file_name(n), "{n}");
        }
    }

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

    /// Two patterns, same start, different length — the union must be masked.
    /// The old "leftmost wins" kept the shorter hit and let the key's tail
    /// through as `[REDACTED]5678ijklMNOP…`.
    #[test]
    fn redact_overlapping_hits_mask_the_union() {
        let regs = compile_redact_patterns(&[
            r"sk-[A-Za-z0-9]{8}".to_string(),
            r"sk-[A-Za-z0-9_-]{20,}".to_string(),
        ]);
        let key = "sk-abcdEFGH1234ijklMNOP5678";
        let (out, hits) = redact_text(&format!("key={key} done"), &regs);
        assert_eq!(out, "key=[REDACTED] done", "{out:?}");
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].start, hits[0].end), (4, 4 + key.len()));

        // Partial overlap (a range that starts inside the previous one and
        // ends after it) also extends the mask instead of leaking the tail.
        let regs = compile_redact_patterns(&[
            r"token=[a-z]{4}".to_string(),
            r"[a-z]{4}[0-9]{6}".to_string(),
        ]);
        let (out, hits) = redact_text("token=abcd123456;", &regs);
        assert_eq!(out, "[REDACTED];", "{out:?}");
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

    /// 바닥은 설정으로 끌 수 없다 — 저장소의 `auto_redact_patterns = []` 는
    /// "추가 패턴 없음" 이지 "마스킹 끔" 이 아니다 (외부 보안 피드백 #1).
    #[test]
    fn an_empty_project_list_keeps_the_builtin_floor() {
        let cfg = OculpmConfig::from_toml_str("[git]\nauto_redact_patterns = []\n").unwrap();
        let regs = compile_redact_patterns(&cfg.git.auto_redact_patterns);
        let (out, _) = redact_text("key AKIAABCDEFGHIJKLMNOP", &regs);
        assert_eq!(out, "key [REDACTED]");
        // 옛 config 가 들고 있는 예전 기본값 넷은 중복 없이 같은 결과다.
        let old: Vec<String> = BUILTIN_PATTERNS[..4]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(compile_redact_patterns(&old).len(), BUILTIN_PATTERNS.len());
    }

    /// 설정을 못 읽어도 바닥은 선다 (보안 피드백 2차). 깨진 `config.toml` 을
    /// 실은 저장소에서 `patterns_for_project` 가 빈 목록을 돌려줘, 그 길을
    /// 지나는 일지 색인·승격·Notion 내보내기가 아무것도 가리지 않았다.
    #[test]
    fn a_missing_or_broken_config_still_masks_with_the_floor() {
        let tmp = tempfile::tempdir().unwrap();
        let key = format!("AKIA{}", "ABCDEFGHIJKLMNOP");
        let masked = |root: &Path| redact_text(&key, &patterns_for_project(root)).0;
        assert_eq!(masked(tmp.path()), REDACTED_PLACEHOLDER, "config 없음");
        std::fs::create_dir_all(tmp.path().join(".oculpm")).unwrap();
        std::fs::write(tmp.path().join(".oculpm/config.toml"), "[git\nbroken =").unwrap();
        assert_eq!(masked(tmp.path()), REDACTED_PLACEHOLDER, "깨진 config");
    }

    /// 기본 패턴 확장 (외부 보안 피드백 #3) — 리뷰가 짚은 꼴 전부. 토큰 모양은
    /// 실행 중에 조립한다: 소스에 그럴듯한 키 문자열을 남기지 않는다.
    #[test]
    fn the_floor_masks_the_reported_shapes() {
        let regs = compile_redact_patterns(&[]);
        let a = |n: usize| "a1B2".repeat(n / 4 + 1)[..n].to_string();
        let cases = [
            format!("github_pat_{}", a(82)),
            format!("{}_{}_{}", "sk", "live", a(24)),
            format!("AIza{}", a(35)),
            format!("eyJ{}.eyJ{}.{}", a(20), a(30), a(43)),
            format!(
                "-----BEGIN RSA {k}-----\n{}\n{}\n-----END RSA {k}-----",
                a(64),
                a(40),
                k = "PRIVATE KEY"
            ),
            format!("aws_secret_access_key = {}", a(40)),
            format!("postgres://app:{}@db.internal:5432/main", a(12)),
            format!("DB_PASSWORD={}", "hunter2"),
            format!("export GITHUB_TOKEN={}", a(20)),
            format!("Authorization: Bearer {}", a(32)),
            format!("{}-{}", "glpat", a(20)),
            format!("{}_{}", "npm", a(36)),
        ];
        for secret in &cases {
            let (out, hits) = redact_text(&format!("앞 {secret} 뒤"), &regs);
            assert!(!hits.is_empty(), "가려지지 않았다: {secret}");
            assert!(out.starts_with("앞 ") && out.ends_with(" 뒤"), "{out:?}");
            assert!(!out.contains(&a(12)), "값이 새어 나왔다: {out:?}");
        }
        // 잘린 개인키(끝 줄이 없는 발췌)도.
        let cut = format!("-----BEGIN {}-----\n{}", "PRIVATE KEY", a(64));
        assert!(!redact_text(&cut, &regs).1.is_empty(), "잘린 개인키");
    }

    /// 바닥은 일지·diff 본문 전체에 걸리므로 흔한 모양을 건드리면 안 된다.
    #[test]
    fn the_floor_leaves_ordinary_text_alone() {
        let regs = compile_redact_patterns(&[]);
        for text in [
            "MAX_TOKENS=4096",
            "commit 3f2a9c0b7d1e4f5a6b8c9d0e1f2a3b4c5d6e7f80",
            "API_KEY = os.environ[\"API_KEY\"]",
            "let sk_initialize_module_v1_token = compute();",
            "a bearer token goes in the header",
            "git@github.com:owner/repo.git",
            "https://github.com/owner/repo/pull/12",
            "-----BEGIN PRIVATE KEY----- 블록은 붙여 넣지 마세요",
            "token=abcd123456;",
        ] {
            let (out, hits) = redact_text(text, &regs);
            assert!(hits.is_empty(), "오탐: {text:?} → {out:?}");
        }
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

    /// 워처가 실제로 넘기는 모양 — **실경로로 편 루트 위의 네이티브 절대 경로**
    /// (윈도우는 `\\?\C:\…`). 디렉터리 패턴(`secrets/`)은 루트를 벗겨야만 걸린다
    /// — basename 판정으로 떨어지면 `aws.json` 이 조용히 빠진다.
    #[test]
    fn forbidden_native_absolute_path_under_the_canonical_root_is_anchored() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let m = build_forbidden_matcher(&root, &["secrets/".to_string()]);
        let hit = root.join("secrets").join("aws.json");
        let miss = root.join("src").join("aws.json");
        assert!(is_forbidden_path(&m, &hit.to_string_lossy()), "{hit:?}");
        assert!(!is_forbidden_path(&m, &miss.to_string_lossy()), "{miss:?}");
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
